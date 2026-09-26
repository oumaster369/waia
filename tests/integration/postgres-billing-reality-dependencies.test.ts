import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema.postgres";
import { createPostgresBillingPeriodCloseOrchestrator } from "@/lib/trader/billing/billing-period-close-orchestrator";
import { createPostgresReportingPeriodLifecycleService } from "@/lib/trader/billing/reporting-period-lifecycle-service";
import { handleAdminInvoiceCommandPost } from "@/lib/trader/billing/admin-route-handler";
import { createPostgresInvoiceIssuanceService } from "@/lib/trader/billing/invoice-issuance-service";
import { createPostgresHwmLedgerService } from "@/lib/trader/billing/hwm-ledger-service";
import { billingV2PeriodCloseEvidence } from "@/tests/helpers/billing-v2-period-close-evidence";
import { persistBillingRealityFixture, persistBillingRealitySourceFixture, prepareBillingRealitySourceFixture } from "@/tests/helpers/billing-reality-postgres";
import { listTruthRecordsV2, readLatestRealityProjectionV2, lockRealityScopeV2, appendRealitySourceObservationV2FromWriter, appendObservedRealityTruthV2FromWriter } from "@/lib/trader/reality/v2/repository-postgres";
import { ingestRealitySourceReportV2FromWriter, releaseRealityQuarantineV2Postgres } from "@/lib/trader/reality/v2/ingest-postgres";
import { billingEvidenceAtProjection, pureBillingRealityFixture, billingFixturePrimitives } from "@/tests/helpers/billing-reality-evidence";
import { type TruthRecordV2 } from "@/lib/trader/reality/v2/contracts";
import { buildClosedTradeSettlementV2, buildRealizedStrategyProfitReceiptV2 } from "@/lib/trader/billing/v2";
import { seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES;
const start = new Date("2026-01-01T00:00:00.000Z");
const end = new Date("2026-02-01T00:00:00.000Z");

describe.skipIf(!enabled)("DEE-1120 persisted Reality dependencies at actual close boundaries", () => {
  let client: postgres.Sql;
  let org: string;
  const owner = randomUUID();
  beforeAll(async () => {
    if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
      throw new Error("DEE1120_LOOPBACK_POSTGRES_REQUIRED");
    }
    client = postgres(url, { max: 4, onnotice: () => {} });
    org = await seedWp13User(url, owner, "DEE1120 synthetic source dependency tests");
    await client`UPDATE user_platform_roles SET role='admin' WHERE user_id=${owner}::uuid`;
  });
  afterAll(async () => { await client?.end({ timeout: 5 }); });

  function candidate(account: string) {
    return {
      ...billingV2PeriodCloseEvidence({ organizationId: org, accountId: account,
        periodStart: start, periodEnd: end, realizedPnl: "100", unrealizedPnl: "0" }),
      unrealizedPnl: "0", periodStart: start, startingEquity: "10000", startingSnapshotAt: start,
      openPositionsSnapshotRef: "synthetic", valuationSource: "synthetic",
    };
  }
  it("matches an actual persisted synthetic Reality dependency set and atomically closes", async () => {
    const account = randomUUID();
    const db = drizzle(client, { schema });
    const evidence = await persistBillingRealityFixture(db, { organizationId: org, accountId: account,
      periodStart: start, periodEnd: end, realizedPnl: "100" });
    const { realizedPnl: _pnl, ...input } = { ...candidate(account), ...evidence };
    void _pnl;
    const result = await createPostgresBillingPeriodCloseOrchestrator(db).closeAndMaterialize({ organizationId: org }, input);
    expect(result.billable).toBe(true);
    const rows = await client`SELECT status FROM trader_reporting_periods WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`;
    expect(rows.map((r) => r.status)).toEqual(["CLOSED"]);
  });
  it("refuses a self-sealed legacy candidate before HWM, open, close or draft effects", async () => {
    const account = randomUUID();
    const { realizedPnl: _pnl, ...input } = candidate(account);
    void _pnl;
    const db = drizzle(client, { schema });
    await expect(createPostgresBillingPeriodCloseOrchestrator(db).closeAndMaterialize(
      { organizationId: org }, input,
    )).rejects.toMatchObject({ code: "BILLING_REALITY_BINDING_REQUIRED" });
    expect(await client`SELECT id FROM trader_reporting_periods WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`).toHaveLength(0);
    expect(await client`SELECT id FROM trader_hwm_ledger WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`).toHaveLength(0);
    expect(await client`SELECT id FROM trader_invoices WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`).toHaveLength(0);
  });
  it("direct production lifecycle refuses the same invented source without closing or auditing", async () => {
    const account = randomUUID();
    const input = candidate(account);
    const db = drizzle(client, { schema });
    await createPostgresHwmLedgerService(db).bootstrapHwm({ organizationId: org }, {
      exchangeAccountId: account, initialHwm: "0", valuationSource: "synthetic", effectiveAt: start,
    });
    const service = createPostgresReportingPeriodLifecycleService(db);
    await service.openReportingPeriod({ organizationId: org }, input);
    await expect(service.closeReportingPeriod({ organizationId: org }, { ...input, realizedPnl: input.realizedStrategyProfitReceipt.netRealizedStrategyProfit }))
      .rejects.toMatchObject({ code: "BILLING_REALITY_BINDING_REQUIRED" });
    const rows = await client`SELECT status FROM trader_reporting_periods WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`;
    expect(rows.map((r) => r.status)).toEqual(["OPEN"]);
  });
  async function stored(account = randomUUID(), amount = "100") {
    const db = drizzle(client, { schema });
    const evidence = await persistBillingRealityFixture(db, { organizationId: org, accountId: account,
      periodStart: new Date(start), periodEnd: new Date(end), realizedPnl: amount });
    const { realizedPnl: _pnl, ...input } = { ...candidate(account), ...evidence };
    void _pnl;
    return { db, account, input: structuredClone(input), scope: { organizationId: org, accountId: account } };
  }
  async function effects(account: string) {
    return {
      periods: [...await client`SELECT id,status,record_content_digest FROM trader_reporting_periods WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`],
      invoices: [...await client`SELECT id,status,record_content_digest FROM trader_invoices WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`],
      hwm: [...await client`SELECT id,record_content_digest FROM trader_hwm_ledger WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`],
      audits: [...await client`SELECT action,metadata_json FROM audit_logs WHERE organization_id=${org}::uuid AND metadata_json->>'exchangeAccountId'=${account} ORDER BY action`],
    };
  }
  async function bindCurrent(value: Awaited<ReturnType<typeof stored>>, truths?: readonly TruthRecordV2[]) {
    const projection = await readLatestRealityProjectionV2(value.db, value.scope);
    const selected = truths ?? (await listTruthRecordsV2(value.db, value.scope)).filter((t) =>
      value.input.closedTradeSettlements.some((s) => [...s.openingFillTruthRecordDigests, ...s.closingFillTruthRecordDigests,
        ...s.partialFillTruthRecordDigests, ...s.cashflowFacts.map((c) => c.truthRecordDigestHex)].includes(t.truthRecordId)));
    const { realizedPnl: _pnl, ...evidence } = billingEvidenceAtProjection({ organizationId: org, accountId: value.account,
      periodStart: start, periodEnd: end, realizedPnl: "100" }, projection!, selected);
    void _pnl;
    return { ...value.input, ...evidence };
  }
  async function blocked(name: string) {
    for (let n = 0; n < 200; n++) {
      const rows = await client`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND application_name=${name} AND cardinality(pg_blocking_pids(pid))>0`;
      if (rows.length) return;
      await delay(10);
    }
    throw new Error(`expected real blocked connection ${name}`);
  }
  it.each(["0", "-100", "0.00000001", "9007199254740993.00000001"])("preserves exact supported aggregate %s without claiming scientific finality", async (amount) => {
    const { db, account, input } = await stored(undefined, amount);
    const result = await createPostgresBillingPeriodCloseOrchestrator(db).closeAndMaterialize({ organizationId: org }, input);
    const rows = await client`SELECT realized_pnl FROM trader_reporting_periods WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`;
    expect(rows[0]!.realized_pnl).toBe(input.realizedStrategyProfitReceipt.netRealizedStrategyProfit);
    expect(result.realizedStrategyProfitReceiptDigestHex).toBe(input.realizedStrategyProfitReceipt.contentDigestHex);
    const audit = (await effects(account)).audits.find((a) => a.action === "trader.reporting_period.closed")!;
    expect(audit.metadata_json.realityDependencies).toMatchObject({ dependenciesMatched: true,
      binding: input.realityDependencies, economicAttribution: "UNPROVEN", periodCompleteness: "UNPROVEN",
      priorConsumption: "UNPROVEN", realizedFillFinality: "OPERATOR_VERIFICATION_REQUIRED" });
    expect(await client`SELECT id FROM trader_invoices WHERE organization_id=${org}::uuid AND exchange_account_id=${account} AND realized_fill_finality=true`).toHaveLength(0);
  });
  it("direct public lifecycle also accepts real stored dependencies", async () => {
    const { db, account, input } = await stored();
    await createPostgresHwmLedgerService(db).bootstrapHwm({ organizationId: org }, { exchangeAccountId: account, initialHwm: "0", valuationSource: "synthetic", effectiveAt: start });
    const service = createPostgresReportingPeriodLifecycleService(db);
    await service.openReportingPeriod({ organizationId: org }, input);
    expect((await service.closeReportingPeriod({ organizationId: org }, { ...input, realizedPnl: input.realizedStrategyProfitReceipt.netRealizedStrategyProfit })).status).toBe("CLOSED");
  });
  it("rejects a genuine caller-held Drizzle transaction before any query or membership", async () => {
    const { db, input } = await stored();
    await db.transaction(async (tx) => {
      const membership = vi.fn();
      const execute = vi.spyOn(tx, "execute");
      await expect(createPostgresBillingPeriodCloseOrchestrator(tx as unknown as WaiaPostgresDb, { assertMembership: membership })
        .closeAndMaterialize({ organizationId: org, userId: randomUUID() }, input))
        .rejects.toMatchObject({ code: "BILLING_REALITY_TRANSACTION_OWNER_REQUIRED" });
      await expect(createPostgresReportingPeriodLifecycleService(tx as unknown as WaiaPostgresDb, { assertMembership: membership })
        .closeReportingPeriod({ organizationId: org }, { ...input, realizedPnl: input.realizedStrategyProfitReceipt.netRealizedStrategyProfit })).rejects.toMatchObject({ code: "BILLING_REALITY_TRANSACTION_OWNER_REQUIRED" });
      expect(execute).not.toHaveBeenCalled(); expect(membership).not.toHaveBeenCalled();
      execute.mockRestore();
    });
  });
  it.each(["uppercase", "braced", "compact"])("refuses UUID %s alias before membership or transaction acquisition", async (alias) => {
    const { db, input } = await stored();
    const transaction = vi.spyOn(db, "transaction"); const membership = vi.fn();
    const organizationId = alias === "uppercase" ? org.toUpperCase() : alias === "braced" ? `{${org}}` : org.replaceAll("-", "");
    await expect(createPostgresBillingPeriodCloseOrchestrator(db, { assertMembership: membership }).closeAndMaterialize({ organizationId, userId: randomUUID() }, input))
      .rejects.toMatchObject({ code: "BILLING_REALITY_SCOPE_INVALID" });
    expect(transaction).not.toHaveBeenCalled(); expect(membership).not.toHaveBeenCalled(); transaction.mockRestore();
  });
  it("binds membership to the owning RC transaction and captures caller input before the await", async () => {
    const { db, input, account } = await stored();
    const actor = randomUUID(); const context = { organizationId: org, userId: actor };
    const original = structuredClone(input);
    let allow!: () => void; let entered!: () => void;
    const gate = new Promise<void>((r) => { allow = r; }); const ready = new Promise<void>((r) => { entered = r; });
    const seen: string[] = [];
    const membership = vi.fn(async (captured, bound: WaiaPostgresDb) => {
      expect(bound).not.toBe(db); expect(captured).toMatchObject({ organizationId: org, userId: actor });
      const rows = await bound.execute(sql`SHOW transaction_isolation`); seen.push(String(rows[0]!.transaction_isolation));
      if (seen.length === 1) { entered(); await gate; }
    });
    const options = { assertMembership: membership };
    const pending = createPostgresBillingPeriodCloseOrchestrator(db, options).closeAndMaterialize(context, input);
    await ready;
    context.organizationId = randomUUID(); context.userId = randomUUID(); input.exchangeAccountId = "mutated";
    options.assertMembership = vi.fn(async () => { throw new Error("CHANGED_TRUSTED_CONFIGURATION"); });
    input.periodStart.setUTCFullYear(2030); input.periodEnd.setUTCFullYear(2030);
    input.startingSnapshotAt.setUTCFullYear(2030);
    (input.realizedStrategyProfitReceipt as { netRealizedStrategyProfit: string }).netRealizedStrategyProfit = "999999";
    (input.closedTradeSettlements[0]!.cashflowFacts[0] as { amount: string }).amount = "999999";
    (input.realityDependencies!.projection as { frontierSequence: string }).frontierSequence = "999";
    allow(); await expect(pending).resolves.toMatchObject({ realizedStrategyProfitReceiptDigestHex: original.realizedStrategyProfitReceipt.contentDigestHex });
    expect(seen.length).toBeGreaterThan(0); expect(new Set(seen)).toEqual(new Set(["read committed"]));
    const rows = await client`SELECT period_start,period_end,realized_pnl FROM trader_reporting_periods WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`;
    expect(new Date(rows[0]!.period_start).toISOString()).toBe(original.periodStart.toISOString());
    expect(new Date(rows[0]!.period_end).toISOString()).toBe(original.periodEnd.toISOString());
  });
  it("rejects missing malformed or foreign persisted references before all financial effects", async () => {
    const value = await stored(); const before = await effects(value.account);
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: randomUUID() }, value.input))
      .rejects.toMatchObject({ code: "RECEIPT_ORGANIZATION_MISMATCH" });
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, { ...value.input,
      realizedStrategyProfitReceipt: undefined as never })).rejects.toMatchObject({ code: "BILLING_REALITY_INVALID_INPUT" });
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, { ...value.input,
      exchangeAccountId: ` ${value.account} ` })).rejects.toMatchObject({ code: "RECEIPT_ACCOUNT_MISMATCH" });
    expect(await effects(value.account)).toEqual(before);
  });
  it("does not confuse a new complete current head with the caller's formerly valid snapshot", async () => {
    const value = await stored(); const before = await effects(value.account);
    await persistBillingRealityFixture(value.db, { organizationId: org, accountId: value.account, periodStart: start, periodEnd: end, realizedPnl: "1" });
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, value.input))
      .rejects.toMatchObject({ code: "BILLING_REALITY_FRONTIER_STALE" });
    expect(await effects(value.account)).toEqual(before);
  });
  it("selected contradiction blocks the former stable truth; release does not promote disputed truth", async () => {
    const value = await stored(); const originals = await listTruthRecordsV2(value.db, value.scope);
    const target = originals.find((t) => t.primitiveAssertion.kind === "REALIZED_CASHFLOW")!;
    const conflicting = await persistBillingRealitySourceFixture(value.db, value.scope, { ...target.primitiveAssertion, amount: "999" } as never,
      { subject: target.subject, sourceNativeIdentity: target.sourceNativeIdentity });
    expect(conflicting.classification).toBe("SOURCE_CONTRADICTION");
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, await bindCurrent(value)))
      .rejects.toMatchObject({ code: "BILLING_REALITY_FACT_UNCERTAIN" });
    await releaseRealityQuarantineV2Postgres(value.db, value.scope, conflicting.sourceReport.sourceReportId);
    const disputed = originals.map((t) => t.truthRecordId === target.truthRecordId ? conflicting.truthRecord! : t);
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, await bindCurrent(value, disputed)))
      .rejects.toMatchObject({ code: "BILLING_REALITY_FACT_INACTIVE" });
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, await bindCurrent(value)))
      .resolves.toMatchObject({ billable: true });
  });
  it("captures a fresh post-lock view even on a connection defaulting to repeatable read", async () => {
    const value = await stored(); const originals = await listTruthRecordsV2(value.db, value.scope);
    const prepared = await prepareBillingRealitySourceFixture(value.db, value.scope, originals[0]!.primitiveAssertion);
    const writer = postgres(url!, { max: 1 }); const worker = postgres(url!, { max: 1, connection: { application_name: "dee1120-stale-worker" } });
    await worker.unsafe("SET default_transaction_isolation TO 'repeatable read'");
    let release!: () => void; let held!: () => void;
    const gate = new Promise<void>((r) => { release = r; }); const ready = new Promise<void>((r) => { held = r; });
    const writing = drizzle(writer, { schema }).transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${org}::uuid::text || ':' || ${value.account},675))`);
      held(); await gate;
      await ingestRealitySourceReportV2FromWriter(tx, value.scope, prepared);
    });
    await ready;
    const pending = createPostgresBillingPeriodCloseOrchestrator(drizzle(worker, { schema })).closeAndMaterialize({ organizationId: org }, value.input);
    const outcome = pending.then(() => ({ code: "UNEXPECTED_SUCCESS" }), (e) => e);
    try { await blocked("dee1120-stale-worker");
      (value.input.closedTradeSettlements as unknown[]).length = 0;
      (value.input.realityDependencies as unknown as { closedTradeSettlementDigests: string[] }).closedTradeSettlementDigests = [];
      release(); await writing;
      expect(await outcome).toMatchObject({ code: "BILLING_REALITY_FRONTIER_STALE" });
      expect((await effects(value.account)).periods).toEqual([]);
    } finally { release(); await writing; await writer.end({ timeout: 5 }); await worker.end({ timeout: 5 }); }
  });
  it("reconstructs admission in a separate process from serialized input and saved source rows", async () => {
    const value = await stored();
    const child = await promisify(execFile)(process.execPath, ["--import", "tsx", "--conditions=react-server", "tests/helpers/billing-reality-close-process.ts"], {
      cwd: process.cwd(), timeout: 15000, env: { PATH: process.env.PATH, NODE_ENV: "test", WAIA_TRADER_CLI: "1",
        WAIA_BILLING_REALITY_TEST_URL: url, WAIA_BILLING_REALITY_TEST_INPUT: JSON.stringify({ context: { organizationId: org }, input: value.input }) },
    });
    expect(JSON.parse(child.stdout)).toMatchObject({ result: { billable: true,
      realizedStrategyProfitReceiptDigestHex: value.input.realizedStrategyProfitReceipt.contentDigestHex } });
    expect((await effects(value.account)).periods[0]!.status).toBe("CLOSED");
  });

  it.each(["cashflow", "cost", "opening", "closing", "partial", "nonProfit"])("rejects independently resealed %s dependency mismatch before writes", async (field) => {
    const value = await stored(); const before = await effects(value.account);
    const old = value.input.closedTradeSettlements[0]!;
    const missing = "f".repeat(64);
    const settlement = buildClosedTradeSettlementV2({ ...old,
      ...(field === "cashflow" ? { cashflowFacts: old.cashflowFacts.map((f) => ({ ...f, amount: "1000" })) } : {}),
      ...(field === "cost" ? { costFacts: old.costFacts.map((f, i) => ({ ...f, amount: i === 0 ? "10" : f.amount })) } : {}),
      ...(field === "opening" ? { openingFillTruthRecordDigests: [missing] } : {}),
      ...(field === "closing" ? { closingFillTruthRecordDigests: [missing] } : {}),
      ...(field === "partial" ? { partialFillTruthRecordDigests: [missing] } : {}),
    });
    const receipt = buildRealizedStrategyProfitReceiptV2({ ...value.input.realizedStrategyProfitReceipt, settlements: [settlement],
      ...(field === "nonProfit" ? { nonProfitCashflowFacts: [{ truthRecordDigestHex: missing, amount: "1", cause: "DEPOSIT" as const }] } : {}) });
    const input = { ...value.input, realizedStrategyProfitReceipt: receipt, closedTradeSettlements: [settlement],
      realityDependencies: { ...value.input.realityDependencies!, receiptContentDigestHex: receipt.contentDigestHex,
        closedTradeSettlementDigests: receipt.closedTradeSettlementDigests } };
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, input))
      .rejects.toMatchObject({ code: field === "cashflow" || field === "cost" ? "BILLING_REALITY_VALUE_MISMATCH" : "BILLING_REALITY_FACT_INACTIVE" });
    expect(await effects(value.account)).toEqual(before);
  });
  it("selected unresolved quarantine blocks while unrelated subject uncertainty does not", async () => {
    const value = await stored(); const truths = await listTruthRecordsV2(value.db, value.scope);
    const target = truths[0]!;
    await persistBillingRealitySourceFixture(value.db, value.scope, target.primitiveAssertion,
      { primitiveAssertion: null, structuralVerification: "UNVERIFIABLE", verificationReasonCodes: ["SOURCE_UNATTRIBUTED"] });
    const unrelated = await bindCurrent(value);
    // It is only the selected dependency's uncertainty that refuses this bounded admission.
    const second = await stored(); const selected = (await listTruthRecordsV2(second.db, second.scope))[0]!;
    await persistBillingRealitySourceFixture(second.db, second.scope, selected.primitiveAssertion,
      { subject: selected.subject, primitiveAssertion: null, structuralVerification: "UNVERIFIABLE", verificationReasonCodes: ["SOURCE_UNATTRIBUTED"] });
    await expect(createPostgresBillingPeriodCloseOrchestrator(second.db).closeAndMaterialize({ organizationId: org }, await bindCurrent(second)))
      .rejects.toMatchObject({ code: "BILLING_REALITY_FACT_UNCERTAIN" });
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, unrelated))
      .resolves.toMatchObject({ billable: true });
  });
  it("refuses an unavailable stored schema with a machine-readable reason and no financial effects", async () => {
    const value = await stored(); const before = await effects(value.account);
    await client.unsafe("ALTER TABLE trader_reality_truth_records_v2 RENAME TO dee1120_temporarily_unavailable_truth");
    try {
      await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, value.input))
        .rejects.toMatchObject({ code: "BILLING_REALITY_SCHEMA_UNAVAILABLE" });
      expect(await effects(value.account)).toEqual(before);
    } finally { await client.unsafe("ALTER TABLE dee1120_temporarily_unavailable_truth RENAME TO trader_reality_truth_records_v2"); }
  });
  it("succeeds with limited application grants and keeps Reality append-only", async () => {
    const value = await stored();
    const role = `dee1120_${randomUUID().replaceAll("-", "")}`;
    const connection = postgres(url!, { max: 1 });
    try {
      await client.unsafe(`CREATE ROLE ${role} NOLOGIN BYPASSRLS`);
      await client.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
      await client.unsafe(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      await client.unsafe(`GRANT INSERT,UPDATE ON trader_reporting_periods,trader_hwm_ledger,trader_invoices,audit_logs TO ${role}`);
      await client.unsafe(`GRANT UPDATE ON trader_reality_truth_records_v2 TO ${role}`);
      await client.unsafe(`GRANT INSERT ON trader_mi_source,trader_reality_raw_source_admissions_v2,
        trader_mi_raw_storage_binding_v1,trader_mi_raw_capture_receipt_v1,
        trader_reality_source_reports_v2,trader_reality_truth_records_v2,trader_reality_events_v2,trader_reality_projections_v2 TO ${role}`);
      await client.unsafe(`GRANT EXECUTE ON FUNCTION waia_reality_v2_allocate_knowledge_at(uuid,text),
        waia_reality_v2_consume_knowledge_reservation(uuid,text,uuid,timestamptz) TO ${role}`);
      await connection.unsafe(`SET ROLE ${role}`);
      await expect(connection`UPDATE trader_reality_truth_records_v2 SET account_id=account_id WHERE organization_id=${org}::uuid AND account_id=${value.account}`)
        .rejects.toThrow(/append.only|immutable|mutation/i);
      const rows = await connection`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
      expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: true });
      const limitedDb = drizzle(connection, { schema }); const limitedAccount = randomUUID();
      const limitedEvidence = await persistBillingRealityFixture(limitedDb, { organizationId: org, accountId: limitedAccount,
        periodStart: start, periodEnd: end, realizedPnl: "100" });
      const { realizedPnl: _pnl, ...limitedInput } = { ...candidate(limitedAccount), ...limitedEvidence };
    void _pnl;
      await expect(createPostgresBillingPeriodCloseOrchestrator(limitedDb).closeAndMaterialize({ organizationId: org }, limitedInput))
        .resolves.toMatchObject({ billable: true });
    } finally { await connection.end({ timeout: 5 }); await client.unsafe(`DROP OWNED BY ${role}`); await client.unsafe(`DROP ROLE ${role}`); }
  });

  it("does not turn a complete caller-only sidecar or an empty settlement set into stored evidence", async () => {
    const account = randomUUID(); const db = drizzle(client, { schema });
    const evidence = pureBillingRealityFixture({ organizationId: org, accountId: account, periodStart: start, periodEnd: end, realizedPnl: "100" }).candidate;
    const { realizedPnl: _pnl, ...input } = { ...candidate(account), ...evidence };
    void _pnl;
    await expect(createPostgresBillingPeriodCloseOrchestrator(db).closeAndMaterialize({ organizationId: org }, input))
      .rejects.toMatchObject({ code: "BILLING_REALITY_SOURCE_UNAVAILABLE" });
    const value = await stored();
    const receipt = buildRealizedStrategyProfitReceiptV2({ ...value.input.realizedStrategyProfitReceipt, settlements: [] });
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, { ...value.input,
      realizedStrategyProfitReceipt: receipt, closedTradeSettlements: [], realityDependencies: { ...value.input.realityDependencies!,
        receiptContentDigestHex: receipt.contentDigestHex, closedTradeSettlementDigests: [] } }))
      .rejects.toMatchObject({ code: "BILLING_REALITY_SOURCE_UNAVAILABLE" });
    expect((await effects(account)).periods).toEqual([]); expect((await effects(value.account)).periods).toEqual([]);
  });
  it("checks the complete event head even when the saved latest projection has not been refreshed", async () => {
    const value = await stored(); const target = (await listTruthRecordsV2(value.db, value.scope))[0]!;
    const prepared = await prepareBillingRealitySourceFixture(value.db, value.scope, target.primitiveAssertion);
    await value.db.transaction(async (tx) => {
      await lockRealityScopeV2(tx, value.scope);
      const source = await appendRealitySourceObservationV2FromWriter(tx, value.scope, prepared);
      await appendObservedRealityTruthV2FromWriter(tx, value.scope, source.report);
    });
    expect((await readLatestRealityProjectionV2(value.db, value.scope))!.contentDigestHex).toBe(value.input.realityDependencies!.projection.contentDigestHex);
    await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, value.input))
      .rejects.toMatchObject({ code: "BILLING_REALITY_FRONTIER_STALE" });
    expect((await effects(value.account)).periods).toEqual([]);
  });
  it("refuses a superseded dependency and accepts only the new current stored identity", async () => {
    const db = drizzle(client, { schema }); const account = randomUUID(); const scope = { organizationId: org, accountId: account };
    const truths: TruthRecordV2[] = [];
    for (const primitive of billingFixturePrimitives("100")) {
      const result = await persistBillingRealitySourceFixture(db, scope, primitive, { sourceNativeIdentity: {
        identityKind: "HTX_TRADE_ID", nativeId: randomUUID(), nativeRevision: "1", supersedesNativeRevision: null } });
      truths.push(result.truthRecord!);
    }
    const target = truths.find((t) => t.primitiveAssertion.kind === "REALIZED_CASHFLOW")!;
    const corrected = await persistBillingRealitySourceFixture(db, scope, { ...target.primitiveAssertion, amount: "50" } as never,
      { subject: target.subject, sourceNativeIdentity: { ...target.sourceNativeIdentity!, nativeRevision: "2", supersedesNativeRevision: "1" } });
    expect(corrected.classification).toBe("EXPLICIT_CORRECTION");
    const evidence = billingEvidenceAtProjection({ organizationId: org, accountId: account, periodStart: start, periodEnd: end, realizedPnl: "100" }, corrected.projection!, truths);
    const { realizedPnl: _pnl, ...input } = { ...candidate(account), ...evidence };
    void _pnl;
    const value = { db, account, input, scope };
    await expect(createPostgresBillingPeriodCloseOrchestrator(db).closeAndMaterialize({ organizationId: org }, input))
      .rejects.toMatchObject({ code: "BILLING_REALITY_FACT_INACTIVE" });
    const current = await bindCurrent(value, truths.map((t) => t.truthRecordId === target.truthRecordId ? corrected.truthRecord! : t));
    await expect(createPostgresBillingPeriodCloseOrchestrator(db).closeAndMaterialize({ organizationId: org }, current)).resolves.toMatchObject({ billable: true });
    expect((await client`SELECT realized_pnl FROM trader_reporting_periods WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`)[0]!.realized_pnl).toBe("50");
  });
  it("holds the Reality writer mutex through every financial write, while another account progresses", async () => {
    const value = await stored(); const target = (await listTruthRecordsV2(value.db, value.scope))[0]!;
    const prepared = await prepareBillingRealitySourceFixture(value.db, value.scope, target.primitiveAssertion);
    const gate = postgres(url!, { max: 1 }); const billing = postgres(url!, { max: 1, connection: { application_name: "dee1120-billing-held" } });
    const writer = postgres(url!, { max: 1, connection: { application_name: "dee1120-source-writer" } });
    let unlock!: () => void; let held!: () => void;
    const ready = new Promise<void>((r) => { held = r; }); const release = new Promise<void>((r) => { unlock = r; });
    const holding = gate.begin(async (tx) => { await tx`SELECT pg_advisory_xact_lock(1120,1)`; held(); await release; });
    await ready;
    await client.unsafe(`CREATE FUNCTION dee1120_wait_after_admission() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.organization_id='${org}'::uuid AND NEW.exchange_account_id='${value.account}'
      THEN PERFORM pg_advisory_xact_lock(1120,1); END IF; RETURN NEW; END $$`);
    await client.unsafe("CREATE TRIGGER dee1120_wait_after_admission BEFORE INSERT ON trader_hwm_ledger FOR EACH ROW EXECUTE FUNCTION dee1120_wait_after_admission()");
    let closing: Promise<unknown> | undefined; let writing: Promise<unknown> | undefined;
    try {
      closing = createPostgresBillingPeriodCloseOrchestrator(drizzle(billing, { schema })).closeAndMaterialize({ organizationId: org }, value.input);
      await blocked("dee1120-billing-held");
      writing = drizzle(writer, { schema }).transaction((tx) => ingestRealitySourceReportV2FromWriter(tx, value.scope, prepared));
      await blocked("dee1120-source-writer");
      const other = await stored();
      await expect(createPostgresBillingPeriodCloseOrchestrator(other.db).closeAndMaterialize({ organizationId: org }, other.input)).resolves.toMatchObject({ billable: true });
      expect((await effects(value.account)).periods).toEqual([]);
      unlock(); await holding; await expect(closing).resolves.toMatchObject({ billable: true }); await writing;
      const actual = await effects(value.account); expect(actual.periods).toHaveLength(1); expect(actual.invoices).toHaveLength(1);
      const audit = actual.audits.find((a) => a.action === "trader.reporting_period.closed")!;
      expect(audit.metadata_json.realityDependencies.binding).toEqual(value.input.realityDependencies);
      expect((await readLatestRealityProjectionV2(value.db, value.scope))!.contentDigestHex).not.toBe(value.input.realityDependencies!.projection.contentDigestHex);
    } finally {
      unlock(); await holding; await Promise.allSettled([closing, writing]);
      await client.unsafe("DROP TRIGGER IF EXISTS dee1120_wait_after_admission ON trader_hwm_ledger");
      await client.unsafe("DROP FUNCTION IF EXISTS dee1120_wait_after_admission()");
      await Promise.all([gate.end({ timeout: 5 }), billing.end({ timeout: 5 }), writer.end({ timeout: 5 })]);
    }
  });
  it("direct close rolls back its period and proof audit on a draft storage failure", async () => {
    const value = await stored();
    await createPostgresHwmLedgerService(value.db).bootstrapHwm({ organizationId: org }, { exchangeAccountId: value.account, initialHwm: "0", valuationSource: "synthetic", effectiveAt: start });
    const service = createPostgresReportingPeriodLifecycleService(value.db);
    await service.openReportingPeriod({ organizationId: org }, value.input);
    const before = await effects(value.account);
    await client.unsafe(`CREATE FUNCTION dee1120_draft_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.organization_id='${org}'::uuid AND NEW.exchange_account_id='${value.account}' THEN RAISE EXCEPTION 'DEE1120_DRAFT_FAULT'; END IF; RETURN NEW; END $$`);
    await client.unsafe("CREATE TRIGGER dee1120_draft_fault AFTER INSERT ON trader_invoices FOR EACH ROW EXECUTE FUNCTION dee1120_draft_fault()");
    try {
      await expect(service.closeReportingPeriod({ organizationId: org }, { ...value.input, realizedPnl: value.input.realizedStrategyProfitReceipt.netRealizedStrategyProfit })).rejects.toThrow("DEE1120_DRAFT_FAULT");
      expect(await effects(value.account)).toEqual(before);
    } finally {
      await client.unsafe("DROP TRIGGER IF EXISTS dee1120_draft_fault ON trader_invoices");
      await client.unsafe("DROP FUNCTION IF EXISTS dee1120_draft_fault()");
    }
    await expect(service.closeReportingPeriod({ organizationId: org }, { ...value.input, realizedPnl: value.input.realizedStrategyProfitReceipt.netRealizedStrategyProfit })).resolves.toMatchObject({ status: "CLOSED" });
  });

  it("allows invoice and new-period work to contend without adding an inverse invoice/HWM lock", async () => {
    const value = await stored();
    await createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, value.input);
    const invoiceId = (await effects(value.account)).invoices[0]!.id;
    const issuance = createPostgresInvoiceIssuanceService(value.db);
    await issuance.approveInvoiceIssuance({ organizationId: org, userId: owner }, { invoiceId, approvedAt: new Date(Date.now() - 60000), coolingOffMs: 1,
      attestations: { depositsVerified: true, withdrawalsVerified: true, balanceSnapshotsVerified: true,
        reconciliationVerified: true, exchangeSyncVerified: true, realizedFillFinalityVerified: true } });
    const nextEnd = new Date("2026-03-01T00:00:00.000Z");
    const nextEvidence = await persistBillingRealityFixture(value.db, { organizationId: org, accountId: value.account,
      periodStart: end, periodEnd: nextEnd, realizedPnl: "100" });
    const { realizedPnl: _pnl, ...next } = { ...value.input, ...nextEvidence, periodStart: end, startingSnapshotAt: end };
    void _pnl;
    const locker = postgres(url!, { max: 1 }); const issuer = postgres(url!, { max: 1, connection: { application_name: "dee1120-invoice-contender" } });
    let release!: () => void; let locked!: () => void;
    const gate = new Promise<void>((r) => { release = r; }); const ready = new Promise<void>((r) => { locked = r; });
    const holding = locker.begin(async (tx) => {
      await tx`SELECT id FROM trader_hwm_ledger WHERE organization_id=${org}::uuid AND exchange_account_id=${value.account} AND entry_type='BOOTSTRAP' FOR UPDATE`;
      locked(); await gate;
    });
    await ready;
    const pending = handleAdminInvoiceCommandPost(new Request("http://localhost/api/trader/admin/invoice", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: "issue", organization_id: org }) }),
      { getUserId: async () => owner, getRuntimeDb: async () => ({ kind: "postgres", db: drizzle(issuer, { schema }) }),
        disposeRuntimeDb: async () => undefined }, invoiceId);
    try {
      await blocked("dee1120-invoice-contender");
      await expect(createPostgresBillingPeriodCloseOrchestrator(value.db).closeAndMaterialize({ organizationId: org }, next))
        .resolves.toMatchObject({ billable: true });
      release(); await holding; await expect(pending).resolves.toMatchObject({ status: 200 });
      const state = await effects(value.account); expect(state.periods).toHaveLength(2); expect(state.invoices).toHaveLength(2);
      expect(state.invoices.map((i) => i.status).sort()).toEqual(["DRAFT", "ISSUED"]);
      // This proves progress/lock ordering only. New close intentionally does not
      // claim a snapshot of every HWM/invoice writer or auto-approve the new draft.
    } finally { release(); await holding; await Promise.allSettled([pending]); await locker.end({ timeout: 5 }); await issuer.end({ timeout: 5 }); }
  });

});
