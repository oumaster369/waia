import { describe, expect, it } from "vitest";

import {
  assessBillingV2,
  buildCanonicalBillingPolicyV2,
  buildClosedTradeSettlementV2,
  buildInvoiceBasisReceiptV2,
  buildRealizedStrategyProfitReceiptV2,
  refuseEquityHwmAsBillingHwmV2,
  refuseIssuedInvoiceAuthorityV2,
  type BillingHwmPriorV2,
  type ClosedTradeSettlementV2,
  type ClosedTradeSettlementV2Input,
} from "@/lib/trader/billing/v2";
import { compareDecimal } from "@/lib/trader/risk/numeric";

const HEX = {
  frontier: "1".repeat(64),
  open: "a".repeat(64),
  close: "b".repeat(64),
  cash: "c".repeat(64),
  cost: "d".repeat(64),
  deposit: "e".repeat(64),
};

const ASSESSED_AT = "2026-08-18T12:00:00.000Z";

function digestChar(char: string): string {
  return char.repeat(64);
}

function settlementInput(
  overrides: Partial<ClosedTradeSettlementV2Input> &
    Pick<ClosedTradeSettlementV2Input, "lifecycleId" | "cashflowFacts">,
): ClosedTradeSettlementV2Input {
  return {
    organizationId: "org-638",
    accountId: "acct-638",
    strategyId: "strat-638",
    symbol: "BTCUSDT",
    lifecycleState: "FULLY_CLOSED",
    remainingQuantity: "0",
    realityFrontierDigestHex: HEX.frontier,
    openingFillTruthRecordDigests: [HEX.open],
    closingFillTruthRecordDigests: [HEX.close],
    partialFillTruthRecordDigests: [],
    costFacts: [],
    supersedesSettlementDigestHex: null,
    ...overrides,
  };
}

function settlement(
  lifecycleId: string,
  amount: string,
  cashDigest = HEX.cash,
): ClosedTradeSettlementV2 {
  return buildClosedTradeSettlementV2(
    settlementInput({
      lifecycleId,
      cashflowFacts: [
        {
          truthRecordDigestHex: cashDigest,
          amount,
          cause: "STRATEGY_REALIZED",
        },
      ],
    }),
  );
}

function receiptFor(settlements: readonly ClosedTradeSettlementV2[]) {
  return buildRealizedStrategyProfitReceiptV2({
    organizationId: "org-638",
    accountId: "acct-638",
    strategyId: "strat-638",
    reportingScopeId: "scope-638",
    realityFrontierDigestHex: HEX.frontier,
    settlements,
  });
}

function bootstrapHwm(): BillingHwmPriorV2 {
  return {
    namespace: "BILLING_HWM",
    highWaterMark: "0",
    eventDigestHex: null,
  };
}

