import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as executionRepository from "@/lib/trader/execution/v2/repository-postgres";
import { catchUpExecutionRealityV2Postgres } from "@/lib/trader/reality/v2/execution-report-delivery-postgres";
import { routeRealityIngressV2 } from "@/lib/trader/reality/v2/ingress";
import { ingestRealitySourceReportV2Postgres } from "@/lib/trader/reality/v2/ingest-postgres";
import { appendRealitySourceObservationV2FromWriter, appendObservedRealityTruthV2FromWriter,
  listRealitySourceReportsV2, listTruthRecordsV2, listRealityEventsV2, lockRealityScopeV2,
  readLatestRealityProjectionV2 } from "@/lib/trader/reality/v2/repository-postgres";
import { persistDeliveryAttempt } from "../helpers/execution-reality-delivery-fixture";
import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER = "00000000-0000-4000-8000-000000112201";
const OTHER = "00000000-0000-4000-8000-000000112202";
const realityTables = ["trader_reality_source_reports_v2", "trader_reality_truth_records_v2", "trader_reality_events_v2", "trader_reality_projections_v2"] as const;
const executionTables = ["trader_execution_reports_v2", "trader_execution_attempts_v2", "trader_execution_plans_v2", "trader_execution_policies_v2"] as const;
const riskTables = ["trader_risk_enforcement_events_v2", "trader_risk_allowances_v2", "trader_risk_verdicts_v2"] as const;
const appendOnlyTables = [...realityTables, ...executionTables, ...riskTables] as const;
const cleanupOrder: readonly string[] = [...[...realityTables].reverse(),
  "trader_reality_knowledge_frontiers_v2", ...executionTables, "trader_risk_enforcement_events_v2", "trader_risk_allowances_v2",
  "trader_orders", "trader_risk_verdicts_v2", "trader_risk_account_state_v2",
];
async function clean(client: postgres.Sql, organizationId: string) {
  // Isolated native fixture teardown only; never called by delivery code.
  for (const table of appendOnlyTables) await client.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
  try { for (const table of cleanupOrder) await client.unsafe(`DELETE FROM ${table} WHERE organization_id=$1::uuid`, [organizationId]); }
  finally { for (const table of [...appendOnlyTables].reverse()) await client.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`); }
}
function child(args: string[]) {
  return new Promise<{ status: number | null; out: string; err: string }>((resolve, reject) => {
    const proc = spawn(process.execPath, ["--import", "tsx", "--require", "./scripts/trader/trader-cli-server-only-prelude.cjs", "--conditions=react-server",
      "scripts/trader/reality-execution-report-catch-up.ts", ...args], { cwd: process.cwd(), env: {
      ...process.env, WAIA_TRADER_CLI: "1", WAIA_DB_BACKEND: "postgres", WAIA_POSTGRES_PER_REQUEST_CLIENT: "false",
    }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; const timer = setTimeout(() => { proc.kill(); reject(new Error("bounded child deadline")); }, 15_000);
    proc.stdout.on("data", (data) => { out += data; }); proc.stderr.on("data", (data) => { err += data; });
    proc.on("error", (error) => { clearTimeout(timer); reject(error); });
    proc.on("close", (status) => { clearTimeout(timer); resolve({ status, out, err }); });
  });
}

describe.skipIf(!enabled || !url)("DEE1122 native committed Execution report delivery", () => {
  let client: postgres.Sql, db: WaiaPostgresDb, org: string, other: string;
  beforeAll(async () => {
    client = postgres(url!, { max: 8 }); db = drizzle(client, { schema: pgSchema }) as WaiaPostgresDb;
    for (const user of [USER, OTHER]) { await clean(client, personalOrganizationIdFromUserId(user)); await cleanupWp13Org(url!, user); }
    org = await seedWp13User(url!, USER, "DEE1122 local synthetic report delivery");
    other = await seedWp13User(url!, OTHER, "DEE1122 isolated other scope");
  }, 120_000);
  beforeEach(async () => { await clean(client, org); await clean(client, other); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("provider forbidden"); })); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  afterAll(async () => {
    if (client) { for (const id of [org, other].filter(Boolean)) await clean(client, id); await client.end({ timeout: 5 }); }
    for (const user of [USER, OTHER]) await cleanupWp13Org(url!, user);
  }, 120_000);
  const scope = (accountId = "delivery-fixture") => ({ organizationId: org, accountId });
  async function fixture(accountId = "delivery-fixture") {
    const value = await persistDeliveryAttempt(db, org, accountId);
    return { ...value, input: { ...scope(accountId), executionAttemptId: value.attempt.executionAttemptId } };
  }
  async function append(value: Awaited<ReturnType<typeof fixture>>, rawObservation: Readonly<Record<string, unknown>> = { committed: true }) {
    return executionRepository.appendExecutionReportV2Postgres(db, { organizationId: org }, {
      accountId: value.accountId, executionAttemptId: value.attempt.executionAttemptId, executionReportId: randomUUID(),
      reportType: "ATTEMPT_BOUND", source: "EXECUTION", rawObservation, observedAtUtc: "2026-08-21T00:00:00.002Z",
    });
  }
  const route = (report: Awaited<ReturnType<typeof append>>) => {
    const result = routeRealityIngressV2({ kind: "EXECUTION_REPORT_V2", report });
    if (result.status !== "ADMITTED") throw new Error("fixture route refused"); return result.drafts;
  };
  async function snapshot(organizationId = org) {
    const result: Record<string, unknown> = {};
    for (const table of [...appendOnlyTables, "trader_reality_knowledge_frontiers_v2", "trader_orders", "trader_risk_account_state_v2"]) {
      result[table] = await client.unsafe(`SELECT to_jsonb(t) AS body FROM ${table} t WHERE organization_id=$1::uuid ORDER BY to_jsonb(t)::text`, [organizationId]);
    }
    return result;
  }
  function financialSnapshot(value: Awaited<ReturnType<typeof snapshot>>) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("trader_reality_")));
  }
  it("distinguishes a durable reportless attempt from delivery and leaves existing Reality unexamined", async () => {
    const value = await fixture(); const before = await snapshot();
    expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ status: "NO_REPORTS", capturedHead: { reportSequence: "0", reportDigestHex: null }, realityExamined: false, projection: null });
    expect(await snapshot()).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });
  it("closes the stored-report delivery gap, preserves every Execution/risk row and repeats exact identities", async () => {
    const value = await fixture(); const report = await append(value); const before = await snapshot();
    expect(await listRealitySourceReportsV2(db, scope())).toHaveLength(0);
    const result = await catchUpExecutionRealityV2Postgres(db, value.input);
    expect(result).toMatchObject({ status: "DELIVERED", selectedReports: 1, selectedDrafts: 1, newSources: 1, newEvents: 1,
      capturedHead: { reportSequence: "1", reportDigestHex: report.contentDigestHex }, authority: "OBSERVATION_DELIVERY_ONLY" });
    const after = await snapshot(); expect(financialSnapshot(after)).toEqual(financialSnapshot(before));
    const repeat = await catchUpExecutionRealityV2Postgres(db, value.input);
    expect(repeat).toMatchObject({ status: "DELIVERED", newSources: 0, existingSources: 1, newEvents: 0, existingEvents: 1 });
    expect(await snapshot()).toEqual(after); expect(fetch).not.toHaveBeenCalled();
  });
  it("reconstructs after connection recreation and through the actual CLI child without a connector", async () => {
    const value = await fixture(); await append(value); await catchUpExecutionRealityV2Postgres(db, value.input);
    const before = await snapshot(); const fresh = postgres(url!, { max: 1 });
    try { expect(await catchUpExecutionRealityV2Postgres(drizzle(fresh, { schema: pgSchema }) as WaiaPostgresDb, value.input)).toMatchObject({ status: "DELIVERED", newSources: 0 }); }
    finally { await fresh.end({ timeout: 5 }); }
    const run = await child(["--organization-id", org, "--account-id", value.accountId, "--execution-attempt-id", value.attempt.executionAttemptId]);
    expect(run.status, run.err).toBe(0); expect(JSON.parse(run.out)).toMatchObject({ result: { status: "DELIVERED", newSources: 0 }, cleanup: "CLOSED" });
    expect(await snapshot()).toEqual(before);
  });
  it("refuses a real held Drizzle transaction before reads, including savepoint-capable handles", async () => {
    const value = await fixture(); await append(value); const before = await snapshot();
    await db.transaction(async (tx) => {
      expect(typeof tx.transaction).toBe("function");
      const observed = vi.spyOn(tx, "execute");
      expect(await catchUpExecutionRealityV2Postgres(tx as unknown as WaiaPostgresDb, value.input)).toMatchObject({ status: "REFUSED", code: "TRANSACTION_OWNER_REQUIRED" });
      expect(observed).not.toHaveBeenCalled();
    });
    expect(await snapshot()).toEqual(before);
  });
  it.each(["foreign-org", "foreign-account", "uppercase", "braced", "hyphenless", "whitespace"])("refuses scope %s without effect", async (kind) => {
    const value = await fixture(); await append(value); const before = await snapshot(); const input = { ...value.input };
    if (kind === "foreign-org") input.organizationId = other;
    if (kind === "foreign-account") input.accountId = "other-account";
    if (kind === "uppercase") input.organizationId = org.toUpperCase();
    if (kind === "braced") input.organizationId = `{${org}}`;
    if (kind === "hyphenless") input.organizationId = org.replaceAll("-", "");
    if (kind === "whitespace") input.accountId += " ";
    expect(await catchUpExecutionRealityV2Postgres(db, input)).toMatchObject({ status: "REFUSED" });
    expect(await snapshot()).toEqual(before);
  });
  it.each(["paper", "mock", "historical", "venue"])("refuses stored unsupported %s metadata", async (kind) => {
    const value = await fixture(); await append(value);
    if (kind === "historical") await client`UPDATE trader_orders SET historical_account_key='synthetic-history' WHERE id=${value.attempt.orderId}::uuid`;
    else if (kind === "venue") await client`UPDATE trader_orders SET venue='OTHER' WHERE id=${value.attempt.orderId}::uuid`;
    else await client`UPDATE trader_orders SET execution_mode=${kind} WHERE id=${value.attempt.orderId}::uuid`;
    const before = await snapshot(); expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ code: "UNSUPPORTED_SOURCE_SCOPE" });
    expect(await snapshot()).toEqual(before);
  });
  it("refuses mismatched sealed order binding instead of dispatching or repairing", async () => {
    const value = await fixture(); await append(value); await client`UPDATE trader_orders SET quantity='0.002' WHERE id=${value.attempt.orderId}::uuid`;
    const before = await snapshot(); expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ code: "SOURCE_BINDING_INVALID" });
    expect(await snapshot()).toEqual(before);
  });
  it("delivers a partly delivered prefix from report1 with original source knowledge preserved", async () => {
    const value = await fixture(); const one = await append(value); await append(value);
    for (const draft of route(one)) await ingestRealitySourceReportV2Postgres(db, scope(), draft);
    const original = await listRealitySourceReportsV2(db, scope());
    expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ status: "DELIVERED", selectedReports: 2, newSources: 1, existingSources: 1 });
    const after = await listRealitySourceReportsV2(db, scope()); expect(after).toEqual(expect.arrayContaining(original));
  });
  it("refuses source-only target and missing projection before duplicate ingestion can repair them", async () => {
    const value = await fixture(); const report = await append(value);
    await db.transaction(async (tx) => { await lockRealityScopeV2(tx, scope()); await appendRealitySourceObservationV2FromWriter(tx, scope(), route(report)[0]!); });
    let before = await snapshot(); expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ code: "DELIVERY_INCOMPLETE" }); expect(await snapshot()).toEqual(before);
    const [source] = await listRealitySourceReportsV2(db, scope());
    await db.transaction(async (tx) => { await lockRealityScopeV2(tx, scope()); await appendObservedRealityTruthV2FromWriter(tx, scope(), source!); });
    before = await snapshot(); expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ code: "REALITY_BASELINE_INVALID" }); expect(await snapshot()).toEqual(before);
  });
  it("refuses a lagged projection before adding any new selected source", async () => {
    const value = await fixture(); const first = await append(value); for (const draft of route(first)) await ingestRealitySourceReportV2Postgres(db, scope(), draft);
    const second = await append(value);
    await db.transaction(async (tx) => { await lockRealityScopeV2(tx, scope()); const source = await appendRealitySourceObservationV2FromWriter(tx, scope(), route(second)[0]!); await appendObservedRealityTruthV2FromWriter(tx, scope(), source.report); });
    const before = await snapshot(); expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ code: "REALITY_BASELINE_INVALID" }); expect(await snapshot()).toEqual(before);
  });
  it("keeps reportless result distinct even when that account contains an unexplained source", async () => {
    const old = await fixture(); const report = await append(old);
    await db.transaction(async (tx) => { await lockRealityScopeV2(tx, scope()); await appendRealitySourceObservationV2FromWriter(tx, scope(), route(report)[0]!); });
    // A second real attempt in a different account tests reportless no-source-examination without rebinding first attempt.
    const empty = await fixture("empty-target");
    expect(await catchUpExecutionRealityV2Postgres(db, empty.input)).toMatchObject({ status: "NO_REPORTS", realityExamined: false });
    expect(await catchUpExecutionRealityV2Postgres(db, old.input)).toMatchObject({ code: "DELIVERY_INCOMPLETE" });
  });
  it.each(["source", "truth", "event", "projection", "knowledge"])("rolls back all new Reality work on injected native %s failure", async (kind) => {
    const value = await fixture(); await append(value); await append(value); const before = await snapshot();
    const table = kind === "knowledge" ? "trader_reality_knowledge_frontiers_v2" : `trader_reality_${kind === "source" ? "source_reports" : kind === "truth" ? "truth_records" : kind === "event" ? "events" : "projections"}_v2`;
    await client.unsafe(`CREATE OR REPLACE FUNCTION dee1122_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DEE1122 injected storage fault'; END $$`);
    await client.unsafe(`CREATE TRIGGER zzz_dee1122_fault BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION dee1122_fault()`);
    try { expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ status: "FAILED", newDeliveryCommitted: false }); expect(await snapshot()).toEqual(before); }
    finally { await client.unsafe(`DROP TRIGGER zzz_dee1122_fault ON ${table}`); await client.unsafe("DROP FUNCTION dee1122_fault()"); }
    expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ status: "DELIVERED", newSources: 2 });
  });
  it("reports unknown commit acknowledgement and exact retry discovers already committed observations", async () => {
    const value = await fixture(); await append(value); const original = db.transaction.bind(db);
    const wrapped = vi.spyOn(db, "transaction").mockImplementation(async (callback, options) => { await original(callback, options); throw new Error("synthetic lost commit acknowledgement"); });
    expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ status: "COMMIT_OUTCOME_UNKNOWN", newDeliveryCommitted: "UNKNOWN" });
    wrapped.mockRestore(); const committed = await snapshot();
    expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ status: "DELIVERED", newSources: 0 }); expect(await snapshot()).toEqual(committed);
  });
  it("caps oversized stored report bodies before producing any Reality row", async () => {
    const value = await fixture(); await append(value, { payload: "x".repeat(1_048_576) }); const before = await snapshot();
    expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ code: "CAPACITY_EXCEEDED", detail: { bound: "reportRowBytes" } }); expect(await snapshot()).toEqual(before);
  });
  it("accepts a captured prefix while a later report commits above the captured head", async () => {
    const value = await fixture(); const first = await append(value);
    const original = executionRepository.readExecutionAttemptProjectionV2Postgres;
    let appended = false;
    const spy = vi.spyOn(executionRepository, "readExecutionAttemptProjectionV2Postgres").mockImplementation(async (...args) => {
      const saved = await original(...args); if (!appended) { appended = true; await append(value); } return saved;
    });
    expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ status: "DELIVERED", selectedReports: 1, capturedHead: { reportDigestHex: first.contentDigestHex } });
    spy.mockRestore(); expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ status: "DELIVERED", selectedReports: 2, newSources: 1 });
  });
  it("retains append-only guards on delivered source, truth, event and projection", async () => {
    const value = await fixture(); await append(value); await catchUpExecutionRealityV2Postgres(db, value.input);
    for (const table of realityTables) {
      await expect(client.unsafe(`DELETE FROM ${table} WHERE organization_id=$1::uuid`, [org])).rejects.toThrow(/append.only/i);
      await expect(client.unsafe(`UPDATE ${table} SET account_id=account_id WHERE organization_id=$1::uuid`, [org])).rejects.toThrow(/append.only/i);
    }
  });
  it("serializes two owners through675 under RR session defaults and copies input before the wait", async () => {
    const value = await fixture(); await append(value);
    const workerClient = postgres(url!, { max: 1, connection: { application_name: "dee1122-waiter", default_transaction_isolation: "repeatable read" } });
    const worker = drizzle(workerClient, { schema: pgSchema }) as WaiaPostgresDb;
    let release!: () => void, locked!: () => void;
    const holding = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = db.transaction(async (tx) => { await lockRealityScopeV2(tx, scope()); locked(); await holding; });
    await ready; const mutable = { ...value.input }; const pending = catchUpExecutionRealityV2Postgres(worker, mutable);
    mutable.accountId = "changed-during-await";
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await client`SELECT 1 FROM pg_stat_activity WHERE application_name='dee1122-waiter' AND wait_event='advisory'`;
        if (rows.length) { waiting = true; break; } await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      // Other scope progresses while this account remains locked.
      const different = await fixture("other-progress"); await append(different);
      expect(await catchUpExecutionRealityV2Postgres(db, different.input)).toMatchObject({ status: "DELIVERED" });
      release(); await blocker;
      expect(await pending).toMatchObject({ status: "DELIVERED", accountId: value.accountId });
      const pair = await Promise.all([catchUpExecutionRealityV2Postgres(db, value.input), catchUpExecutionRealityV2Postgres(worker, value.input)]);
      expect(pair).toEqual([expect.objectContaining({ status: "DELIVERED", newSources: 0 }), expect.objectContaining({ status: "DELIVERED", newSources: 0 })]);
      expect(await listRealityEventsV2(db, scope())).toHaveLength(1);
    } finally { release(); await blocker; await pending; await workerClient.end({ timeout: 5 }); }
  });
  it("retains only OBSERVED fill evidence, never SETTLED or realized cashflows", async () => {
    const value = await fixture(); await append(value);
    await executionRepository.appendExecutionReportV2Postgres(db, { organizationId: org }, {
      accountId: value.accountId, executionAttemptId: value.attempt.executionAttemptId, executionReportId: randomUUID(),
      reportType: "SUBMIT_STARTED", source: "EXECUTION", rawObservation: {}, observedAtUtc: "2026-08-21T00:00:00.003Z",
    });
    const order = { orderId: "local-fixture-venue-id", clientOrderId: value.attempt.clientOrderId, symbol: "BTCUSDT", side: "buy", type: "limit", price: "25000", quantity: "0.001", filledQuantity: "0.001", status: "filled" };
    await executionRepository.appendExecutionReportV2Postgres(db, { organizationId: org }, {
      accountId: value.accountId, executionAttemptId: value.attempt.executionAttemptId, executionReportId: randomUUID(),
      reportType: "FILL_REPORT_OBSERVED", source: "CONNECTOR", venueOrderId: order.orderId,
      rawObservation: { order, trades: [{ tradeId: "local-trade", orderId: order.orderId, clientOrderId: order.clientOrderId, symbol: "BTCUSDT", side: "buy", price: "25000", quantity: "0.001", fee: "0", feeAsset: "USDT", executedAt: "2026-08-21T00:00:00.004Z" }] },
      observedAtUtc: "2026-08-21T00:00:00.004Z",
    });
    expect(await catchUpExecutionRealityV2Postgres(db, value.input)).toMatchObject({ status: "DELIVERED", selectedReports: 3, selectedDrafts: 4 });
    const truths = await listTruthRecordsV2(db, scope()); expect(truths.filter((t) => t.primitiveAssertion.kind === "FILL")).toHaveLength(1);
    expect(truths.find((t) => t.primitiveAssertion.kind === "FILL")!.primitiveAssertion).toMatchObject({ settlementStatus: "OBSERVED", feeAmount: "0" });
    expect(truths.some((t) => t.primitiveAssertion.kind === "REALIZED_CASHFLOW")).toBe(false);
    expect((await readLatestRealityProjectionV2(db, scope()))!.uncertainties).toHaveLength(0);
  });
});
