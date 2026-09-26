import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { seedWp13User } from "./wp13-intelligence-test-helpers";
import { handleAdminReportingPeriodCommandPost } from "@/lib/trader/billing/admin-route-handler";
import { createPostgresHwmLedgerService } from "@/lib/trader/billing/hwm-ledger-service";
import { createPostgresReportingPeriodLifecycleService } from "@/lib/trader/billing/reporting-period-lifecycle-service";
import { persistBillingRealityFixture } from "@/tests/helpers/billing-reality-postgres";
import { traderAuditActions } from "@/lib/trader/types";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES;
const start = new Date("2026-01-01T00:00:00.000Z");
const end = new Date("2026-02-01T00:00:00.000Z");
const faultCases = [
  { name: "after period UPDATE / before close audit", table: "audit_logs", timing: "BEFORE", action: traderAuditActions.reportingPeriodClosed },
  { name: "after close audit", table: "audit_logs", timing: "AFTER", action: traderAuditActions.reportingPeriodClosed },
  { name: "after draft INSERT", table: "trader_invoices", timing: "AFTER", action: null },
  { name: "before draft audit", table: "audit_logs", timing: "BEFORE", action: traderAuditActions.invoiceDraftGenerated },
  { name: "after draft audit", table: "audit_logs", timing: "AFTER", action: traderAuditActions.invoiceDraftGenerated },
] as const;

