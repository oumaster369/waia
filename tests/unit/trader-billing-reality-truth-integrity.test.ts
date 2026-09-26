import { describe, expect, it, vi } from "vitest";

import { lookupClosedTradeSettlementsFromRealityV2 } from "@/lib/trader/billing/v2";
import { proveLiveFillReportingReadable } from "@/lib/trader/live/reporting-bridge";
import {
  createTruthRecordV2,
  validateTruthRecordV2,
  type RealityPrimitiveAssertionV2,
  type TruthRecordV2,
} from "@/lib/trader/reality/v2/contracts";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

const organizationId = "00000000-0000-4000-8000-000000001109";
const accountId = "truth-integrity-proof-account";
const scope = { organizationId, accountId, strategyId: "truth-integrity-proof-strategy" };
const venueOrderId = "synthetic-same-order-group";
const code = "LOOKUP_INVALID_TRUTH_RECORD";
const digest = (label: string) => computeSemanticSha256Hex({ label });

function truth(assertion: RealityPrimitiveAssertionV2, label: string, at: string): TruthRecordV2 {
  return createTruthRecordV2({
    organizationId,
    accountId,
    sourceReportId: digest(label),
    sourceReportDigestHex: digest(label),
    sourceKind: "HTX_SPOT_FILL_REST",
    sourceNativeIdentity: {
      identityKind: "HTX_TRADE_ID",
      nativeId: label,
      nativeRevision: null,
      supersedesNativeRevision: null,
    },
    subject: {
      subjectClass: assertion.kind,
      subjectKey: `HTX:${accountId}:${label}`,
    },
    primitiveAssertion: assertion,
    validAtUtc: at,
    knowledgeAtUtc: at,
    supersedesTruthRecordId: null,
    markers: [],
  });
}

function validRecords(): TruthRecordV2[] {
  // This existing lookup's synthetic same-order group is not a real cross-order
  // lifecycle, persisted Reality source or financial-finality qualification.
  return [
    truth({
      kind: "FILL", venueTradeId: "buy", venueOrderId, symbol: "BTCUSD", side: "buy",
      quantity: "1", price: "100", feeAmount: "0.01", feeAsset: "USD", settlementStatus: "SETTLED",
    }, "buy", "2026-09-01T00:00:00.000Z"),
    truth({
      kind: "FILL", venueTradeId: "sell", venueOrderId, symbol: "BTCUSD", side: "sell",
      quantity: "1", price: "101", feeAmount: "0.02", feeAsset: "USD", settlementStatus: "SETTLED",
    }, "sell", "2026-09-01T00:01:00.000Z"),
    truth({
      kind: "REALIZED_CASHFLOW", cashflowId: "cash", asset: "USD", amount: "1",
      direction: "INFLOW", causeNativeId: venueOrderId,
    }, "cash", "2026-09-01T00:02:00.000Z"),
  ];
}

function editAssertion(record: TruthRecordV2, changes: Record<string, unknown>): TruthRecordV2 {
  return { ...record, primitiveAssertion: { ...record.primitiveAssertion, ...changes } } as TruthRecordV2;
}

function reseal(record: TruthRecordV2): TruthRecordV2 {
  const { schemaVersion, truthRecordId, contentDigestHex, ...draft } = record;
  void schemaVersion;
  void truthRecordId;
  void contentDigestHex;
  return createTruthRecordV2(draft);
}

