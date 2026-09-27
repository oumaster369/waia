import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema.postgres";
import { createPostgresBillingPeriodCloseOrchestrator } from "@/lib/trader/billing/billing-period-close-orchestrator";
import { createPostgresReportingPeriodLifecycleService } from "@/lib/trader/billing/reporting-period-lifecycle-service";
import { createPostgresHwmLedgerService } from "@/lib/trader/billing/hwm-ledger-service";
import { readReportingPeriodBasisV1Postgres, withReportingPeriodBasisRetention } from "@/lib/trader/billing/v2/reporting-period-basis-postgres-v1";
import { handleAdminReportingPeriodBasisGet } from "@/lib/trader/billing/reporting-period-basis-read";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { persistBillingRealityFixture, prepareBillingRealitySourceFixture, persistBillingRealitySourceFixture } from "@/tests/helpers/billing-reality-postgres";
import { appendRealitySourceObservationV2FromWriter, appendObservedRealityTruthV2FromWriter, lockRealityScopeV2, readExactRealityLedgerV2 } from "@/lib/trader/reality/v2/repository-postgres";
import { createPostgresReportingPeriodRepository } from "@/lib/trader/billing/repository-adapters";
import { createReportingPeriodLifecycleService } from "@/lib/trader/billing/reporting-period-lifecycle-service";
import { billingV2PeriodCloseEvidence } from "@/tests/helpers/billing-v2-period-close-evidence";
import { ingestRealitySourceReportV2Postgres } from "@/lib/trader/reality/v2/ingest-postgres";
import { candidateFromReportingPeriodBasis } from "@/lib/trader/billing/v2/reporting-period-basis-v1";
import { seedWp13User } from "./wp13-intelligence-test-helpers";