describe("DEE-638 closed-trade billing V2", () => {
  const policy = buildCanonicalBillingPolicyV2();

  it("charges 30% on a +100 realized peak and keeps HWM from trading losses", () => {
    const peak = settlement("pk", "100", digestChar("2"));
    const loss = settlement("ls", "-30", digestChar("3"));
    const recover = settlement("rc", "30", digestChar("4"));
    const rise = settlement("rs", "10", digestChar("5"));

    const peakAssessment = assessBillingV2({
      receipt: receiptFor([peak]),
      priorHwm: bootstrapHwm(),
      policy,
      assessedAtUtc: ASSESSED_AT,
    });
    expect(compareDecimal(peakAssessment.billableProfit, "100")).toBe(0);
    expect(compareDecimal(peakAssessment.performanceFee, "30")).toBe(0);
    expect(peakAssessment.hwmEvent.eventKind).toBe("ADVANCE");
    expect(compareDecimal(peakAssessment.hwmEvent.newHwm, "100")).toBe(0);
    expect(peakAssessment.capitalAuthority).toBe("NONE");

    const afterLoss = assessBillingV2({
      receipt: receiptFor([peak, loss]),
      priorHwm: {
        namespace: "BILLING_HWM",
        highWaterMark: peakAssessment.hwmEvent.newHwm,
        eventDigestHex: peakAssessment.hwmEvent.contentDigestHex,
      },
      policy,
      assessedAtUtc: ASSESSED_AT,
    });
    expect(compareDecimal(afterLoss.cumulativeRealizedStrategyProfit, "70")).toBe(0);
    expect(compareDecimal(afterLoss.billableProfit, "0")).toBe(0);
    expect(compareDecimal(afterLoss.performanceFee, "0")).toBe(0);
    expect(afterLoss.hwmEvent.eventKind).toBe("NO_CHANGE");
    expect(compareDecimal(afterLoss.hwmEvent.newHwm, "100")).toBe(0);

    const recovered = assessBillingV2({
      receipt: receiptFor([peak, loss, recover]),
      priorHwm: {
        namespace: "BILLING_HWM",
        highWaterMark: afterLoss.hwmEvent.newHwm,
        eventDigestHex: afterLoss.hwmEvent.contentDigestHex,
      },
      policy,
      assessedAtUtc: ASSESSED_AT,
    });
    expect(compareDecimal(recovered.cumulativeRealizedStrategyProfit, "100")).toBe(0);
    expect(compareDecimal(recovered.billableProfit, "0")).toBe(0);
    expect(recovered.hwmEvent.eventKind).toBe("NO_CHANGE");
    expect(compareDecimal(recovered.hwmEvent.newHwm, "100")).toBe(0);

    const abovePeak = assessBillingV2({
      receipt: receiptFor([peak, loss, recover, rise]),
      priorHwm: {
        namespace: "BILLING_HWM",
        highWaterMark: recovered.hwmEvent.newHwm,
        eventDigestHex: recovered.hwmEvent.contentDigestHex,
      },
      policy,
      assessedAtUtc: ASSESSED_AT,
    });
    expect(compareDecimal(abovePeak.cumulativeRealizedStrategyProfit, "110")).toBe(0);
    expect(compareDecimal(abovePeak.billableProfit, "10")).toBe(0);
    expect(compareDecimal(abovePeak.performanceFee, "3")).toBe(0);
    expect(abovePeak.hwmEvent.eventKind).toBe("ADVANCE");
    expect(compareDecimal(abovePeak.hwmEvent.newHwm, "110")).toBe(0);

    const draft = buildInvoiceBasisReceiptV2({ assessment: peakAssessment });
    expect(draft.basisKind).toBe("DRAFT_BASIS");
    expect(draft.invoiceAuthority).toBe("DRAFT_BASIS_ONLY");
    expect(draft.issuanceAuthority).toBe("NONE");
    expect(draft.collectionAuthority).toBe("NONE");
    expect(draft.manualGateRequired).toBe(true);

    const noBill = buildInvoiceBasisReceiptV2({ assessment: afterLoss });
    expect(noBill.basisKind).toBe("NO_BILL");
  });

  it("yields zero billable profit for zero closed trades even when unrealized is large", () => {
    const empty = receiptFor([]);
    expect(compareDecimal(empty.netRealizedStrategyProfit, "0")).toBe(0);
    const assessment = assessBillingV2({
      receipt: empty,
      priorHwm: bootstrapHwm(),
      policy,
      assessedAtUtc: ASSESSED_AT,
    });
    expect(compareDecimal(assessment.billableProfit, "0")).toBe(0);
    expect(compareDecimal(assessment.performanceFee, "0")).toBe(0);
    expect(assessment.reasonCodes).toContain("NO_BILL_ZERO_CLOSED_TRADES");
    expect(assessment.hwmEvent.eventKind).toBe("BOOTSTRAP");
    expect(() =>
      buildRealizedStrategyProfitReceiptV2({
        organizationId: "org-638",
        accountId: "acct-638",
        strategyId: "strat-638",
        reportingScopeId: "scope-638",
        realityFrontierDigestHex: HEX.frontier,
        settlements: [],
        unrealizedPnl: "999999",
      } as never),
    ).toThrow(/RECEIPT_NAKED_PNL_REFUSED/);
  });

  it("does not treat deposit-only account growth as realized strategy profit", () => {
    const depositOnly = buildRealizedStrategyProfitReceiptV2({
      organizationId: "org-638",
      accountId: "acct-638",
      strategyId: "strat-638",
      reportingScopeId: "scope-638",
      realityFrontierDigestHex: HEX.frontier,
      settlements: [],
      nonProfitCashflowFacts: [
        {
          truthRecordDigestHex: HEX.deposit,
          amount: "50000",
          cause: "DEPOSIT",
        },
      ],
    });
    expect(compareDecimal(depositOnly.netRealizedStrategyProfit, "0")).toBe(0);
    expect(compareDecimal(depositOnly.grossRealizedPnl, "0")).toBe(0);

    expect(() =>
      buildClosedTradeSettlementV2(
        settlementInput({
          lifecycleId: "dep",
          cashflowFacts: [
            {
              truthRecordDigestHex: HEX.deposit,
              amount: "50000",
              cause: "DEPOSIT",
            },
          ],
        } as never),
      ),
    ).toThrow(/CLOSED_TRADE_NON_STRATEGY_CASHFLOW/);
  });

  it("rejects naked realizedPnl at settlement, receipt, and assessment boundaries", () => {
    expect(() =>
      buildClosedTradeSettlementV2({
        ...settlementInput({
          lifecycleId: "naked",
          cashflowFacts: [
            {
              truthRecordDigestHex: HEX.cash,
              amount: "100",
              cause: "STRATEGY_REALIZED",
            },
          ],
        }),
        realizedPnl: "100",
      } as never),
    ).toThrow(/CLOSED_TRADE_NAKED_PNL_REFUSED/);

    expect(() =>
      assessBillingV2({
        receipt: receiptFor([]),
        priorHwm: bootstrapHwm(),
        policy,
        assessedAtUtc: ASSESSED_AT,
        realizedPnl: "100",
      } as never),
    ).toThrow(/BILLING_NAKED_REALIZED_PNL_REFUSED/);
  });

  it("refuses equityHwm as Billing HWM and refuses ISSUED invoice authority", () => {
    expect(() => refuseEquityHwmAsBillingHwmV2({ equityHwm: "999" })).toThrow(
      /BILLING_EQUITY_HWM_CANNOT_POPULATE_BILLING_HWM/,
    );
    expect(() =>
      assessBillingV2({
        receipt: receiptFor([]),
        priorHwm: {
          namespace: "EQUITY_HWM",
          highWaterMark: "999",
          eventDigestHex: null,
        } as never,
        policy,
        assessedAtUtc: ASSESSED_AT,
      }),
    ).toThrow(/BILLING_EQUITY_HWM_CANNOT_POPULATE_BILLING_HWM/);
    expect(() => refuseIssuedInvoiceAuthorityV2()).toThrow(/INVOICE_BASIS_ISSUED_FORBIDDEN/);
    expect(() => buildCanonicalBillingPolicyV2({ feeRate: "0.20" })).toThrow(
      /BILLING_POLICY_RATE_NOT_CALLER_PARAMETER/,
    );
  });

  it("replays duplicate receipts into identical assessment and HWM digests", () => {
    const closed = settlement("rp", "100", digestChar("6"));
    const receipt = receiptFor([closed]);
    const first = assessBillingV2({
      receipt,
      priorHwm: bootstrapHwm(),
      policy,
      assessedAtUtc: ASSESSED_AT,
    });
    const second = assessBillingV2({
      receipt,
      priorHwm: bootstrapHwm(),
      policy,
      assessedAtUtc: ASSESSED_AT,
    });
    expect(first.contentDigestHex).toBe(second.contentDigestHex);
    expect(first.hwmEvent.contentDigestHex).toBe(second.hwmEvent.contentDigestHex);
    expect(first.receiptDigestHex).toBe(receipt.contentDigestHex);
    expect(buildInvoiceBasisReceiptV2({ assessment: first }).contentDigestHex).toBe(
      buildInvoiceBasisReceiptV2({ assessment: second }).contentDigestHex,
    );
  });

  it("refuses partial or incomplete closed-trade lifecycle", () => {
    expect(() =>
      buildClosedTradeSettlementV2(
        settlementInput({
          lifecycleId: "partial",
          lifecycleState: "PARTIAL" as "FULLY_CLOSED",
          remainingQuantity: "1",
          cashflowFacts: [
            {
              truthRecordDigestHex: HEX.cash,
              amount: "100",
              cause: "STRATEGY_REALIZED",
            },
          ],
        }),
      ),
    ).toThrow(/CLOSED_TRADE_INCOMPLETE_LIFECYCLE/);

    expect(() =>
      buildClosedTradeSettlementV2(
        settlementInput({
          lifecycleId: "open",
          closingFillTruthRecordDigests: [],
          cashflowFacts: [
            {
              truthRecordDigestHex: HEX.cash,
              amount: "100",
              cause: "STRATEGY_REALIZED",
            },
          ],
        }),
      ),
    ).toThrow(/CLOSED_TRADE_INCOMPLETE_LIFECYCLE/);
  });

  it("pins admitted costs into net realized strategy profit", () => {
    const withCosts = buildClosedTradeSettlementV2(
      settlementInput({
        lifecycleId: "costed",
        cashflowFacts: [
          {
            truthRecordDigestHex: HEX.cash,
            amount: "110",
            cause: "STRATEGY_REALIZED",
          },
        ],
        costFacts: [
          {
            truthRecordDigestHex: HEX.cost,
            amount: "10",
            admitted: true,
          },
        ],
      }),
    );
    expect(compareDecimal(withCosts.grossRealizedCashflow, "110")).toBe(0);
    expect(compareDecimal(withCosts.admittedTradingCosts, "10")).toBe(0);
    expect(compareDecimal(withCosts.netRealizedCashflow, "100")).toBe(0);
    const profit = receiptFor([withCosts]);
    expect(profit.closedTradeSettlementDigests).toEqual([withCosts.contentDigestHex]);
    expect(compareDecimal(profit.netRealizedStrategyProfit, "100")).toBe(0);
  });
});
