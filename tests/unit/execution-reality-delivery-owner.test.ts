import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createExecutionReportV2 } from "@/lib/trader/execution/v2/contracts";
const ports = vi.hoisted(() => ({ attempt: vi.fn(), plan: vi.fn(), reports: vi.fn(), lock: vi.fn(),
  sources: vi.fn(), truths: vi.fn(), events: vi.fn(), projection: vi.fn(), ingest: vi.fn() }));
vi.mock("@/lib/trader/execution/v2/repository-postgres", () => ({
  readExecutionAttemptProjectionV2Postgres: ports.attempt, readExecutionPlanV2Postgres: ports.plan,
  listExecutionReportPrefixV2Postgres: ports.reports,
}));
vi.mock("@/lib/trader/reality/v2/repository-postgres", () => ({
  lockRealityScopeV2: ports.lock, listRealitySourceReportsV2: ports.sources, listTruthRecordsV2: ports.truths,
  listRealityEventsV2: ports.events, readLatestRealityProjectionV2: ports.projection,
}));
vi.mock("@/lib/trader/reality/v2/ingest-postgres", () => ({ ingestRealitySourceReportV2FromWriter: ports.ingest }));
import { catchUpExecutionRealityV2Postgres } from "@/lib/trader/reality/v2/execution-report-delivery-postgres";
const input = { organizationId: "00000000-0000-4000-8000-000000001122", accountId: "fixture",
  executionAttemptId: "00000000-0000-4000-8000-000000001123" };
const digest = "a".repeat(64);
const attempt = { ...input, contentDigestHex: digest, venue: "HTX", executionPlanId: input.executionAttemptId,
  executionPlanContentDigestHex: digest, riskAllowanceId: input.executionAttemptId, riskAllowanceContentDigestHex: digest,
  orderId: input.executionAttemptId, clientOrderId: "client", exactRequestPayload: { symbol: "BTCUSDT", side: "buy", type: "limit", quantity: "1", price: "1" } };
const report = createExecutionReportV2({ ...input, executionReportId: "00000000-0000-4000-8000-000000001124",
  executionAttemptContentDigestHex: digest, reportSequence: "1", reportType: "ATTEMPT_BOUND", source: "EXECUTION",
  rawObservation: {}, venueOrderId: null, observedAtUtc: "2026-09-20T10:00:00.000Z", previousReportDigestHex: null });
