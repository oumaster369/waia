import { describe, expect, it, vi } from "vitest";
import { readExactRealityLedgerV2, type RealityV2Executor } from "@/lib/trader/reality/v2/repository-postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { readReportingPeriodBasisV1Postgres } from "@/lib/trader/billing/v2/reporting-period-basis-postgres-v1";
import { pureBillingRealityFixture } from "@/tests/helpers/billing-reality-evidence";
import { buildReportingPeriodRecordPayload } from "@/lib/trader/billing/serialize-reporting-period";
import { matchBillingRealityDependencies } from "@/lib/trader/billing/v2/reality-dependencies-v1";
import { canonicalizeSemanticJsonString as canonicalJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { assertReportingPeriodBasisCapacity, buildReportingPeriodBasisV1, captureReportingPeriodBasisReadSet,
  parseReportingPeriodBasisV1, REPORTING_PERIOD_BASIS_MAX_BYTES } from "@/lib/trader/billing/v2/reporting-period-basis-v1";

type TamperBody = Record<string, unknown> & {
  period: Record<string, unknown>; actor: Record<string, unknown>; dependencies: Record<string, unknown>; receipt: Record<string, unknown>;
  settlements: { cashflowFacts: Record<string, unknown>[]; costFacts: Record<string, unknown>[] }[];
  ledgerReadSet: { projectionId: string; sources: Record<string, unknown>[]; events: Record<string, unknown>[] };
};
const org = "00000000-0000-4000-8000-000000001125", id = "00000000-0000-4000-8000-000000001126";
const start = new Date("2026-01-01T00:00:00.000Z"), end = new Date("2026-02-01T00:00:00.000Z");
function fixture(amount = "100.00000000") {
  const source = pureBillingRealityFixture({ organizationId: org, accountId: " exact account ", periodStart: start, periodEnd: end, realizedPnl: amount });
  const dependencies = matchBillingRealityDependencies({ organizationId: org, ...source });
  const period = { id, ...buildReportingPeriodRecordPayload({ organizationId: org, exchangeAccountId: source.candidate.exchangeAccountId,
    periodStart: start, periodEnd: end, startingEquity: "10000.0", endingEquity: "10100.000", openPositionsSnapshotRef: "opaque-existing-ref",
    realizedPnl: amount, unrealizedPnl: "0", netDeposits: "0", netWithdrawals: "0", valuationSource: "synthetic-unproven",
    startingSnapshotAt: start, endingSnapshotAt: end, status: "CLOSED" }) };
  return { source, input: { period, candidate: source.candidate, dependencies,
    ledgerReadSet: captureReportingPeriodBasisReadSet(source.ledger, source.projection), actor: { type: "SERVICE" as const } } };
}

describe("DEE1125 immutable period basis grammar", () => {
  it.each(["100", "100.00000000", "-99.10", "0", "-0.000", "999999999999999999999999.00000001"])("preserves accepted exact profit %s without financial policy", (amount) => {
    const { input } = fixture(amount), basis = buildReportingPeriodBasisV1(input);
    const replayed = parseReportingPeriodBasisV1(canonicalJsonString(basis));
    expect(replayed).toEqual(basis);
    expect(replayed.period.realizedPnl).toBe(amount);
    expect(replayed.exchangeAccountId).toBe(" exact account ");
    expect(replayed.dependencies).toMatchObject({ economicAttribution: "UNPROVEN", periodCompleteness: "UNPROVEN", priorConsumption: "UNPROVEN", realizedFillFinality: "OPERATOR_VERIFICATION_REQUIRED" });
    expect(replayed.period.openPositionsSnapshotRef).toBe("opaque-existing-ref");
  });
  it("captures immutable full identities in deterministic order", () => {
    const { input, source } = fixture();
    expect(captureReportingPeriodBasisReadSet({ ...source.ledger, sources: [...source.ledger.sources].reverse(), truths: [...source.ledger.truths].reverse() }, source.projection)).toEqual(input.ledgerReadSet);
    const basis = buildReportingPeriodBasisV1(input);
    expect(Object.isFrozen(basis.receipt)).toBe(true);
    expect(basis.receipt.contentDigestHex).toBe(source.candidate.realizedStrategyProfitReceipt.contentDigestHex);
    expect(basis.settlements[0]).toEqual(source.candidate.closedTradeSettlements[0]);
  });
  it.each([
    ["extra top field", (b: TamperBody) => { b.extra = true; }],
    ["extra period field", (b: TamperBody) => { b.period.extra = true; }],
    ["extra actor field", (b: TamperBody) => { b.actor.userId = "invented"; }],
    ["false authority", (b: TamperBody) => { b.capitalAuthority = "LIVE"; }],
    ["proved economics", (b: TamperBody) => { b.dependencies.economicAttribution = "PROVEN"; }],
    ["scalar tamper", (b: TamperBody) => { b.period.realizedPnl = "1000"; }],
    ["receipt tamper", (b: TamperBody) => { b.receipt.netRealizedStrategyProfit = "1000"; }],
    ["cashflow tamper", (b: TamperBody) => { b.settlements[0].cashflowFacts[0].amount = "1000"; }],
    ["cost tamper", (b: TamperBody) => { b.settlements[0].costFacts[0].amount = "1000"; }],
    ["duplicate settlement", (b: TamperBody) => { b.settlements.push(b.settlements[0]); }],
    ["duplicate source", (b: TamperBody) => { b.ledgerReadSet.sources.push(b.ledgerReadSet.sources[0]); }],
    ["missing event", (b: TamperBody) => { b.ledgerReadSet.events.splice(0, 1); }],
    ["wrong event head", (b: TamperBody) => { b.ledgerReadSet.events.at(-1)!.contentDigestHex = "0".repeat(64); }],
    ["changed projection", (b: TamperBody) => { b.ledgerReadSet.projectionId = "0".repeat(64); }],
    ["source extra field", (b: TamperBody) => { b.ledgerReadSet.sources[0].proof = true; }],
  ] as const)("refuses %s even with a newly computed outer seal", (_label, tamper) => {
    const body = JSON.parse(canonicalJsonString(buildReportingPeriodBasisV1(fixture().input)));
    delete body.contentDigestHex; tamper(body);
    expect(() => parseReportingPeriodBasisV1(canonicalJsonString({ ...body, contentDigestHex: computeSemanticSha256Hex(body) }))).toThrow();
  });
  it("distinguishes unsupported envelope version", () => {
    const body = JSON.parse(canonicalJsonString(buildReportingPeriodBasisV1(fixture().input)));
    body.schemaVersion = "future-v2";
    expect(() => parseReportingPeriodBasisV1(canonicalJsonString(body))).toThrow("BASIS_VERSION_UNSUPPORTED");
  });
  it("rejects noncanonical text and old outer digest", () => {
    const basis = buildReportingPeriodBasisV1(fixture().input);
    expect(() => parseReportingPeriodBasisV1(JSON.stringify(basis, null, 2))).toThrow("BASIS_CONTENT_INVALID");
    expect(() => parseReportingPeriodBasisV1(canonicalJsonString({ ...basis, contentDigestHex: "0".repeat(64) }))).toThrow("BASIS_CONTENT_INVALID");
  });
  it("bounds UTF8 bytes at the exact technical limit", () => {
    expect(() => assertReportingPeriodBasisCapacity("x".repeat(REPORTING_PERIOD_BASIS_MAX_BYTES))).not.toThrow();
    expect(() => assertReportingPeriodBasisCapacity("x".repeat(REPORTING_PERIOD_BASIS_MAX_BYTES + 1))).toThrow("BASIS_CAPACITY_EXCEEDED");
    expect(() => assertReportingPeriodBasisCapacity("я".repeat(REPORTING_PERIOD_BASIS_MAX_BYTES / 2 + 1))).toThrow("BASIS_CAPACITY_EXCEEDED");
  });
  it("refuses over4096 historical identities before SQL", async () => {
    const execute = vi.fn(), select = vi.fn();
    await expect(readExactRealityLedgerV2({ execute, select } as unknown as RealityV2Executor, { organizationId: org, accountId: "a" },
      { sourceIds: Array.from({ length: 4097 }, (_, i) => i.toString(16).padStart(64, "0")), truthIds: [], eventIds: [], projectionId: "f".repeat(64) }))
      .rejects.toMatchObject({ reason: "CAPACITY_EXCEEDED" });
    expect(execute).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
  });
  it.each([
    ["source row", 0, "1048577", "1048577"],
    ["truth row", 1, "1048577", "1048577"],
    ["event row", 2, "1048577", "1048577"],
    ["aggregate", 2, "1048576", "33554432"],
    ["projection", 3, "16777217", "16777217"],
  ])("preflights %s overflow without materializing any body", async (_label, failIndex, max, total) => {
    let index = 0;
    const aggregate = _label === "aggregate";
    const execute = vi.fn(async () => [{ row_count: aggregate && index === 2 ? "32" : "1", max_bytes: index === failIndex ? max : "1", total_bytes: index++ === failIndex ? total : "1" }]);
    const select = vi.fn(() => { throw new Error("MUST_NOT_MATERIALIZE"); });
    await expect(readExactRealityLedgerV2({ execute, select } as unknown as RealityV2Executor, { organizationId: org, accountId: "a" },
      { sourceIds: ["1".repeat(64)], truthIds: ["2".repeat(64)], eventIds: aggregate ? Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(64, "0")) : ["3".repeat(64)], projectionId: "4".repeat(64) }))
      .rejects.toMatchObject({ reason: "CAPACITY_EXCEEDED" });
    expect(select).not.toHaveBeenCalled();
  });
  it("preflights missing identities separately from corrupt materialized bodies", async () => {
    const execute = vi.fn(async () => [{ row_count: "0", max_bytes: "0", total_bytes: "0" }]), select = vi.fn();
    await expect(readExactRealityLedgerV2({ execute, select } as unknown as RealityV2Executor, { organizationId: org, accountId: "a" },
      { sourceIds: ["1".repeat(64)], truthIds: [], eventIds: [], projectionId: "4".repeat(64) })).rejects.toMatchObject({ reason: "MISSING_IDENTITIES" });
    expect(select).not.toHaveBeenCalled();
  });
  it.each(["capacity", "version"])("owned reader refuses %s at header before loading the retained body", async (kind) => {
    const { input } = fixture(); let reads = 0;
    const tx = { execute: vi.fn(async () => []), select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => {
      reads++;
      if (reads === 1) return [{ ...input.period, createdAt: start, updatedAt: end }];
      if (reads === 2) return [{ schemaVersion: kind === "version" ? "future-v2" : "waia.trader.reporting_period_basis.v1", bytes: kind === "capacity" ? REPORTING_PERIOD_BASIS_MAX_BYTES + 1 : 1 }];
      throw new Error("BODY_MUST_NOT_TRANSFER");
    } }) }) })) };
    const db = { transaction: async (fn: (bound: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as WaiaPostgresDb;
    await expect(readReportingPeriodBasisV1Postgres(db, { organizationId: org }, { exchangeAccountId: input.period.exchangeAccountId, periodId: id }))
      .rejects.toMatchObject({ code: kind === "capacity" ? "BASIS_CAPACITY_EXCEEDED" : "BASIS_VERSION_UNSUPPORTED" });
    expect(reads).toBe(2); expect(tx.execute).toHaveBeenCalledTimes(1);
  });
});
