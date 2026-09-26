import { describe, expect, it, vi } from "vitest";

import {
  admitCanonicalPeriodProfitFromReceiptV2,
  assessBillingV2,
  billingPeriodReportingScopeIdV2,
  buildCanonicalBillingPolicyV2,
  buildClosedTradeSettlementV2,
  buildRealizedStrategyProfitReceiptV2,
  type ClosedTradeSettlementV2,
} from "@/lib/trader/billing/v2";
import { createBillingPeriodCloseOrchestrator } from "@/lib/trader/billing/billing-period-close-orchestrator";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { compareDecimal } from "@/lib/trader/risk/numeric";

const scope = {
  organizationId: "fact-org",
  accountId: "fact-account",
  strategyId: "fact-strategy",
};
const periodStart = new Date("2026-09-01T00:00:00.000Z");
const periodEnd = new Date("2026-09-08T00:00:00.000Z");
const reportingScopeId = billingPeriodReportingScopeIdV2({ ...scope, periodStart, periodEnd });
const frontier = "1".repeat(64);

function closed(
  lifecycleId: string,
  cashDigest: string,
  costDigest: string,
  amount = "100",
  cost = "2",
) {
  return buildClosedTradeSettlementV2({
    ...scope,
    symbol: "BTCUSD",
    lifecycleId,
    lifecycleState: "FULLY_CLOSED",
    remainingQuantity: "0",
    realityFrontierDigestHex: frontier,
    openingFillTruthRecordDigests: [computeSemanticSha256Hex({ lifecycleId, role: "open" })],
    closingFillTruthRecordDigests: [computeSemanticSha256Hex({ lifecycleId, role: "close" })],
    partialFillTruthRecordDigests: [],
    cashflowFacts: [{ truthRecordDigestHex: cashDigest, amount, cause: "STRATEGY_REALIZED" }],
    costFacts: [{ truthRecordDigestHex: costDigest, amount: cost, admitted: true }],
    supersedesSettlementDigestHex: null,
  });
}

function receipt(settlements: readonly ClosedTradeSettlementV2[]) {
  return buildRealizedStrategyProfitReceiptV2({
    ...scope,
    reportingScopeId,
    realityFrontierDigestHex: frontier,
    settlements,
  });
}

const first = closed("one", "a".repeat(64), "b".repeat(64));
const distinct = closed("two", "c".repeat(64), "d".repeat(64));
const repeatedCash = closed("two", "a".repeat(64), "d".repeat(64));
const repeatedCost = closed("two", "c".repeat(64), "b".repeat(64));

