import { describe, expect, it } from "vitest";
import {
  admitCanonicalPeriodProfitFromReceiptV2,
  buildClosedTradeSettlementV2,
  buildRealizedStrategyProfitReceiptV2,
  type ClosedTradeSettlementV2Input,
} from "@/lib/trader/billing/v2";
import { assertClosedTradeSettlementV2 } from "@/lib/trader/billing/v2/closed-trade-settlement-v2";
import { normalizeAndValidateRiskLimitsInput } from "@/lib/trader/risk/limits/validate-limits";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { RiskLimitsValidationError } from "@/lib/trader/risk/limits/errors";
import { InvalidDecimalError } from "@/lib/trader/risk/numeric";

function input(remainingQuantity = "0", costAmount = "0", cashAmount = "100"): ClosedTradeSettlementV2Input {
  // Offline arithmetic fixture. Digest-shaped IDs do not prove durable source
  // authenticity, financial finality, or authority to issue an invoice.
  return {
    organizationId: "dee1114-org", accountId: "dee1114-account", strategyId: "dee1114-strategy",
    symbol: "BTCUSDT", lifecycleId: "dee1114-lifecycle", lifecycleState: "FULLY_CLOSED",
    remainingQuantity, realityFrontierDigestHex: "1".repeat(64),
    openingFillTruthRecordDigests: ["2".repeat(64)], closingFillTruthRecordDigests: ["3".repeat(64)],
    partialFillTruthRecordDigests: [],
    cashflowFacts: [{ truthRecordDigestHex: "4".repeat(64), amount: cashAmount, cause: "STRATEGY_REALIZED" }],
    costFacts: [{ truthRecordDigestHex: "5".repeat(64), amount: costAmount, admitted: true }],
    supersedesSettlementDigestHex: null,
  };
}
function admit(value: ClosedTradeSettlementV2Input) {
  const settlement = buildClosedTradeSettlementV2(value);
  assertClosedTradeSettlementV2(settlement);
  const receipt = buildRealizedStrategyProfitReceiptV2({
    organizationId: value.organizationId, accountId: value.accountId, strategyId: value.strategyId,
    reportingScopeId: "dee1114-scope", realityFrontierDigestHex: value.realityFrontierDigestHex,
    settlements: [settlement],
  });
  const profit = admitCanonicalPeriodProfitFromReceiptV2({
    organizationId: value.organizationId, accountId: value.accountId,
    receipt, settlements: [settlement], expectedReportingScopeId: "dee1114-scope",
  });
  return { settlement, profit };
}

describe("DEE-1114 decimal syntax at actual billing boundaries", () => {
  it.each([".", "-.", " . ", "\t-.\n"])("refuses malformed remainingQuantity %j before a settlement is sealed", (value) => {
    expect(() => buildClosedTradeSettlementV2(input(value))).toThrow("CLOSED_TRADE_INCOMPLETE_LIFECYCLE");
  });
  it.each([".", "-.", " . ", "\t-.\n"])("refuses malformed cost %j instead of normalizing it to zero", (value) => {
    expect(() => buildClosedTradeSettlementV2(input("0", value))).toThrow("CLOSED_TRADE_NEGATIVE_COST");
  });
  it.each([".", "-.", " . ", "\t-.\n"])("refuses malformed cashflow %j instead of admitting zero profit", (value) => {
    expect(() => buildClosedTradeSettlementV2(input("0", "0", value))).toThrow("CLOSED_TRADE_INVALID_CASHFLOW");
  });
  it("preserves valid zero, decimal cost and signed loss through receipt admission", () => {
    const zero = admit(input("0", "0", "0"));
    expect(zero.profit).toBe("0");
    expect(admit(input("-0", ".0", "-0.00000000"))).toEqual(zero);
    const profit = admit(input("0.", ".1", "1."));
    expect(profit.profit).toBe("0.9");
    expect(profit.settlement).toMatchObject({ remainingQuantity: "0", grossRealizedCashflow: "1",
      admittedTradingCosts: "0.1", capitalAuthority: "NONE", venueWriteAuthority: "NONE" });
    expect(admit(input("0", "0", "-.1")).profit).toBe("-0.1");
    expect(() => buildClosedTradeSettlementV2(input("0.1"))).toThrow("CLOSED_TRADE_INCOMPLETE_LIFECYCLE");
    expect(() => buildClosedTradeSettlementV2(input("0", "-0.1"))).toThrow("CLOSED_TRADE_NEGATIVE_COST");
  });
  it("rejects malformed body before digest admission and retains numeric tamper detection", () => {
    const settlement = buildClosedTradeSettlementV2(input());
    expect(() => assertClosedTradeSettlementV2({ ...settlement, remainingQuantity: "." }))
      .toThrow("CLOSED_TRADE_INCOMPLETE_LIFECYCLE");
    expect(() => assertClosedTradeSettlementV2({ ...settlement,
      cashflowFacts: [{ ...settlement.cashflowFacts[0], amount: "200" }],
    })).toThrow("CLOSED_TRADE_DIGEST_MISMATCH");
  });
  it("keeps positive Risk limits fail-closed for punctuation and genuine zero", () => {
    for (const maxNotional of [".", "-.", " . ", "\t-.\n"]) {
      expect(() => normalizeAndValidateRiskLimitsInput({ ...DEFAULT_ORG_RISK_LIMITS, maxNotional }))
        .toThrow(InvalidDecimalError);
    }
    expect(() => normalizeAndValidateRiskLimitsInput({ ...DEFAULT_ORG_RISK_LIMITS, maxNotional: "0" }))
      .toThrow(RiskLimitsValidationError);
    expect(normalizeAndValidateRiskLimitsInput({ ...DEFAULT_ORG_RISK_LIMITS, maxNotional: ".1" }).maxNotional).toBe("0.1");
  });
});
