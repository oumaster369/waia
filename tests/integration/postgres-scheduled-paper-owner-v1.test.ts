/** DEE-1205: the closed scheduled noncapital paper owner on isolated PostgreSQL. */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { createOrdinaryPaperOrderRepositoryFromExecutorPostgres } from "@/lib/trader/execution/ordinary-paper-order-repository-postgres";
import {
  runScheduledNoncapitalPaperLoopFromEnv,
  ScheduledNoncapitalOwnerRefusedError,
} from "@/lib/trader/paper/scheduled-noncapital-owner-postgres-v1";
import { startCommitAckLossProxy } from "../helpers/postgres-commit-ack-loss-proxy";
import { recordedPublicTransport } from "../helpers/recorded-paper-public-transport";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const REQUIRED_DATABASE = "waia_hsv2_it_oct01_mock_ledger_scope_1205_v1";
const DEE1213_DATABASE = "waia_hsv2_it_dee1213_scheduled_deadline_v1";
const CI_DATABASE = "waia_dee1205";
const RECEIPT_TABLE = "trader_scheduled_noncapital_cycle_receipts_v1";

type Counts = Readonly<Record<"receipts" | "limits" | "orders" | "events" | "fills" | "allowances" | "plans" | "attempts" | "audit", number>>;

function assertExactDisposableDatabase(raw: string | undefined): asserts raw is string {
  if (!raw) throw new Error("DEE1205_ISOLATED_POSTGRES_REQUIRED");
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("DEE1205_ISOLATED_POSTGRES_REQUIRED"); }
  const localHost = new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsed.hostname);
  const localTarget1205 = localHost && parsed.port === "54329" && parsed.username === "waia_validate" &&
    parsed.pathname === `/${REQUIRED_DATABASE}` && !parsed.searchParams.has("ssl");
  const localTarget1213 = localHost && parsed.port === "54338" && parsed.username === "waia_validate" &&
    parsed.pathname === `/${DEE1213_DATABASE}` && !parsed.searchParams.has("ssl");
  const ciTarget = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" &&
    parsed.hostname === "127.0.0.1" && parsed.port === "5432" && parsed.username === "waia_it" &&
    parsed.password === "waia_it" && parsed.pathname === "/waia_dee1205" && !parsed.search && !parsed.hash;
  if (!localTarget1205 && !localTarget1213 && !ciTarget) {
    throw new Error("DEE1205_EXACT_DISPOSABLE_DATABASE_REQUIRED");
  }
}