function claimedDoubleReceipt(second: ClosedTradeSettlementV2) {
  // This is exactly the old accepted double count, with a valid whole-body hash.
  // Hash integrity alone must not make repeated monetary facts admissible.
  const { contentDigestHex, ...single } = receipt([first]);
  void contentDigestHex;
  const body = {
    ...single,
    closedTradeSettlementDigests: [first.contentDigestHex, second.contentDigestHex].sort(),
    grossRealizedPnl: "200",
    admittedTradingCosts: "4",
    netRealizedStrategyProfit: "196",
  };
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

describe("billing monetary fact uniqueness across lifecycles", () => {
  it.each([
    ["cashflow", repeatedCash, "RECEIPT_DUPLICATE_CASHFLOW_FACT"],
    ["cost", repeatedCost, "RECEIPT_DUPLICATE_COST_FACT"],
    [
      "conflicting cashflow amount",
      closed("two", "a".repeat(64), "d".repeat(64), "101"),
      "RECEIPT_DUPLICATE_CASHFLOW_FACT",
    ],
    [
      "conflicting cost amount",
      closed("two", "c".repeat(64), "b".repeat(64), "100", "3"),
      "RECEIPT_DUPLICATE_COST_FACT",
    ],
  ] as const)(
    "rejects reused %s under different lifecycle IDs in either input order",
    (_kind, second, code) => {
      expect(() => receipt([first, second])).toThrow(code);
      expect(() => receipt([second, first])).toThrow(code);
    },
  );

  it.each([
    ["cashflow", repeatedCash, "RECEIPT_DUPLICATE_CASHFLOW_FACT"],
    ["cost", repeatedCost, "RECEIPT_DUPLICATE_COST_FACT"],
  ] as const)(
    "refuses a self-hashed duplicate %s receipt before fee/HWM and period admission",
    (_kind, second, code) => {
      const evidence = claimedDoubleReceipt(second);
      expect(() =>
        assessBillingV2({
          receipt: evidence,
          settlements: [first, second],
          priorHwm: { namespace: "BILLING_HWM", highWaterMark: "0", eventDigestHex: null },
          policy: buildCanonicalBillingPolicyV2(),
          assessedAtUtc: periodEnd.toISOString(),
        }),
      ).toThrow(code);
      expect(() =>
        admitCanonicalPeriodProfitFromReceiptV2({
          ...scope,
          receipt: evidence,
          settlements: [first, second],
          expectedReportingScopeId: reportingScopeId,
        }),
      ).toThrow(code);
    },
  );

  it.each([
    [repeatedCash, "RECEIPT_DUPLICATE_CASHFLOW_FACT"],
    [repeatedCost, "RECEIPT_DUPLICATE_COST_FACT"],
  ] as const)(
    "refuses duplicate monetary evidence before any billing writes",
    async (second, code) => {
      const findOpenPeriod = vi.fn().mockResolvedValue(null);
      const listClosedPeriods = vi.fn();
      const getCurrentHwm = vi.fn();
      const bootstrapHwm = vi.fn();
      const openReportingPeriod = vi.fn();
      const closeReportingPeriod = vi.fn();
      const getDraftInvoiceByPeriod = vi.fn();
      const orchestrator = createBillingPeriodCloseOrchestrator({
        reportingPeriodLifecycle: {
          findOpenPeriod,
          listClosedPeriods,
          openReportingPeriod,
          closeReportingPeriod,
        },
        hwmLedger: { getCurrentHwm, bootstrapHwm },
        draftInvoiceService: { getDraftInvoiceByPeriod },
      } as never);
      await expect(
        orchestrator.closeAndMaterialize({ organizationId: scope.organizationId }, {
          exchangeAccountId: scope.accountId,
          periodStart,
          periodEnd,
          realizedStrategyProfitReceipt: claimedDoubleReceipt(second),
          closedTradeSettlements: [first, second],
        } as never),
      ).rejects.toThrow(code);
      expect(findOpenPeriod).toHaveBeenCalledOnce();
      for (const effect of [
        listClosedPeriods,
        getCurrentHwm,
        bootstrapHwm,
        openReportingPeriod,
        closeReportingPeriod,
        getDraftInvoiceByPeriod,
      ]) {
        expect(effect).not.toHaveBeenCalled();
      }
    },
  );

  it("preserves equal amounts from distinct facts, serialized replay and input-order independence", () => {
    const evidence = receipt([first, distinct]);
    expect(receipt([distinct, first])).toEqual(evidence);
    expect(receipt(JSON.parse(JSON.stringify([first, distinct])))).toEqual(evidence);
    const assessed = assessBillingV2({
      receipt: evidence,
      settlements: [first, distinct],
      priorHwm: { namespace: "BILLING_HWM", highWaterMark: "0", eventDigestHex: null },
      policy: buildCanonicalBillingPolicyV2(),
      assessedAtUtc: periodEnd.toISOString(),
    });
    expect(compareDecimal(evidence.netRealizedStrategyProfit, "196")).toBe(0);
    expect(compareDecimal(assessed.performanceFee, "58.8")).toBe(0);
    expect(compareDecimal(assessed.hwmEvent.newHwm, "196")).toBe(0);
  });
});