describe.skipIf(!enabled)("DEE-1112 actual Postgres reporting-period command atomicity", () => {
  let sql: postgres.Sql;
  let orgId: string;
  let otherOrg: string;
  const adminId = randomUUID();
  const memberId = randomUUID();
  beforeAll(async () => {
    if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
      throw new Error("DEE1112_NATIVE_TESTS_REQUIRE_LOOPBACK_POSTGRES");
    }
    sql = postgres(url, { max: 2, onnotice: () => {} });
    orgId = await seedWp13User(url, adminId, "DEE-1112 synthetic admin");
    otherOrg = await seedWp13User(url, memberId, "DEE-1112 synthetic member");
    await sql`UPDATE user_platform_roles SET role = 'admin' WHERE user_id = ${adminId}::uuid`;
  });
  afterAll(async () => {
    await removeFault();
    await sql?.end({ timeout: 5 });
    // Synthetic append-only rows stay in this disposable local/CI database.
  });

  const evidenceCache = new Map<string, ReturnType<typeof persistBillingRealityFixture>>();
  async function command(account: string, amount = "100", organizationId = orgId) {
    const key = JSON.stringify([organizationId, account, amount]);
    if (!evidenceCache.has(key)) evidenceCache.set(key, persistBillingRealityFixture(drizzle(sql, { schema }), {
      organizationId, accountId: account, periodStart: start, periodEnd: end, realizedPnl: amount, endingEquity: "10100", unrealizedPnl: "0" }));
    const evidence = await evidenceCache.get(key)!;
    return { command: "close-and-materialize", organization_id: organizationId,
      exchange_account_id: account, period_start: start.toISOString(), period_end: end.toISOString(),
      starting_equity: "10000", ending_equity: "10100", starting_snapshot_at: start.toISOString(),
      ending_snapshot_at: end.toISOString(), open_positions_snapshot_ref: "DEE-1112-synthetic-only",
      valuation_source: "DEE-1112-synthetic-only", unrealized_pnl: "0",
      realized_strategy_profit_receipt: evidence.realizedStrategyProfitReceipt,
      closed_trade_settlements: evidence.closedTradeSettlements, reality_dependencies: evidence.realityDependencies };
  }

  async function invoke(body: ReturnType<typeof command> | Awaited<ReturnType<typeof command>>, userId = adminId, connectionName = "dee1112-command") {
    const client = postgres(url!, { max: 1, connection: { application_name: connectionName } });
    const runtime = { kind: "postgres" as const, db: drizzle(client, { schema }) };
    try {
      return await handleAdminReportingPeriodCommandPost(new Request("http://localhost/api/trader/admin/reporting-periods/commands", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(await body),
      }), { getUserId: async () => userId, getRuntimeDb: async () => runtime,
        disposeRuntimeDb: async () => { await client.end({ timeout: 5 }); } });
    } finally { await client.end({ timeout: 5 }); }
  }
  async function seedOpen(account: string, organizationId = orgId) {
    const db = drizzle(sql, { schema });
    const context = { organizationId };
    await createPostgresHwmLedgerService(db).bootstrapHwm(context, {
      exchangeAccountId: account, initialHwm: "0", valuationSource: "DEE-1112-synthetic-only", effectiveAt: start,
    });
    return createPostgresReportingPeriodLifecycleService(db).openReportingPeriod(context, {
      exchangeAccountId: account, periodStart: start, startingEquity: "10000",
      openPositionsSnapshotRef: "DEE-1112-synthetic-only", valuationSource: "DEE-1112-synthetic-only", startingSnapshotAt: start,
    });
  }
  async function snapshot(account: string, organizationId = orgId) {
    const periods = await sql`SELECT id, status, record_content_digest, realized_pnl, ending_equity
      FROM trader_reporting_periods WHERE organization_id = ${organizationId}::uuid AND exchange_account_id = ${account} ORDER BY id`;
    const invoices = await sql`SELECT id, status, performance_fee, realized_fill_finality, record_content_digest
      FROM trader_invoices WHERE organization_id = ${organizationId}::uuid AND exchange_account_id = ${account} ORDER BY id`;
    const hwm = await sql`SELECT id, entry_type, high_water_mark, record_content_digest
      FROM trader_hwm_ledger WHERE organization_id = ${organizationId}::uuid AND exchange_account_id = ${account} ORDER BY id`;
    const audits = await sql`SELECT action, count(*)::int AS count FROM audit_logs
      WHERE organization_id = ${organizationId}::uuid AND metadata_json ->> 'exchangeAccountId' = ${account}
      GROUP BY action ORDER BY action`;
    return { periods: [...periods], invoices: [...invoices], hwm: [...hwm], audits: [...audits] };
  }
  async function removeFault() {
    if (!sql) return;
    await sql.unsafe("DROP TRIGGER IF EXISTS dee1112_injected_fault ON audit_logs");
    await sql.unsafe("DROP TRIGGER IF EXISTS dee1112_injected_fault ON trader_invoices");
    await sql.unsafe("DROP FUNCTION IF EXISTS dee1112_injected_fault()");
  }
  async function injectFault(fault: { table: "audit_logs" | "trader_invoices"; timing: "BEFORE" | "AFTER"; action: string | null }) {
    // Fixed allow-listed identifiers/actions and locally generated UUID; no external SQL content.
    if (!/^[a-f0-9-]{36}$/.test(orgId) || (fault.action && !/^[a-z._]+$/.test(fault.action))) throw new Error("Invalid fixture fault");
    await sql.unsafe(`CREATE FUNCTION dee1112_injected_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.organization_id = '${orgId}'::uuid ${fault.action ? `AND NEW.action = '${fault.action}'` : ""}
      THEN RAISE EXCEPTION 'DEE1112_INJECTED_FAILURE'; END IF; RETURN NEW; END $$`);
    await sql.unsafe(`CREATE TRIGGER dee1112_injected_fault ${fault.timing} INSERT ON ${fault.table}
      FOR EACH ROW EXECUTE FUNCTION dee1112_injected_fault()`);
  }

  for (const fault of faultCases) {
    it(`rolls back ${fault.name}, then retries once with the same canonical content`, async () => {
      const account = `dee1112-${randomUUID()}`;
      await seedOpen(account);
      const before = await snapshot(account);
      await injectFault(fault);
      try {
        const response = await invoke(command(account));
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ error: { message: expect.stringContaining("DEE1112_INJECTED_FAILURE") } });
        expect(await snapshot(account)).toEqual(before);
      } finally { await removeFault(); }
      expect((await invoke(command(account))).status).toBe(200);
      const accepted = await snapshot(account);
      expect(accepted.periods).toHaveLength(1);
      expect(accepted.periods[0]).toMatchObject({ id: before.periods[0]!.id, status: "CLOSED", realized_pnl: "100" });
      expect(accepted.invoices).toHaveLength(1);
      expect(accepted.invoices[0]).toMatchObject({ status: "DRAFT", performance_fee: "30", realized_fill_finality: false });
      expect(accepted.hwm).toEqual(before.hwm);
      expect(accepted.audits).toContainEqual({ action: traderAuditActions.reportingPeriodClosed, count: 1 });
      expect(accepted.audits).toContainEqual({ action: traderAuditActions.invoiceDraftGenerated, count: 1 });
      const repeated = await invoke(command(account));
      expect(repeated.status).toBe(400);
      expect(repeated.body).toMatchObject({ error: { message: "DUPLICATE_BILLING_PERIOD_SCOPE" } });
      expect(await snapshot(account)).toEqual(accepted);
    });
  }

  it.each([traderAuditActions.hwmBootstrapped, traderAuditActions.reportingPeriodOpened, traderAuditActions.invoiceDraftGenerated])(
    "rolls back conditional bootstrap/open and their audit when %s fails", async (action) => {
      const account = `dee1112-initial-${randomUUID()}`;
      const before = await snapshot(account);
      await injectFault({ table: "audit_logs", timing: "BEFORE", action });
      try {
        expect((await invoke(command(account))).status).toBe(400);
        expect(await snapshot(account)).toEqual(before);
      } finally { await removeFault(); }
      expect((await invoke(command(account))).status).toBe(200);
      const accepted = await snapshot(account);
      expect(accepted.hwm).toHaveLength(1);
      expect(accepted.periods).toHaveLength(1);
      expect(accepted.invoices).toHaveLength(1);
      expect(accepted.audits).toEqual([
        traderAuditActions.hwmBootstrapped, traderAuditActions.invoiceDraftGenerated,
        traderAuditActions.reportingPeriodClosed, traderAuditActions.reportingPeriodOpened,
      ].sort().map((value) => ({ action: value, count: 1 })));
    },
  );

  it("commits a nonbillable period and close audit without creating an invoice", async () => {
    const account = `dee1112-nonbillable-${randomUUID()}`;
    await seedOpen(account);
    const response = await invoke(command(account, "0"));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ result: { billable: false, invoiceIdPrefix: null } });
    const actual = await snapshot(account);
    expect(actual.periods[0]?.status).toBe("CLOSED");
    expect(actual.invoices).toEqual([]);
    expect(actual.audits).toContainEqual({ action: traderAuditActions.reportingPeriodClosed, count: 1 });
    expect(actual.audits.some((row) => row.action === traderAuditActions.invoiceDraftGenerated)).toBe(false);
  });

  it("serializes two actual connections contending on one OPEN row into one result and normal refusal", async () => {
    const account = `dee1112-race-${randomUUID()}`;
    const open = await seedOpen(account);
    const locker = postgres(url!, { max: 1 });
    let unlock!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const holding = locker.begin(async (tx) => {
      await tx`SELECT id FROM trader_reporting_periods WHERE id = ${open.id}::uuid FOR UPDATE`;
      locked();
      await gate;
    });
    await ready;
    const commands = [invoke(command(account), adminId, "dee1112-race-a"), invoke(command(account), adminId, "dee1112-race-b")];
    try {
      let blocked = 0;
      for (let attempt = 0; attempt < 200 && blocked < 2; attempt += 1) {
        blocked = (await sql<{ count: number }[]>`SELECT count(DISTINCT pid)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND application_name IN ('dee1112-race-a', 'dee1112-race-b')
            AND cardinality(pg_blocking_pids(pid)) > 0`)[0]!.count;
        if (blocked < 2) await delay(10);
      }
      expect(blocked).toBe(2);
    } finally { unlock(); await holding; await locker.end({ timeout: 5 }); }
    const outcomes = await Promise.all(commands);
    expect(outcomes.map((row) => row.status).sort()).toEqual([200, 400]);
    const failed = outcomes.find((row) => row.status === 400)!;
    expect(failed.body).toMatchObject({ error: { code: "DUPLICATE_BILLING_PERIOD_SCOPE" } });
    const actual = await snapshot(account);
    expect(actual.periods).toHaveLength(1);
    expect(actual.invoices).toHaveLength(1);
    expect(actual.invoices[0]?.performance_fee).toBe("30");
    expect(actual.audits).toContainEqual({ action: traderAuditActions.reportingPeriodClosed, count: 1 });
    expect(actual.audits).toContainEqual({ action: traderAuditActions.invoiceDraftGenerated, count: 1 });
  });

  it("refuses a foreign receipt and unauthorized member without writing either tenant", async () => {
    const account = `dee1112-scope-${randomUUID()}`;
    await seedOpen(account);
    await seedOpen(account, otherOrg);
    const original = await snapshot(account);
    const foreign = await snapshot(account, otherOrg);
    expect((await invoke({ ...await command(account), organization_id: otherOrg })).status).toBe(400);
    expect((await invoke(command(account), memberId)).status).toBe(403);
    expect(await snapshot(account)).toEqual(original);
    expect(await snapshot(account, otherOrg)).toEqual(foreign);
  });
  it("preserves exact account bytes in HTTP close admission instead of silently trimming scope", async () => {
    const raw = ` dee1120-exact-${randomUUID()} `;
    expect((await invoke(command(raw))).status).toBe(200);
    expect((await snapshot(raw)).periods).toHaveLength(1);
    expect((await snapshot(raw.trim())).periods).toEqual([]);
  });
  it("legacy HTTP candidates without projection binding refuse before bootstrap and open", async () => {
    const account = `dee1120-http-legacy-${randomUUID()}`;
    const body = await command(account); const { reality_dependencies: _binding, ...legacy } = body;
    void _binding;
    const before = await snapshot(account);
    const response = await invoke(legacy as typeof body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "BILLING_REALITY_BINDING_REQUIRED" } });
    expect(await snapshot(account)).toEqual(before);
  });

});