let queries: string[];
let metadata: Record<string, string>;
let db: WaiaPostgresDb;
let transaction: ReturnType<typeof vi.fn>;
let execute: ReturnType<typeof vi.fn>;
const dialect = new PgDialect();
beforeEach(() => {
  Object.values(ports).forEach((fn) => fn.mockReset()); queries = [];
  metadata = { attempt_bytes: "100", plan_bytes: "100", row_count: "1", maximum_bytes: "100", total_bytes: "100" };
  ports.attempt.mockResolvedValue({ attempt, nextReportSequence: "2", lastReportDigestHex: report.contentDigestHex });
  ports.plan.mockResolvedValue({ accountId: input.accountId, contentDigestHex: digest, riskAllowanceId: attempt.riskAllowanceId,
    riskAllowanceContentDigestHex: digest, venue: "HTX" });
  ports.reports.mockResolvedValue([report]); ports.sources.mockResolvedValue([]); ports.truths.mockResolvedValue([]);
  ports.events.mockResolvedValue([]); ports.projection.mockResolvedValue(null);
  execute = vi.fn(async (query) => {
    const text = dialect.sqlToQuery(query).sql; queries.push(text);
    if (text.includes("SET TRANSACTION")) return [];
    if (text.includes("FROM public.trader_execution_attempts_v2")) return [metadata];
    if (text.includes("FROM public.trader_orders")) return [{ binding_valid: true, supported: true }];
    if (text.includes("bounded_reports")) return [metadata];
    if (text.includes("bounded_ids")) return [{ row_count: "0" }];
    if (text.includes("bounded_rows")) return [{ row_count: "0", maximum_bytes: "0", total_bytes: "0" }];
    if (text.includes("trader_reality_projections_v2")) return [];
    throw new Error(`unhandled inert query ${text}`);
  });
  const tx = { execute, select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ contentDigest: digest }] }) }) }) };
  transaction = vi.fn(async (callback) => callback(tx));
  db = Object.assign(Object.create(PostgresJsDatabase.prototype), { transaction });
});
describe("DEE1122 actual owner with inert metadata/read ports (no database proof)", () => {
  it("captures exact values before waiting and sets RC before lock/data", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    ports.lock.mockImplementation(async () => { expect(queries).toEqual(["SET TRANSACTION ISOLATION LEVEL READ COMMITTED"]); await waiting; });
    ports.attempt.mockResolvedValue({ attempt, nextReportSequence: "1", lastReportDigestHex: null });
    const supplied = { ...input }; const pending = catchUpExecutionRealityV2Postgres(db, supplied);
    supplied.accountId = "changed"; release();
    expect(await pending).toMatchObject({ status: "NO_REPORTS", accountId: "fixture", realityExamined: false, projection: null });
    expect(ports.lock).toHaveBeenCalledWith(expect.anything(), { organizationId: input.organizationId, accountId: "fixture" });
    expect(ports.sources).not.toHaveBeenCalled(); expect(ports.ingest).not.toHaveBeenCalled();
  });
  it("refuses aliases and held/incompatible executors before any query", async () => {
    for (const owner of [{}, { ...db, rollback: () => undefined }]) {
      expect(await catchUpExecutionRealityV2Postgres(owner as WaiaPostgresDb, input)).toMatchObject({ code: "TRANSACTION_OWNER_REQUIRED" });
    }
    expect(await catchUpExecutionRealityV2Postgres(db, { ...input, accountId: " fixture" })).toMatchObject({ code: "INVALID_INPUT" });
    expect(transaction).not.toHaveBeenCalled(); expect(ports.lock).not.toHaveBeenCalled();
  });
  it.each(["258", "9007199254740993", "9223372036854775807"])("rejects exact oversized head%s before report bodies", async (next) => {
    ports.attempt.mockResolvedValue({ attempt, nextReportSequence: next, lastReportDigestHex: digest });
    expect(await catchUpExecutionRealityV2Postgres(db, input)).toMatchObject({ status: "REFUSED", code: "CAPACITY_EXCEEDED",
      detail: { bound: "reports", observed: (BigInt(next) - 1n).toString(), maximum: "256" } });
    expect(ports.reports).not.toHaveBeenCalled(); expect(ports.sources).not.toHaveBeenCalled();
  });
  it.each(["attempt_bytes", "plan_bytes", "maximum_bytes", "total_bytes"])("rejects%s metadata before unrestricted body load", async (field) => {
    metadata[field] = "9007199254740993";
    expect(await catchUpExecutionRealityV2Postgres(db, input)).toMatchObject({ status: "REFUSED", code: "CAPACITY_EXCEEDED" });
    expect(ports.reports).not.toHaveBeenCalled(); expect(ports.ingest).not.toHaveBeenCalled();
    if (field.endsWith("_bytes") && ["attempt_bytes", "plan_bytes"].includes(field)) expect(ports.attempt).not.toHaveBeenCalled();
  });
  it.each(["rows", "rowBytes", "allBytes", "projectionBytes"])("rejects account%s before affected list/body reader", async (kind) => {
    const original = execute.getMockImplementation()!;
    execute.mockImplementation(async (query) => {
      const text = dialect.sqlToQuery(query).sql;
      if (kind === "rows" && text.includes("bounded_ids")) return [{ row_count: "4096" }]; // one reserved draft
      if (kind === "rowBytes" && text.includes("bounded_rows")) return [{ row_count: "1", maximum_bytes: "1048577", total_bytes: "1048577" }];
      if (kind === "allBytes" && text.includes("bounded_rows")) return [{ row_count: "100", maximum_bytes: "1048576", total_bytes: "33554433" }];
      if (kind === "projectionBytes" && text.includes("trader_reality_projections_v2")) return [{ id: "oversized", bytes: "16777217" }];
      return original(query);
    });
    expect(await catchUpExecutionRealityV2Postgres(db, input)).toMatchObject({ code: "CAPACITY_EXCEEDED" });
    if (kind !== "projectionBytes") expect(ports.sources).not.toHaveBeenCalled();
    expect(ports.projection).not.toHaveBeenCalled(); expect(ports.ingest).not.toHaveBeenCalled();
  });
  it("reports callback failure only after transaction wrapper rejects the same error", async () => {
    ports.ingest.mockRejectedValue(new Error("synthetic writer failure"));
    expect(await catchUpExecutionRealityV2Postgres(db, input)).toMatchObject({ status: "FAILED", newDeliveryCommitted: false });
    expect(ports.ingest).toHaveBeenCalledTimes(1);
  });
  it("does not claim rollback when wrapper substitutes a connection/rollback failure", async () => {
    ports.ingest.mockRejectedValue(new Error("synthetic writer failure"));
    const original = transaction.getMockImplementation()!;
    transaction.mockImplementation(async (callback) => { try { await original(callback); } catch { throw new Error("connection lost"); } });
    expect(await catchUpExecutionRealityV2Postgres(db, input)).toMatchObject({ status: "COMMIT_OUTCOME_UNKNOWN", newDeliveryCommitted: "UNKNOWN" });
  });
  it("does not claim rollback after callback completion when commit acknowledgement fails", async () => {
    ports.attempt.mockResolvedValue({ attempt, nextReportSequence: "1", lastReportDigestHex: null });
    const original = transaction.getMockImplementation()!;
    transaction.mockImplementation(async (callback) => { await original(callback); throw new Error("commit acknowledgement lost"); });
    expect(await catchUpExecutionRealityV2Postgres(db, input)).toMatchObject({ status: "COMMIT_OUTCOME_UNKNOWN", retry: "REPEAT_REPORT_DELIVERY_ONLY" });
  });
});