describe.skipIf(!enabled || !url)("DEE-1205 closed scheduled noncapital owner on PostgreSQL", () => {
  let ownerSql: postgres.Sql;
  let witnessSql: postgres.Sql;
  let db: WaiaPostgresDb;
  let currentOrg = "";
  let triggerInstalled = false;
  let slowTriggerInstalled = false;
  const mockedGlobals: Array<() => void> = [];

  async function seedOrganization(label: string): Promise<string> {
    const userId = randomUUID();
    await ownerSql`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT (id) DO NOTHING`;
    await db.insert(pgSchema.users).values({
      id: userId,
      identityLabel: label,
      email: `${userId}@waia.invalid`,
      passwordHash: null,
    });
    const organizationId = await ensureUserCoreSeedPostgres(db, { userId, displayName: label });
    if (!/[a-f]/i.test(organizationId)) throw new Error("DEE1205_UUID_FIXTURE_NEEDS_HEX_LETTER");
    return organizationId;
  }

  function envFor(organizationId: string, connectionUrl = url!): Record<string, unknown> {
    return {
      PAPER_LOOP_ENABLED: "1",
      PAPER_LOOP_ORGANIZATION_ID: organizationId,
      PAPER_LOOP_ACCOUNT_KEY: "dee1205-synthetic-paper-account",
      DATABASE_URL_POSTGRES: connectionUrl,
      WAIA_RELEASE_SHA: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      PAPER_LOOP_CYCLE_ID_PREFIX: "dee1205-native",
    };
  }

  function installPublicPoll(options: Readonly<{
    alteredLatestClose?: number;
    waitForTwoKlineRequests?: boolean;
    timeOffsetMs?: number;
    fixedNowMs?: number;
    freezeClock?: boolean;
    requests?: string[];
  }> = {}): void {
    const fixedNow = (options.fixedNowMs ?? Date.now()) + (options.timeOffsetMs ?? 0);
    const routes: string[] = options.requests ?? [];
    const recorded = recordedPublicTransport(() => fixedNow, (path) => routes.push(path), { closedBarsOnly: true });
    const waiting = new Map<string, { count: number; promise: Promise<void>; release: () => void }>();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : undefined;
      const requestUrl = new URL(request?.url ?? String(input));
      const method = init?.method ?? request?.method ?? "GET";
      if (requestUrl.hostname !== "api.huobi.pro") {
        // Optional providers are deterministic unavailable inputs; no internet is used.
        return new Response(JSON.stringify({ status: "error", code: "SYNTHETIC_OPTIONAL_UNAVAILABLE" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      const headers = new Headers(init?.headers ?? request?.headers);
      if (method !== "GET" || requestUrl.protocol !== "https:" ||
          [...requestUrl.searchParams.keys(), ...headers.keys()]
            .some((key) => /authorization|signature|access.?key|secret/i.test(key))) {
        throw new Error("DEE1205_HTX_PUBLIC_GET_ONLY");
      }
      if (options.waitForTwoKlineRequests && requestUrl.pathname === "/market/history/kline") {
        const key = requestUrl.searchParams.get("period") ?? "";
        let entry = waiting.get(key);
        if (!entry) {
          let release!: () => void;
          const promise = new Promise<void>((resolve) => { release = resolve; });
          entry = { count: 0, promise, release };
          waiting.set(key, entry);
        }
        entry.count++;
        if (entry.count === 2) entry.release();
        await entry.promise;
      }
      const response = await recorded(input, init);
      if (!options.alteredLatestClose || requestUrl.pathname !== "/market/history/kline") return response;
      const payload = await response.json() as { data: Array<Record<string, unknown>> };
      const latest = payload.data[0];
      if (!latest) throw new Error("DEE1205_KLINE_FIXTURE_EMPTY");
      latest.close = options.alteredLatestClose;
      latest.high = 104;
      latest.vol = 206;
      return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
    }) as typeof fetch);
    mockedGlobals.push(() => {
      vi.stubGlobal("fetch", originalFetch);
      vi.restoreAllMocks();
      vi.useRealTimers();
    });
    if (options.freezeClock !== false) {
      // Freeze Date construction as well as Date.now so the fused observation
      // timestamps remain byte-identical across exact retries. Timers stay real.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(fixedNow);
    }
  }

  async function counts(organizationId = currentOrg): Promise<Counts> {
    const one = async (table: string): Promise<number> => {
      const rows = await witnessSql.unsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM public.${table} WHERE organization_id=$1::uuid`,
        [organizationId],
      );
      return rows[0]!.count;
    };
    const [receipts, limits, orders, events, fills, allowances, plans, attempts, audit] = await Promise.all([
      one(RECEIPT_TABLE), one("trader_risk_limits"), one("trader_orders"), one("trader_order_events"),
      one("trader_fills"), one("trader_risk_allowances_v2"), one("trader_execution_plans_v2"),
      one("trader_execution_attempts_v2"), one("trader_operator_audit"),
    ]);
    return { receipts, limits, orders, events, fills, allowances, plans, attempts, audit };
  }

  async function expectNoExecutionEffects(organizationId = currentOrg): Promise<void> {
    const actual = await counts(organizationId);
    expect(actual.orders).toBe(0);
    expect(actual.events).toBe(0);
    expect(actual.fills).toBe(0);
    expect(actual.allowances).toBe(0);
    expect(actual.plans).toBe(0);
    expect(actual.attempts).toBe(0);
    expect(actual.audit).toBe(0);
  }

  async function insertOrder(input: Readonly<{
    venue: string;
    executionMode: "mock" | "paper";
    state: "ACCEPTED" | "FILLED";
    historicalRunId?: string | null;
    historicalAccountKey?: string | null;
  }>): Promise<string> {
    const id = randomUUID();
    await db.insert(pgSchema.traderOrders).values({
      id,
      organizationId: currentOrg,
      venue: input.venue,
      executionMode: input.executionMode,
      historicalRunId: input.historicalRunId ?? null,
      historicalAccountKey: input.historicalAccountKey ?? null,
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      price: "100",
      quantity: "1",
      state: input.state,
      clientOrderId: `dee1205-${randomUUID()}`,
      idempotencyKey: `dee1205-${randomUUID()}`,
      riskDecisionId: randomUUID(),
    });
    await db.insert(pgSchema.traderOrderEvents).values({
      id: randomUUID(), organizationId: currentOrg, orderId: id, seq: 0,
      toState: input.state, eventType: "transition", occurredAt: new Date(),
    });
    return id;
  }

  async function installReceiptTrigger(body: string): Promise<void> {
    await ownerSql.unsafe(`
      CREATE FUNCTION public.dee1205_native_receipt_fault_v1() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.organization_id='${currentOrg}'::uuid THEN ${body} END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER dee1205_native_receipt_fault_v1 BEFORE INSERT
      ON public.${RECEIPT_TABLE} FOR EACH ROW
      EXECUTE FUNCTION public.dee1205_native_receipt_fault_v1();
    `).simple();
    triggerInstalled = true;
  }

  async function clearReceiptTrigger(): Promise<void> {
    if (!triggerInstalled) return;
    await ownerSql.unsafe(`DROP TRIGGER IF EXISTS dee1205_native_receipt_fault_v1 ON public.${RECEIPT_TABLE}`);
    await ownerSql.unsafe("DROP FUNCTION IF EXISTS public.dee1205_native_receipt_fault_v1()");
    triggerInstalled = false;
  }

  async function clearSlowReceiptTrigger(): Promise<void> {
    if (!slowTriggerInstalled) return;
    await ownerSql.unsafe(`DROP TRIGGER IF EXISTS dee1205_native_slow_receipt_v1 ON public.${RECEIPT_TABLE}`);
    await ownerSql.unsafe("DROP FUNCTION IF EXISTS public.dee1205_native_slow_receipt_v1()");
    slowTriggerInstalled = false;
  }

  beforeAll(async () => {
    assertExactDisposableDatabase(url);
    const expectedDatabase = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true"
      ? CI_DATABASE
      : new URL(url!).port === "54338" ? DEE1213_DATABASE : REQUIRED_DATABASE;
    ownerSql = postgres(url, { max: 6, prepare: false });
    witnessSql = postgres(url, { max: 4, prepare: false });
    db = drizzle(ownerSql, { schema: pgSchema }) as unknown as WaiaPostgresDb;
    const identity = await witnessSql<{ database_name: string; server_version_num: number }[]>`
      SELECT current_database() AS database_name,
             current_setting('server_version_num')::int AS server_version_num
    `;
    expect(identity[0]?.database_name).toBe(expectedDatabase);
    expect(Math.floor((identity[0]?.server_version_num ?? 0) / 10000)).toBe(16);
    const priorTable = await witnessSql<{ table_name: string | null }[]>`
      SELECT to_regclass('public.trader_scheduled_noncapital_cycle_receipts_v1')::text AS table_name
    `;
    if (priorTable[0]?.table_name) throw new Error("DEE1205_FRESH_SYNTHETIC_DATABASE_REQUIRED");
    const syntheticDdl = readFileSync("docs/plans/dee-1205-scheduled-noncapital-owner.sql", "utf8");
    await ownerSql.unsafe(syntheticDdl).simple();
  }, 30_000);

  beforeEach(async () => {
    currentOrg = await seedOrganization("DEE-1205 scheduled synthetic owner");
  }, 30_000);

  afterEach(async () => {
    await clearReceiptTrigger();
    await clearSlowReceiptTrigger();
    for (const restore of mockedGlobals.splice(0)) restore();
  });

  afterAll(async () => {
    await Promise.all([ownerSql?.end({ timeout: 5 }), witnessSql?.end({ timeout: 5 })]);
  }, 15_000);

  it("keeps the disabled scheduled owner as a no-op without requiring a database or market input", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const result = await runScheduledNoncapitalPaperLoopFromEnv({
        PAPER_LOOP_ENABLED: "0",
        DATABASE_URL_POSTGRES: "deliberately-not-a-url",
      });
      expect(result).toEqual({ status: "NOOP_DISABLED", report: null });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await counts()).toEqual({ receipts: 0, limits: 0, orders: 0, events: 0, fills: 0,
        allowances: 0, plans: 0, attempts: 0, audit: 0 });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects a pool miscast as a held transaction and commits through the real closed owner", async () => {
    expect(() => createOrdinaryPaperOrderRepositoryFromExecutorPostgres(
      db as never, currentOrg, "paper",
    )).toThrow("ORDINARY_PAPER_HELD_TRANSACTION_REQUIRED");

    installPublicPoll();
    const telemetry = vi.spyOn(console, "info").mockImplementation(() => {});
    const visibleAtCompletion: Array<Promise<number>> = [];
    telemetry.mockImplementation((line) => {
      if (String(line).includes('"phase":"cycle_complete"')) {
        visibleAtCompletion.push(counts().then((actual) => actual.receipts));
      }
    });
    const result = await runScheduledNoncapitalPaperLoopFromEnv(envFor(currentOrg));
    expect(["blocked", "skipped_no_signal"]).toContain(result.report?.outcome);
    expect(result.report?.strategySubmittedCount).toBe(0);
    expect(result.report?.startupReconciledOrders).toBe(0);
    expect(result.status).toBe("COMMITTED");
    expect((await Promise.all(visibleAtCompletion)).every((visible) => visible === 1)).toBe(true);
    expect(visibleAtCompletion).toHaveLength(1);
    expect(await counts()).toEqual({ receipts: 1, limits: 1, orders: 0, events: 0, fills: 0,
      allowances: 0, plans: 0, attempts: 0, audit: 0 });
    await expectNoExecutionEffects();
  }, 45_000);

  it("serializes mixed-case UUID callers, persists one receipt, and serves an exact retry", async () => {
    installPublicPoll({ waitForTwoKlineRequests: true });
    await ownerSql.unsafe(`
      CREATE FUNCTION public.dee1205_native_slow_receipt_v1() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.organization_id='${currentOrg}'::uuid THEN PERFORM pg_sleep(1.2); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER dee1205_native_slow_receipt_v1 BEFORE INSERT
      ON public.${RECEIPT_TABLE} FOR EACH ROW
      EXECUTE FUNCTION public.dee1205_native_slow_receipt_v1();
    `).simple();
    slowTriggerInstalled = true;
    const lower = currentOrg.toLowerCase();
    const upper = currentOrg.toUpperCase();
    expect(upper).not.toBe(lower);
    const results = await Promise.all([
      runScheduledNoncapitalPaperLoopFromEnv(envFor(lower)),
      runScheduledNoncapitalPaperLoopFromEnv(envFor(upper)),
    ]);
    expect(results.filter((result) => result.status === "COMMITTED")).toHaveLength(1);
    expect(results.filter((result) => result.status === "BUSY" || result.status === "REPLAYED")).toHaveLength(1);
    const retry = await runScheduledNoncapitalPaperLoopFromEnv(envFor(upper));
    expect(retry.status).toBe("REPLAYED");
    expect(await counts()).toEqual({ receipts: 1, limits: 1, orders: 0, events: 0, fills: 0,
      allowances: 0, plans: 0, attempts: 0, audit: 0 });
    await expectNoExecutionEffects();
    await clearSlowReceiptTrigger();
  }, 45_000);

  it("refuses changed same-bar input and does not create a second receipt or execution effect", async () => {
    const fixedNowMs = Date.now();
    installPublicPoll({ fixedNowMs });
    const first = await runScheduledNoncapitalPaperLoopFromEnv(envFor(currentOrg));
    expect(first.status).toBe("COMMITTED");
    for (const restore of mockedGlobals.splice(0)) restore();
    installPublicPoll({ alteredLatestClose: 103, fixedNowMs });
    await expect(runScheduledNoncapitalPaperLoopFromEnv(envFor(currentOrg))).rejects.toMatchObject({
      name: "ScheduledNoncapitalOwnerRefusedError",
      reason: "SCHEDULED_PAPER_SAME_BAR_CONFLICT",
    });
    expect((await counts()).receipts).toBe(1);
    await expectNoExecutionEffects();
  }, 45_000);

  it("rolls back risk initialization and receipt on an actual receipt-write failure, with no completion telemetry", async () => {
    installPublicPoll();
    await installReceiptTrigger("RAISE EXCEPTION 'DEE1205_TEST_RECEIPT_WRITE_FAILURE';");
    const telemetry = vi.spyOn(console, "info").mockImplementation(() => {});
    await expect(runScheduledNoncapitalPaperLoopFromEnv(envFor(currentOrg))).rejects.toThrow("DEE1205_TEST_RECEIPT_WRITE_FAILURE");
    expect(telemetry.mock.calls.some(([line]) => String(line).includes('"phase":"cycle_complete"'))).toBe(false);
    expect(await counts()).toEqual({ receipts: 0, limits: 0, orders: 0, events: 0, fills: 0,
      allowances: 0, plans: 0, attempts: 0, audit: 0 });
  }, 45_000);

  it("refuses a stale polled bar before initialization or receipt persistence", async () => {
    installPublicPoll({ timeOffsetMs: -2 * 60 * 60 * 1000, freezeClock: false });
    await expect(runScheduledNoncapitalPaperLoopFromEnv(envFor(currentOrg))).rejects.toMatchObject({
      name: "ScheduledNoncapitalOwnerRefusedError",
      reason: "SCHEDULED_PAPER_POLL_STALE",
    } satisfies Partial<ScheduledNoncapitalOwnerRefusedError>);
    expect(await counts()).toEqual({ receipts: 0, limits: 0, orders: 0, events: 0, fills: 0,
      allowances: 0, plans: 0, attempts: 0, audit: 0 });
  }, 45_000);

  it("confirms a real commit after the loopback proxy withholds its COMMIT acknowledgment", async () => {
    installPublicPoll();
    const direct = new URL(url!);
    const proxy = await startCommitAckLossProxy({ targetHost: "127.0.0.1", targetPort: Number(direct.port) });
    try {
      direct.hostname = "127.0.0.1";
      direct.port = String(proxy.port);
      direct.searchParams.set("sslmode", "disable");
      const telemetry = vi.spyOn(console, "info").mockImplementation(() => {});
      const result = await runScheduledNoncapitalPaperLoopFromEnv(envFor(currentOrg, direct.toString()));
      expect(result.status).toBe("CONFIRMED_AFTER_UNCERTAINTY");
      expect(proxy.stats()).toEqual({ connections: expect.any(Number), commitResponsesWithheld: 1, protocolErrors: 0 });
      expect((await counts()).receipts).toBe(1);
      await expectNoExecutionEffects();
      expect(telemetry.mock.calls.some(([line]) => String(line).includes('"phase":"cycle_complete"'))).toBe(false);
    } finally {
      await proxy.close();
    }
  }, 45_000);

  it("bounds post-COMMIT uncertainty when verifier startups receive repeated clean EOF (DEE-1213)", async () => {
    installPublicPoll();
    const direct = new URL(url!);
    const proxy = await startCommitAckLossProxy({
      targetHost: "127.0.0.1",
      targetPort: Number(direct.port),
      refuseReconnectAfterCommitLoss: true,
      cleanEofOnRefusedReconnect: true,
    });
    direct.hostname = "127.0.0.1";
    direct.port = String(proxy.port);
    direct.searchParams.set("sslmode", "disable");
    const telemetry = vi.spyOn(console, "info").mockImplementation(() => {});

    type OwnerOutcome =
      | { readonly kind: "resolved"; readonly result: Awaited<ReturnType<typeof runScheduledNoncapitalPaperLoopFromEnv>> }
      | { readonly kind: "rejected"; readonly error: unknown };
    type GuardOutcome = { readonly kind: "attempt-limit" | "watchdog" };
    let interval: ReturnType<typeof setInterval> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let ownerOutcome: Promise<OwnerOutcome> | undefined;
    let observed: { readonly outcome: OwnerOutcome | GuardOutcome; readonly proxy: ReturnType<typeof proxy.stats>; readonly durable: Counts } | undefined;
    try {
      ownerOutcome = runScheduledNoncapitalPaperLoopFromEnv(envFor(currentOrg, direct.toString())).then(
        (result): OwnerOutcome => ({ kind: "resolved", result }),
        (error): OwnerOutcome => ({ kind: "rejected", error }),
      );
      const attemptLimit = new Promise<GuardOutcome>((resolve) => {
        interval = setInterval(() => {
          if (proxy.stats().connections > 6) resolve({ kind: "attempt-limit" });
        }, 10);
      });
      const outerWatchdog = new Promise<GuardOutcome>((resolve) => {
        watchdog = setTimeout(() => resolve({ kind: "watchdog" }), 65_000);
      });
      const outcome = await Promise.race([ownerOutcome, attemptLimit, outerWatchdog]);
      observed = { outcome, proxy: proxy.stats(), durable: await counts() };
      // Synthetic witness facts survive an externally contained pre-fix RED.
      console.log(JSON.stringify({ event: "dee1213_native_observation", ...observed,
        outcome: { kind: outcome.kind } }));

      // Capture the facts demonstrating the real upstream commit before the
      // attempt-bound assertion can fail on the original retry loop.
      expect(observed.proxy.commitResponsesWithheld).toBe(1);
      expect(observed.proxy.protocolErrors).toBe(0);
      expect(observed.durable.receipts).toBe(1);
      expect(observed.durable.limits).toBe(1);
      await expectNoExecutionEffects();

      expect(observed.outcome.kind).toBe("resolved");
      expect(observed.proxy.connections).toBeLessThanOrEqual(6);
      if (observed.outcome.kind !== "resolved") return;
      expect(observed.outcome.result).toMatchObject({ status: "COMMIT_UNCERTAIN", report: null });
      expect(telemetry.mock.calls.some(([line]) => String(line).includes('"phase":"cycle_complete"'))).toBe(false);

      const settledAttempts = proxy.stats().connections;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      expect(proxy.stats().connections).toBe(settledAttempts);
      const retry = await runScheduledNoncapitalPaperLoopFromEnv(envFor(currentOrg));
      expect(retry.status).toBe("REPLAYED");
      expect(await counts()).toEqual(observed.durable);
      await expectNoExecutionEffects();
    } finally {
      if (interval) clearInterval(interval);
      if (watchdog) clearTimeout(watchdog);
      await proxy.close();
      // GREEN requires the owned work to have actually settled. An external
      // process watchdog contains the known pre-fix RED; it is never PASS.
      if (ownerOutcome) await ownerOutcome;
    }
  }, 70_000);

  it("preserves full historical rows, rejects half-tagged writes, and refuses ordinary paper orders", async () => {
    const historicalId = await insertOrder({ venue: "mock", executionMode: "mock", state: "ACCEPTED",
      historicalRunId: "historical-run", historicalAccountKey: "historical-account" });
    // The current DB check constraint and historical-scope trigger reject a
    // half-tagged row at insertion, so no unreachable corrupt row is forged.
    await expect(insertOrder({ venue: "HTX", executionMode: "paper", state: "ACCEPTED",
      historicalAccountKey: "orphaned-history-tag" })).rejects.toThrow("HISTORICAL_RECONCILIATION_REFUSED:PARTIAL_SCOPE");
    expect((await counts()).orders).toBe(1);
    const before = await witnessSql<{ id: string; state: string; historical_run_id: string | null; historical_account_key: string | null }[]>`
      SELECT id,state,historical_run_id,historical_account_key FROM public.trader_orders
      WHERE organization_id=${currentOrg}::uuid ORDER BY id
    `;
    installPublicPoll();
    const allowed = await runScheduledNoncapitalPaperLoopFromEnv(envFor(currentOrg));
    expect(allowed.status).toBe("COMMITTED");
    const after = await witnessSql<typeof before[number][]>`
      SELECT id,state,historical_run_id,historical_account_key FROM public.trader_orders
      WHERE organization_id=${currentOrg}::uuid ORDER BY id
    `;
    expect(after).toEqual(before);
    expect(after.map((row) => row.id)).toEqual([historicalId]);

    for (const state of ["ACCEPTED", "FILLED"] as const) {
      const ordinaryOrg = await seedOrganization(`DEE-1205 ordinary ${state} refusal`);
      const savedOrg = currentOrg;
      currentOrg = ordinaryOrg;
      const ordinaryId = await insertOrder({ venue: "HTX", executionMode: "paper", state });
      const beforeRows = await witnessSql<{ id: string; state: string }[]>`
        SELECT id,state FROM public.trader_orders WHERE organization_id=${ordinaryOrg}::uuid
      `;
      const beforeEvents = await witnessSql<{ order_id: string; seq: number; to_state: string }[]>`
        SELECT order_id,seq,to_state FROM public.trader_order_events WHERE organization_id=${ordinaryOrg}::uuid
      `;
      await expect(runScheduledNoncapitalPaperLoopFromEnv(envFor(ordinaryOrg))).rejects.toMatchObject({
        name: "ScheduledNoncapitalOwnerRefusedError",
        reason: "SCHEDULED_PAPER_ORDINARY_RECOVERY_REQUIRED",
      } satisfies Partial<ScheduledNoncapitalOwnerRefusedError>);
      expect(await witnessSql<{ id: string; state: string }[]>`
        SELECT id,state FROM public.trader_orders WHERE organization_id=${ordinaryOrg}::uuid
      `).toEqual(beforeRows);
      expect(await witnessSql<{ order_id: string; seq: number; to_state: string }[]>`
        SELECT order_id,seq,to_state FROM public.trader_order_events WHERE organization_id=${ordinaryOrg}::uuid
      `).toEqual(beforeEvents);
      expect(beforeRows.map((row) => row.id)).toEqual([ordinaryId]);
      expect((await counts(ordinaryOrg))).toEqual({ receipts: 0, limits: 0, orders: 1, events: 1, fills: 0,
        allowances: 0, plans: 0, attempts: 0, audit: 0 });
      currentOrg = savedOrg;
    }
  }, 60_000);

  it("allows two different organizations to commit concurrently under separate fixed-domain locks", async () => {
    installPublicPoll({ waitForTwoKlineRequests: true });
    const organizationA = currentOrg;
    const organizationB = await seedOrganization("DEE-1205 independent organization");
    await ownerSql.unsafe(`
      CREATE FUNCTION public.dee1205_native_slow_receipt_v1() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.organization_id IN ('${organizationA}'::uuid,'${organizationB}'::uuid) THEN
          PERFORM pg_sleep(1.2);
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER dee1205_native_slow_receipt_v1 BEFORE INSERT
      ON public.${RECEIPT_TABLE} FOR EACH ROW
      EXECUTE FUNCTION public.dee1205_native_slow_receipt_v1();
    `).simple();
    slowTriggerInstalled = true;
    const results = await Promise.all([
      runScheduledNoncapitalPaperLoopFromEnv(envFor(organizationA)),
      runScheduledNoncapitalPaperLoopFromEnv(envFor(organizationB)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["COMMITTED", "COMMITTED"]);
    expect((await counts(organizationA)).receipts).toBe(1);
    expect((await counts(organizationB)).receipts).toBe(1);
    await expectNoExecutionEffects(organizationA);
    await expectNoExecutionEffects(organizationB);
  }, 60_000);
});