describe("billing lookup validates supplied Reality truth content", () => {
  it.each([
    ["cash amount", 2, (record: TruthRecordV2) => editAssertion(record, { amount: "1000" })],
    ["cash denomination", 2, (record: TruthRecordV2) => editAssertion(record, { asset: "USDT" })],
    ["cash direction", 2, (record: TruthRecordV2) => editAssertion(record, { direction: "OUTFLOW" })],
    ["fill fee", 0, (record: TruthRecordV2) => editAssertion(record, { feeAmount: "0.9" })],
    ["fill denomination", 0, (record: TruthRecordV2) => editAssertion(record, { feeAsset: "USDT" })],
    ["fill side", 0, (record: TruthRecordV2) => editAssertion(record, { side: "sell" })],
    ["fill quantity", 0, (record: TruthRecordV2) => editAssertion(record, { quantity: "2" })],
    ["fill finality", 0, (record: TruthRecordV2) => editAssertion(record, { settlementStatus: "OBSERVED" })],
    ["truth ID", 2, (record: TruthRecordV2) => ({ ...record, truthRecordId: digest("foreign-truth") })],
    ["content digest", 2, (record: TruthRecordV2) => ({ ...record, contentDigestHex: digest("foreign-digest") })],
    ["schema", 2, (record: TruthRecordV2) => ({ ...record, schemaVersion: "future" }) as unknown as TruthRecordV2],
    ["source ID", 2, (record: TruthRecordV2) => ({ ...record, sourceReportId: digest("foreign-source") })],
    ["source digest", 2, (record: TruthRecordV2) => ({ ...record, sourceReportDigestHex: digest("foreign-source") })],
    ["native source identity", 2, (record: TruthRecordV2) => ({
      ...record,
      sourceNativeIdentity: { ...record.sourceNativeIdentity!, nativeId: "foreign-native" },
    })],
    ["assertion kind", 2, (record: TruthRecordV2) => editAssertion(record, { kind: "UNKNOWN_ASSERTION" })],
  ] as const)("refuses changed %s under the old seal", (_label, index, mutate) => {
    const records = validRecords();
    records[index] = mutate(records[index]);
    expect(validateTruthRecordV2(records[index])).toBe(false);
    expect(() => lookupClosedTradeSettlementsFromRealityV2({ ...scope, truthRecords: records }))
      .toThrow(code);
  });

  it("preserves valid JSON replay, input order independence and exact decimal economics", () => {
    const records = validRecords();
    expect(records.every(validateTruthRecordV2)).toBe(true);
    const result = lookupClosedTradeSettlementsFromRealityV2({ ...scope, truthRecords: records });
    expect(result.settlements).toHaveLength(1);
    expect(result.settlements[0]).toMatchObject({
      grossRealizedCashflow: "1",
      admittedTradingCosts: "0.03",
      netRealizedCashflow: "0.97",
      capitalAuthority: "NONE",
      venueWriteAuthority: "NONE",
    });
    expect(lookupClosedTradeSettlementsFromRealityV2({
      ...scope, truthRecords: JSON.parse(JSON.stringify(records)).reverse(),
    })).toEqual(result);
  });

  it.each(["unrelated open fill", "non-billing balance"])(
    "also validates an otherwise ignored %s",
    kind => {
      const unrelated = kind === "unrelated open fill"
        ? truth({
          kind: "FILL", venueTradeId: "unrelated-buy", venueOrderId: "unrelated-order", symbol: "ETHUSD",
          side: "buy", quantity: "1", price: "100", feeAmount: "0", feeAsset: "USD", settlementStatus: "OBSERVED",
        }, "unrelated", "2026-09-01T00:03:00.000Z")
        : truth({ kind: "BALANCE", asset: "USD", available: "10", locked: "0", total: "10" },
          "balance", "2026-09-01T00:03:00.000Z");
      const invalid = { ...unrelated, sourceReportDigestHex: digest("changed-source") };
      expect(validateTruthRecordV2(invalid)).toBe(false);
      expect(() => lookupClosedTradeSettlementsFromRealityV2({
        ...scope, truthRecords: [...validRecords(), invalid],
      })).toThrow(code);
    },
  );

  it.each([
    ["currency", 2, (record: TruthRecordV2) => editAssertion(record, { asset: "USDT" }), "LOOKUP_CASHFLOW_CONVERSION_EVIDENCE_REQUIRED"],
    ["fee currency", 0, (record: TruthRecordV2) => editAssertion(record, { feeAsset: "BTC" }), "LOOKUP_COST_CONVERSION_EVIDENCE_REQUIRED"],
    ["observed fill", 0, (record: TruthRecordV2) => editAssertion(record, { settlementStatus: "OBSERVED" }), "LOOKUP_FILL_NOT_SETTLED"],
    ["foreign account", 2, (record: TruthRecordV2) => ({ ...record, accountId: "foreign-account" }), "LOOKUP_SCOPE_MISMATCH"],
    ["unattributed marker", 2, (record: TruthRecordV2) => ({ ...record, markers: ["UNATTRIBUTED"] }) as TruthRecordV2, "LOOKUP_UNATTRIBUTED_TRUTH"],
  ] as const)("preserves the existing %s rejection for validly sealed records", (_label, index, mutate, expectedCode) => {
    const records = validRecords();
    records[index] = reseal(mutate(records[index]));
    expect(records.every(validateTruthRecordV2)).toBe(true);
    expect(() => lookupClosedTradeSettlementsFromRealityV2({ ...scope, truthRecords: records }))
      .toThrow(expectedCode);
  });

  it("rejects invalid supplied truth before the reporting bridge reads HWM or writes anything", async () => {
    const records = validRecords();
    records[2] = editAssertion(records[2], { amount: "1000" });
    const getCurrentHwm = vi.fn().mockResolvedValue({ highWaterMark: "0" });
    const bootstrapHwm = vi.fn();
    const findOpenPeriod = vi.fn().mockResolvedValue({
      id: "synthetic-period",
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
    });
    const openReportingPeriod = vi.fn();
    const closeReportingPeriod = vi.fn().mockResolvedValue({ id: "synthetic-period" });
    const computeFeeForPeriod = vi.fn().mockResolvedValue({ periodRealizedStrategyProfit: "999.97" });
    await expect(proveLiveFillReportingReadable({
      context: { organizationId },
      exchangeAccountId: accountId,
      orderRepository: {} as never,
      reportingBridge: { findOpenPeriod, openReportingPeriod, closeReportingPeriod } as never,
      feeComputation: { computeFeeForPeriod },
      hwmLedger: { getCurrentHwm, bootstrapHwm },
      canonicalProfit: { strategyId: scope.strategyId, truthRecords: records },
    })).rejects.toMatchObject({ code });
    for (const effect of [
      getCurrentHwm, bootstrapHwm, findOpenPeriod, openReportingPeriod,
      closeReportingPeriod, computeFeeForPeriod,
    ]) {
      expect(effect).not.toHaveBeenCalled();
    }
  });
});