const enabled = process.env.WAIA_PG_INTEGRATION === "1", url = process.env.DATABASE_URL_POSTGRES;
const start = new Date("2026-01-01T00:00:00.000Z"), end = new Date("2026-02-01T00:00:00.000Z");
describe.skipIf(!enabled)("DEE1125 actual PostgreSQL period-basis retention and replay", () => {
  let client: postgres.Sql, org: string;
  const user = randomUUID();
  beforeAll(async () => {
    if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("LOOPBACK_REQUIRED");
    client = postgres(url, { max: 5, onnotice: () => {} });
    org = await seedWp13User(url, user, "DEE1125 synthetic retention tests");
    await client`UPDATE user_platform_roles SET role='admin' WHERE user_id=${user}::uuid`;
  });
  afterAll(async () => { await client?.end({ timeout: 5 }); });
  const db = () => drizzle(client, { schema });
  const scope = () => ({ organizationId: org });
  async function stored(amount = "100", account: string = randomUUID()) {
    const evidence = await persistBillingRealityFixture(db(), { organizationId: org, accountId: account, periodStart: start, periodEnd: end, realizedPnl: amount });
    const { realizedPnl: _ignored, ...base } = evidence; void _ignored;
    const input = { ...base, periodEnd: new Date(base.periodEnd), endingSnapshotAt: new Date(base.endingSnapshotAt), unrealizedPnl: "0", periodStart: new Date(start), startingEquity: "10000", startingSnapshotAt: new Date(start),
      openPositionsSnapshotRef: "original-opaque-ref", valuationSource: "synthetic-unproven" };
    return { account, input, evidence };
  }
  async function periodId(account: string) { return (await client`SELECT id FROM trader_reporting_periods WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`)[0].id as string; }
  async function read(account: string, id?: string) { return readReportingPeriodBasisV1Postgres(db(), scope(), { periodId: id ?? await periodId(account), exchangeAccountId: account }); }
  async function effects(account: string) {
    return {
      periods: [...await client`SELECT id,status,record_content_digest FROM trader_reporting_periods WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`],
      bases: [...await client`SELECT content_digest FROM trader_reporting_period_bases_v1 WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`],
      hwm: [...await client`SELECT id FROM trader_hwm_ledger WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`],
      invoices: [...await client`SELECT id FROM trader_invoices WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`],
      audits: [...await client`SELECT id FROM audit_logs WHERE organization_id=${org}::uuid AND metadata_json->>'exchangeAccountId'=${account}`],
    };
  }
  it.each(["100", "-99.1", "0"])("orchestrated close retains and replays exact %s inputs", async (amount) => {
    const f = await stored(amount);
    await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const result = await read(f.account);
    expect(result.status).toBe("BASIS_REPLAYED_AT_CLOSE");
    if (!result.basis) throw new Error("missing basis");
    expect(result.basis.receipt).toEqual(f.input.realizedStrategyProfitReceipt);
    expect(result.basis.settlements).toEqual(f.input.closedTradeSettlements);
    expect(result.basis.dependencies).toMatchObject({ economicAttribution: "UNPROVEN", priorConsumption: "UNPROVEN", realizedFillFinality: "OPERATOR_VERIFICATION_REQUIRED" });
    expect((await effects(f.account)).bases).toHaveLength(1);
    expect((await effects(f.account)).invoices).toHaveLength(amount === "100" ? 1 : 0);
  });
  it("direct public close retains the actual OPEN baseline and authenticated actor", async () => {
    const f = await stored();
    await createPostgresHwmLedgerService(db()).bootstrapHwm(scope(), { exchangeAccountId: f.account, initialHwm: "0", valuationSource: "synthetic", effectiveAt: start });
    const lifecycle = createPostgresReportingPeriodLifecycleService(db());
    await lifecycle.openReportingPeriod(scope(), { ...f.input, startingEquity: "12000.000", openPositionsSnapshotRef: "actual-open-ref" });
    await lifecycle.closeReportingPeriod({ organizationId: org, userId: user }, f.evidence);
    const result = await read(f.account);
    expect(result.basis?.period).toMatchObject({ startingEquity: "12000.000", openPositionsSnapshotRef: "actual-open-ref" });
    expect(result.basis?.actor).toEqual({ type: "USER", userId: user });
  });
  it("replays in a genuine child with only scope/id after connection recreation", async () => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const parent = await read(f.account), id = await periodId(f.account);
    const child = await promisify(execFile)(process.execPath, ["--import", "tsx", "--conditions=react-server", "tests/helpers/reporting-period-basis-process.ts"], {
      cwd: process.cwd(), timeout: 15000, env: { PATH: process.env.PATH, NODE_ENV: "test", WAIA_TRADER_CLI: "1", WAIA_BASIS_TEST_URL: url,
        WAIA_BASIS_TEST_INPUT: JSON.stringify({ context: scope(), input: { periodId: id, exchangeAccountId: f.account } }) },
    });
    expect(JSON.parse(child.stdout)).toEqual(parent);
  });
  it("preserves source-only identities beyond event time and excludes later truth/events", async () => {
    const f = await stored(), accountScope = { organizationId: org, accountId: f.account };
    const prepared = await prepareBillingRealitySourceFixture(db(), accountScope,
      { kind: "REALIZED_CASHFLOW", cashflowId: randomUUID(), asset: "USD", amount: "2", direction: "INFLOW", causeNativeId: "unselected" });
    const only = await db().transaction(async (tx) => { await lockRealityScopeV2(tx, accountScope); return appendRealitySourceObservationV2FromWriter(tx, accountScope, prepared); });
    await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const before = await read(f.account);
    expect(before.basis?.ledgerReadSet.sources.some((r) => r.id === only.report.sourceReportId)).toBe(true);
    expect(new Date(only.report.knowledgeAtUtc).getTime()).toBeGreaterThan(new Date(before.basis!.dependencies.binding.projection.knowledgeAsOfUtc).getTime());
    await db().transaction(async (tx) => { await lockRealityScopeV2(tx, accountScope); await appendObservedRealityTruthV2FromWriter(tx, accountScope, only.report); });
    await persistBillingRealitySourceFixture(db(), accountScope,
      { kind: "REALIZED_CASHFLOW", cashflowId: randomUUID(), asset: "USD", amount: "3", direction: "OUTFLOW", causeNativeId: "unselected-later" });
    expect(await read(f.account)).toEqual(before);
    await expect(createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input)).rejects.toMatchObject({ code: "BILLING_REALITY_FRONTIER_STALE" });
  });
  it("does not synthesize basis for historical lower-level scalar fixtures or OPEN rows", async () => {
    const account = randomUUID();
    // Explicit historical core fixture, intentionally outside public admission.
    const legacy = createReportingPeriodLifecycleService({ repository: createPostgresReportingPeriodRepository(db()), writeAudit: () => "inert" });
    await legacy.openReportingPeriod(scope(), { exchangeAccountId: account, periodStart: start, startingEquity: "100", startingSnapshotAt: start,
      openPositionsSnapshotRef: "legacy", valuationSource: "legacy" });
    await expect(read(account)).rejects.toMatchObject({ code: "PERIOD_NOT_CLOSED" });
    await legacy.closeReportingPeriod(scope(), billingV2PeriodCloseEvidence({ organizationId: org, accountId: account, periodStart: start, periodEnd: end,
      realizedPnl: "0", unrealizedPnl: "0" }));
    expect(await read(account)).toEqual({ status: "BASIS_MISSING", basis: null });
  });
  it("scopes foreign account/org/id before mapping, preserving literal whitespace", async () => {
    const f = await stored("100", ` ${randomUUID()} `); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const id = await periodId(f.account);
    for (const [organizationId, exchangeAccountId, periodId] of [[org, f.account.trim(), id], [org, f.account, randomUUID()], [randomUUID(), f.account, id]]) {
      await expect(readReportingPeriodBasisV1Postgres(db(), { organizationId }, { exchangeAccountId, periodId })).rejects.toMatchObject({ code: "BASIS_PERIOD_NOT_FOUND" });
    }
    expect((await read(f.account)).status).toBe("BASIS_REPLAYED_AT_CLOSE");
  });
  it("rejects actual held Drizzle transaction before membership or read", async () => {
    const f = await stored(); const member = vi.fn();
    await db().transaction(async (tx) => {
      await expect(readReportingPeriodBasisV1Postgres(tx, { organizationId: org, userId: user }, { periodId: randomUUID(), exchangeAccountId: f.account }, { assertMembership: member }))
        .rejects.toMatchObject({ code: "BASIS_TRANSACTION_OWNER_REQUIRED" });
    }); expect(member).not.toHaveBeenCalled();
  });
  it("establishes read-only repeatable snapshot before membership and captures input", async () => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const input = { periodId: await periodId(f.account), exchangeAccountId: f.account }, context = { organizationId: org, userId: user };
    const before = await effects(f.account);
    const result = await readReportingPeriodBasisV1Postgres(db(), context, input, { assertMembership: async (_actor, bound) => {
      const rows = await bound.execute(sql`SELECT current_setting('transaction_read_only') AS ro,current_setting('transaction_isolation') AS isolation`);
      expect(rows[0]).toMatchObject({ ro: "on", isolation: "repeatable read" });
      input.exchangeAccountId = "mutated"; context.organizationId = randomUUID();
    } });
    expect(result.status).toBe("BASIS_REPLAYED_AT_CLOSE"); expect(await effects(f.account)).toEqual(before);
    await expect(readReportingPeriodBasisV1Postgres(db(), { organizationId: org, userId: user }, { periodId: await periodId(f.account), exchangeAccountId: f.account },
      { assertMembership: async (_actor, bound) => { await bound.execute(sql`UPDATE trader_reporting_periods SET updated_at=updated_at WHERE id=${input.periodId}::uuid`); } }))
      .rejects.toThrow(/read.only|UPDATE|query/i);
    expect(await effects(f.account)).toEqual(before);
  });
  it("actual authorized HTTP consumer replays and disposes once", async () => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const runtime = { kind: "postgres" as const, db: db() }, dispose = vi.fn(async () => {});
    const result = await handleAdminReportingPeriodBasisGet(new Request(`https://offline.invalid/basis?organization_id=${org}&exchange_account_id=${f.account}`), await periodId(f.account), {
      getUserId: async () => user, getRuntimeDb: async () => runtime, disposeRuntimeDb: dispose,
    });
    expect(result).toMatchObject({ status: 200, body: { status: "BASIS_REPLAYED_AT_CLOSE", currentEconomicValidity: "NOT_ASSESSED" } });
    expect(dispose).toHaveBeenCalledTimes(1); expect(dispose).toHaveBeenCalledWith(runtime);
  });
  it.each(["basis", "period", "closeAudit", "invoice", "invoiceAudit"])("rolls back the whole public close on real %s fault", async (at) => {
    const f = await stored(), before = await effects(f.account);
    const table = at === "basis" ? "trader_reporting_period_bases_v1" : at === "period" ? "trader_reporting_periods" : at === "invoice" ? "trader_invoices" : "audit_logs";
    const predicate = at === "closeAudit" ? "NEW.action='trader.reporting_period.closed'" : at === "invoiceAudit" ? "NEW.action='trader.invoice.draft_generated'" : at === "period" ? "NEW.status='CLOSED'" : "true";
    await client.unsafe(`CREATE FUNCTION dee1125_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'DEE1125_FAULT'; END IF; RETURN NEW; END $$`);
    await client.unsafe(`CREATE TRIGGER dee1125_fault BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION dee1125_fault()`);
    try {
      await expect(createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input)).rejects.toThrow();
      expect(await effects(f.account)).toEqual(before);
    } finally { await client.unsafe(`DROP TRIGGER dee1125_fault ON ${table}`); await client.unsafe("DROP FUNCTION dee1125_fault()"); }
  });
  it("two real competing closes retain exactly one basis and effect set", async () => {
    const f = await stored(), worker = postgres(url!, { max: 1 });
    try {
      const results = await Promise.allSettled([createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input),
        createPostgresBillingPeriodCloseOrchestrator(drizzle(worker, { schema })).closeAndMaterialize(scope(), f.input)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(loser.reason).toMatchObject({ code: "DUPLICATE_BILLING_PERIOD_SCOPE" });
      const state = await effects(f.account); expect(state.bases).toHaveLength(1); expect(state.periods).toHaveLength(1); expect(state.invoices).toHaveLength(1);
    } finally { await worker.end({ timeout: 5 }); }
  });
  async function alteredBasis(account: string, change: (body: Record<string, unknown>) => void, inspect: () => Promise<void>) {
    const original = (await client`SELECT canonical_json,content_digest FROM trader_reporting_period_bases_v1 WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`)[0];
    const body = JSON.parse(original.canonical_json as string); delete body.contentDigestHex; change(body);
    const changed = { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
    await client.unsafe("ALTER TABLE trader_reporting_period_bases_v1 DISABLE TRIGGER trader_reporting_period_bases_v1_append_only");
    try {
      await client`UPDATE trader_reporting_period_bases_v1 SET canonical_json=${canonicalizeSemanticJsonString(changed)},content_digest=${changed.contentDigestHex}
        WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`;
      await inspect();
    } finally {
      await client`UPDATE trader_reporting_period_bases_v1 SET canonical_json=${original.canonical_json as string},content_digest=${original.content_digest as string}
        WHERE organization_id=${org}::uuid AND exchange_account_id=${account}`;
      await client.unsafe("ALTER TABLE trader_reporting_period_bases_v1 ENABLE TRIGGER trader_reporting_period_bases_v1_append_only");
    }
  }
  it("retained body with a missing saved source is available only with explicit replay-unavailable status", async () => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    await alteredBasis(f.account, (body) => {
      const manifest = body.ledgerReadSet as { sources: { id: string }[] };
      manifest.sources[0].id = "f".repeat(64); manifest.sources.sort((a,b) => a.id < b.id ? -1 : 1);
    }, async () => { expect(await read(f.account)).toMatchObject({ status: "BASIS_SOURCE_REPLAY_UNAVAILABLE", reason: "MISSING_IDENTITIES", currentEconomicValidity: "NOT_ASSESSED" }); });
    expect((await read(f.account)).status).toBe("BASIS_REPLAYED_AT_CLOSE");
  });
  it.each(["sourceDigest", "cashflow", "unknownProof"])("refuses privileged %s tampering even after outer re-seal", async (kind) => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    await alteredBasis(f.account, (body) => {
      if (kind === "sourceDigest") (body.ledgerReadSet as { sources: { contentDigestHex: string }[] }).sources[0].contentDigestHex = "0".repeat(64);
      if (kind === "cashflow") (body.settlements as { cashflowFacts: { amount: string }[] }[])[0].cashflowFacts[0].amount = "1000";
      if (kind === "unknownProof") (body.dependencies as { priorConsumption: string }).priorConsumption = "PROVEN";
    }, async () => { await expect(read(f.account)).rejects.toMatchObject({ code: kind === "sourceDigest" ? "BASIS_SOURCE_REPLAY_MISMATCH" : "BASIS_CONTENT_INVALID" }); });
  });
  it("missing basis table refuses reader and rolls back new financial close", async () => {
    const closed = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), closed.input);
    const next = await stored(), id = await periodId(closed.account);
    await client.unsafe("ALTER TABLE trader_reporting_period_bases_v1 RENAME TO dee1125_unavailable_basis");
    try {
      await expect(read(closed.account, id)).rejects.toMatchObject({ code: "BASIS_SCHEMA_UNAVAILABLE" });
      await expect(createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), next.input)).rejects.toThrow();
      expect(await client`SELECT id FROM trader_reporting_periods WHERE organization_id=${org}::uuid AND exchange_account_id=${next.account}`).toHaveLength(0);
      expect(await client`SELECT id FROM trader_hwm_ledger WHERE organization_id=${org}::uuid AND exchange_account_id=${next.account}`).toHaveLength(0);
      expect(await client`SELECT id FROM trader_invoices WHERE organization_id=${org}::uuid AND exchange_account_id=${next.account}`).toHaveLength(0);
    } finally { await client.unsafe("ALTER TABLE dee1125_unavailable_basis RENAME TO trader_reporting_period_bases_v1"); }
  });
  it("limited application role really inserts/replays while append-only guards refuse UPDATE/DELETE", async () => {
    const f = await stored(), role = `dee1125_${randomUUID().replaceAll("-", "")}`, connection = postgres(url!, { max: 1 });
    try {
      await client.unsafe(`CREATE ROLE ${role} NOLOGIN BYPASSRLS`);
      await client.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
      await client.unsafe(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      await client.unsafe(`GRANT INSERT,UPDATE ON trader_reporting_periods,trader_hwm_ledger,trader_invoices,audit_logs TO ${role}`);
      await client.unsafe(`GRANT INSERT,UPDATE,DELETE ON trader_reporting_period_bases_v1 TO ${role}`);
      await connection.unsafe(`SET ROLE ${role}`);
      expect((await connection`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)[0].rolsuper).toBe(false);
      await createPostgresBillingPeriodCloseOrchestrator(drizzle(connection, { schema })).closeAndMaterialize(scope(), f.input);
      expect((await readReportingPeriodBasisV1Postgres(drizzle(connection, { schema }), scope(), { periodId: await periodId(f.account), exchangeAccountId: f.account })).status).toBe("BASIS_REPLAYED_AT_CLOSE");
      await expect(connection`UPDATE trader_reporting_period_bases_v1 SET content_digest=content_digest WHERE exchange_account_id=${f.account}`).rejects.toThrow("REPORTING_PERIOD_BASIS_APPEND_ONLY");
      await expect(connection`DELETE FROM trader_reporting_period_bases_v1 WHERE exchange_account_id=${f.account}`).rejects.toThrow("REPORTING_PERIOD_BASIS_APPEND_ONLY");
    } finally { await connection.end({ timeout: 5 }); await client.unsafe(`DROP OWNED BY ${role}`); await client.unsafe(`DROP ROLE ${role}`); }
  });
  it.each(["anon", "authenticated"])("denies browser role %s SELECT and INSERT", async (role) => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const connection = postgres(url!, { max: 1 });
    try {
      await connection.unsafe(`SET ROLE ${role}`);
      await expect(connection`SELECT content_digest FROM trader_reporting_period_bases_v1`).rejects.toThrow(/permission denied/);
      await expect(connection`INSERT INTO trader_reporting_period_bases_v1 (reporting_period_id) VALUES(${randomUUID()}::uuid)`).rejects.toThrow(/permission denied/);
      // Independent RLS defense, rather than interpreting ACL denial as a policy test.
      await client.unsafe(`GRANT SELECT ON trader_reporting_period_bases_v1 TO ${role}`);
      expect(await connection`SELECT content_digest FROM trader_reporting_period_bases_v1`).toHaveLength(0);
    } finally { await client.unsafe(`REVOKE SELECT ON trader_reporting_period_bases_v1 FROM ${role}`); await connection.end({ timeout: 5 }); }
  });
  it("real SQL rejects oversize body before any additional row survives", async () => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    await expect(client`INSERT INTO trader_reporting_period_bases_v1 SELECT reporting_period_id,organization_id,exchange_account_id,schema_version,
      period_record_content_digest,receipt_content_digest,content_digest,reality_projection_id,reality_frontier_sequence,reality_frontier_event_digest,
      reality_knowledge_as_of,canonical_json || repeat(' ',16777216),recorded_at FROM trader_reporting_period_bases_v1 WHERE exchange_account_id=${f.account}`)
      .rejects.toThrow(/canonical_json_check/);
    expect((await effects(f.account)).bases).toHaveLength(1);
  });
  it("new reader refuses over4096 identities before body SQL on a real executor", async () => {
    await expect(readExactRealityLedgerV2(db(), { organizationId: org, accountId: randomUUID() }, {
      sourceIds: Array.from({ length: 4097 }, (_, i) => i.toString(16).padStart(64, "0")), truthIds: [], eventIds: [], projectionId: "f".repeat(64),
    })).rejects.toMatchObject({ reason: "CAPACITY_EXCEEDED" });
  });
  it.each(["source", "projection"])("SQL preflight refuses oversized selected %s before mapper/body transfer", async (kind) => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const basis = (await read(f.account)).basis!;
    const table = kind === "source" ? "trader_reality_source_reports_v2" : "trader_reality_projections_v2";
    const column = kind === "source" ? "primitive_assertion" : "stable_entries";
    const id = kind === "source" ? basis.ledgerReadSet.sources[0].id : basis.ledgerReadSet.projectionId;
    const original = (await client.unsafe(`SELECT ${column} AS body FROM ${table} WHERE id=$1`, [id]))[0].body;
    await client.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_update`);
    try {
      if (kind === "source") await client.unsafe(`UPDATE ${table} SET primitive_assertion=primitive_assertion || jsonb_build_object('oversize',repeat('x',1048577)) WHERE id=$1`, [id]);
      else await client.unsafe(`UPDATE ${table} SET stable_entries=stable_entries || jsonb_build_array(jsonb_build_object('oversize',repeat('x',16777217))) WHERE id=$1`, [id]);
      expect(await read(f.account)).toMatchObject({ status: "BASIS_SOURCE_REPLAY_UNAVAILABLE", reason: "CAPACITY_EXCEEDED", basis });
    } finally {
      await client.unsafe(`UPDATE ${table} SET ${column}=$1::jsonb WHERE id=$2`, [JSON.stringify(original), id]);
      await client.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_update`);
    }
    expect((await read(f.account)).status).toBe("BASIS_REPLAYED_AT_CLOSE");
  });
  it("oversize newly built basis rolls back all financial writes", async () => {
    const f = await stored(), before = await effects(f.account);
    f.input.openPositionsSnapshotRef = "x".repeat(16 * 1024 * 1024);
    await expect(createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input)).rejects.toMatchObject({ code: "BASIS_CAPACITY_EXCEEDED" });
    expect(await effects(f.account)).toEqual(before);
  });
  it("captures close input while675 blocks and lets another account progress", async () => {
    const f = await stored(), other = await stored();
    const worker = postgres(url!, { max: 1, connection: { application_name: "dee1125-blocked-close" } });
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }), ready = new Promise<void>((resolve) => { entered = resolve; });
    const lock = client.begin(async (held) => { await held`SELECT pg_advisory_xact_lock(hashtextextended(${org + ":" + f.account},675))`; entered(); await gate; });
    await ready;
    const capturedReceipt = structuredClone(f.input.realizedStrategyProfitReceipt), capturedSettlements = structuredClone(f.input.closedTradeSettlements);
    const pending = createPostgresBillingPeriodCloseOrchestrator(drizzle(worker, { schema })).closeAndMaterialize(scope(), f.input);
    try {
      let blocked = false;
      for (let i = 0; i < 60; i++) { const rows = await client`SELECT pid FROM pg_stat_activity WHERE application_name='dee1125-blocked-close' AND cardinality(pg_blocking_pids(pid))>0`; if (rows.length) { blocked = true; break; } await delay(15); }
      expect(blocked).toBe(true);
      (f.input.closedTradeSettlements as unknown[]).length = 0; f.input.periodEnd.setUTCFullYear(2030);
      await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), other.input);
      release(); await lock; await pending;
      const result = await read(f.account);
      expect(result.basis?.receipt).toEqual(capturedReceipt); expect(result.basis?.settlements).toEqual(capturedSettlements);
      expect(result.basis?.period.periodEnd).toBe(end.toISOString());
    } finally { release(); await lock; await pending.catch(() => {}); await worker.end({ timeout: 5 }); }
  });
  it("holds675 through basis, audit and DRAFT until commit while a real source writer waits", async () => {
    const f = await stored(), other = await stored(), accountScope = { organizationId: org, accountId: f.account };
    const prepared = await prepareBillingRealitySourceFixture(db(), accountScope,
      { kind: "REALIZED_CASHFLOW", cashflowId: randomUUID(), asset: "USD", amount: "4", direction: "INFLOW", causeNativeId: "after-close" });
    const barrier = postgres(url!, { max: 1 }), closer = postgres(url!, { max: 1, connection: { application_name: "dee1125-close-at-basis" } });
    const writer = postgres(url!, { max: 1, connection: { application_name: "dee1125-source-behind-close" } });
    let pendingClose: Promise<unknown> | undefined, pendingSource: Promise<unknown> | undefined;
    await barrier`SELECT pg_advisory_lock(1125,1)`;
    await client.unsafe(`CREATE FUNCTION dee1125_pause_basis() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.exchange_account_id='${f.account}' THEN PERFORM pg_advisory_xact_lock(1125,1); END IF; RETURN NEW; END $$`);
    await client.unsafe("CREATE TRIGGER dee1125_pause_basis BEFORE INSERT ON trader_reporting_period_bases_v1 FOR EACH ROW EXECUTE FUNCTION dee1125_pause_basis()");
    const blocked = async (name: string) => {
      for (let i = 0; i < 100; i++) { if ((await client`SELECT pid FROM pg_stat_activity WHERE application_name=${name} AND cardinality(pg_blocking_pids(pid))>0`).length) return true; await delay(15); }
      return false;
    };
    try {
      pendingClose = createPostgresBillingPeriodCloseOrchestrator(drizzle(closer, { schema })).closeAndMaterialize(scope(), f.input);
      expect(await blocked("dee1125-close-at-basis")).toBe(true);
      pendingSource = ingestRealitySourceReportV2Postgres(drizzle(writer, { schema }), accountScope, prepared);
      expect(await blocked("dee1125-source-behind-close")).toBe(true);
      expect((await effects(f.account)).periods).toHaveLength(0);
      await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), other.input);
      await barrier`SELECT pg_advisory_unlock(1125,1)`;
      await pendingClose; await pendingSource;
      const retained = await read(f.account), state = await effects(f.account);
      expect(retained.status).toBe("BASIS_REPLAYED_AT_CLOSE");
      expect(retained.basis?.ledgerReadSet.sources).toHaveLength(3);
      expect(state.bases).toHaveLength(1); expect(state.invoices).toHaveLength(1); expect(state.audits.length).toBeGreaterThanOrEqual(2);
      expect(await client`SELECT id FROM trader_reality_source_reports_v2 WHERE organization_id=${org}::uuid AND account_id=${f.account}`).toHaveLength(4);
    } finally {
      await barrier`SELECT pg_advisory_unlock(1125,1)`;
      await Promise.allSettled([pendingClose, pendingSource]);
      await client.unsafe("DROP TRIGGER dee1125_pause_basis ON trader_reporting_period_bases_v1"); await client.unsafe("DROP FUNCTION dee1125_pause_basis()");
      await Promise.all([barrier.end({ timeout: 5 }), closer.end({ timeout: 5 }), writer.end({ timeout: 5 })]);
    }
  });
  it("a direct close basis fault preserves the existing OPEN row and HWM exactly", async () => {
    const f = await stored();
    await createPostgresHwmLedgerService(db()).bootstrapHwm(scope(), { exchangeAccountId: f.account, initialHwm: "0", valuationSource: "synthetic", effectiveAt: start });
    const lifecycle = createPostgresReportingPeriodLifecycleService(db());
    await lifecycle.openReportingPeriod(scope(), f.input);
    const before = await effects(f.account);
    await client.unsafe("CREATE FUNCTION dee1125_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DEE1125_FAULT'; END $$");
    await client.unsafe("CREATE TRIGGER dee1125_fault BEFORE INSERT ON trader_reporting_period_bases_v1 FOR EACH ROW EXECUTE FUNCTION dee1125_fault()");
    try { await expect(lifecycle.closeReportingPeriod(scope(), f.evidence)).rejects.toThrow(); expect(await effects(f.account)).toEqual(before); }
    finally { await client.unsafe("DROP TRIGGER dee1125_fault ON trader_reporting_period_bases_v1"); await client.unsafe("DROP FUNCTION dee1125_fault()"); }
  });
  it("internal held insert is idempotent only for identical canonical body; public repeat still refuses", async () => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const basis = (await read(f.account)).basis!, before = await effects(f.account);
    // Deliberate lower-level storage collision fixture; no public close bypass.
    await db().transaction(async (tx) => {
      const repository = createPostgresReportingPeriodRepository(tx), period = (await repository.getById(scope(), basis.reportingPeriodId))!;
      const owned = { context: scope(), candidate: candidateFromReportingPeriodBasis(basis), dependencies: basis.dependencies, ledgerReadSet: basis.ledgerReadSet };
      const retained = withReportingPeriodBasisRetention(tx, { ...repository, closePeriod: async () => period }, owned);
      expect(await retained.closePeriod(scope(), { id: period.id, payload: period })).toEqual(period);
    });
    await expect(db().transaction(async (tx) => {
      const repository = createPostgresReportingPeriodRepository(tx), period = (await repository.getById(scope(), basis.reportingPeriodId))!;
      const context = { organizationId: org, userId: user };
      const retained = withReportingPeriodBasisRetention(tx, { ...repository, closePeriod: async () => period }, {
        context, candidate: candidateFromReportingPeriodBasis(basis), dependencies: basis.dependencies, ledgerReadSet: basis.ledgerReadSet });
      await retained.closePeriod(context, { id: period.id, payload: period });
    })).rejects.toMatchObject({ code: "BASIS_CONTENT_INVALID" });
    await expect(createPostgresReportingPeriodLifecycleService(db()).closeReportingPeriod(scope(), f.evidence)).rejects.toMatchObject({ code: "REPORTING_PERIOD_NOT_OPEN" });
    expect(await effects(f.account)).toEqual(before);
  });
  it.each(["account", "organization", "periodDigest", "receiptDigest"])("real insert refuses changed duplicated %s without creating another row", async (kind) => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    // BEFORE INSERT scope/period guard and SQL body duplicate checks run even on a conflicting period ID.
    const columns = ["reporting_period_id", "organization_id", "exchange_account_id", "schema_version", "period_record_content_digest",
      "receipt_content_digest", "content_digest", "reality_projection_id", "reality_frontier_sequence", "reality_frontier_event_digest", "reality_knowledge_as_of", "canonical_json", "recorded_at"];
    const selected = columns.map((c) => kind === "account" && c === "exchange_account_id" ? "'wrong-account'" :
      kind === "organization" && c === "organization_id" ? `'${randomUUID()}'::uuid` :
      kind === "periodDigest" && c === "period_record_content_digest" || kind === "receiptDigest" && c === "receipt_content_digest" ? "repeat('0',64)" : c);
    await expect(client.unsafe(`INSERT INTO trader_reporting_period_bases_v1 (${columns.join(",")}) SELECT ${selected.join(",")} FROM trader_reporting_period_bases_v1 WHERE exchange_account_id=$1 ON CONFLICT DO NOTHING`, [f.account]))
      .rejects.toThrow(kind === "receiptDigest" ? /trader_reporting_period_bases_v1_body/ : /REPORTING_PERIOD_BASIS_PERIOD_MISMATCH/);
    expect((await effects(f.account)).bases).toHaveLength(1);
  });
  it("real insert refuses attaching a closed basis to an existing OPEN period", async () => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const open = await stored(); await createPostgresReportingPeriodLifecycleService(db()).openReportingPeriod(scope(), open.input);
    const id = await periodId(open.account);
    await expect(client`INSERT INTO trader_reporting_period_bases_v1 SELECT ${id}::uuid,organization_id,${open.account},schema_version,
      period_record_content_digest,receipt_content_digest,content_digest,reality_projection_id,reality_frontier_sequence,reality_frontier_event_digest,
      reality_knowledge_as_of,canonical_json,recorded_at FROM trader_reporting_period_bases_v1 WHERE exchange_account_id=${f.account}`)
      .rejects.toThrow("REPORTING_PERIOD_BASIS_PERIOD_MISMATCH");
    expect((await effects(open.account)).bases).toHaveLength(0);
  });
  it("read-only RR keeps one snapshot when the same basis changes after membership starts", async () => {
    const f = await stored(); await createPostgresBillingPeriodCloseOrchestrator(db()).closeAndMaterialize(scope(), f.input);
    const id = await periodId(f.account), original = await read(f.account);
    const row = (await client`SELECT canonical_json,content_digest FROM trader_reporting_period_bases_v1 WHERE reporting_period_id=${id}::uuid`)[0];
    const body = JSON.parse(row.canonical_json); delete body.contentDigestHex; body.ledgerReadSet.sources[0].contentDigestHex = "0".repeat(64);
    const changed = { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
    await client.unsafe("ALTER TABLE trader_reporting_period_bases_v1 DISABLE TRIGGER trader_reporting_period_bases_v1_append_only");
    try {
      const result = await readReportingPeriodBasisV1Postgres(db(), { organizationId: org, userId: user }, { periodId: id, exchangeAccountId: f.account }, {
        assertMembership: async (_actor, tx) => {
          await tx.execute(sql`SELECT 1`); // Pins the RR snapshot before the concurrent commit.
          await client`UPDATE trader_reporting_period_bases_v1 SET canonical_json=${canonicalizeSemanticJsonString(changed)},content_digest=${changed.contentDigestHex} WHERE reporting_period_id=${id}::uuid`;
        },
      });
      expect(result).toEqual(original);
      await expect(read(f.account)).rejects.toMatchObject({ code: "BASIS_SOURCE_REPLAY_MISMATCH" });
    } finally {
      await client`UPDATE trader_reporting_period_bases_v1 SET canonical_json=${row.canonical_json},content_digest=${row.content_digest} WHERE reporting_period_id=${id}::uuid`;
      await client.unsafe("ALTER TABLE trader_reporting_period_bases_v1 ENABLE TRIGGER trader_reporting_period_bases_v1_append_only");
    }
  });
});
