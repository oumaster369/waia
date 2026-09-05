import { describe, expect, it } from "vitest";

import { createInitialAccountingState } from
  "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { computeAccountingSemanticDigest } from
  "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertHistoricalModeledPortfolioLifecycleV2,
  assertHistoricalModeledRealityV2,
  buildHistoricalModeledPortfolioLifecycleV2,
  buildHistoricalModeledRealityV2,
  deriveHistoricalModeledRiskAccountingV2,
  resolveHistoricalModeledPortfolioProposalV2,
} from "@/lib/trader/historical-simulation-v2/historical-modeled-portfolio-reality-v2";

const asOf = "2026-08-30T10:00:00.000Z";

function frontier(quantity = "1", markPrice = "100"): AccountingFrontierV1 {
  const initial = createInitialAccountingState({ organizationId: "org-1", accountKey: "account-1",
    runId: "run-1", startingCash: "900", frontierAsOf: asOf });
  const positions: AccountingFrontierV1["positions"] = quantity === "0" ? {} : {
    BTCUSDT: { quantity, grossPositionBasis: "100", netPositionBasis: "100" },
  };
  const marks: AccountingFrontierV1["marks"] = quantity === "0" ? {} : {
    BTCUSDT: { price: markPrice, barCloseTime: asOf },
  };
  const state = {
    ...initial,
    positions,
    marks,
    markedPositionValue: quantity === "0" ? "0" : String(Number(quantity) * Number(markPrice)),
    equity: quantity === "0" ? "900" : String(900 + Number(quantity) * Number(markPrice)),
    equityHwm: quantity === "0" ? "900" : String(900 + Number(quantity) * Number(markPrice)),
    monthlyPeakHwm: quantity === "0" ? "900" : String(900 + Number(quantity) * Number(markPrice)),
  };
  return {
    ...state,
    id: "frontier-1",
    sourceFillId: null,
    sourceEconomicsDigest: "a".repeat(64),
    semanticContentDigest: computeAccountingSemanticDigest(state),
    idempotencyKey: "frontier-key-1",
  };
}

function accounting(source = frontier()) {
  return deriveHistoricalModeledRiskAccountingV2({
    frontier: source,
    organizationId: "org-1",
    accountId: "account-1",
    runId: "run-1",
    exposureLimitNotional: "1000",
    worstCasePendingExposureNotional: "25",
    outstandingReservationNotional: "10",
  });
}

function lifecycle(action: "ENTER_LONG" | "CASH" | "REDUCE" | "CLOSE", quantity: string | null,
  source = accounting()) {
  return buildHistoricalModeledPortfolioLifecycleV2({
    organizationId: "org-1", accountId: "account-1", runId: "run-1", cycleId: "cycle-1",
    symbol: "BTCUSDT", action, quantity, referencePrice: "100", accounting: source,
  });
}

describe("historical modeled portfolio and Reality v2", () => {
  it("derives reconciled exposure only from the sealed Accounting Frontier", () => {
    const derived = accounting();
    expect(derived.accounting).toEqual({
      reconciledExposureNotional: "100",
      worstCasePendingExposureNotional: "25",
      outstandingReservationNotional: "10",
      exposureLimitNotional: "1000",
    });
    expect(derived.openPositionCount).toBe(1);
    expect(() => accounting({ ...frontier(), markedPositionValue: "0" })).toThrow(
      "ACCOUNTING_FRONTIER_IDENTITY");
    const internallyResealed = { ...frontier(), markedPositionValue: "0" };
    internallyResealed.semanticContentDigest = computeAccountingSemanticDigest(internallyResealed);
    expect(() => accounting(internallyResealed)).toThrow("ACCOUNTING_EXPOSURE_DIVERGENT");
  });

  it("seals exact ENTER, REDUCE and CLOSE transitions and rejects overshoot/relabeling", () => {
    const entered = lifecycle("ENTER_LONG", "0.5", accounting(frontier("0")));
    expect(entered).toEqual(expect.objectContaining({ transition: "ENTER", positionQuantityBefore: "0",
      positionQuantityAfter: "0.5", strictExposureReduction: false,
      exposureNotionalBefore: "0", exposureNotionalAfter: "50", capitalEligible: false,
      transitionStatus: "PRE_FILL_PROPOSAL" }));

    const reduced = lifecycle("REDUCE", "0.4");
    expect(reduced).toEqual(expect.objectContaining({ transition: "REDUCE", positionQuantityBefore: "1",
      positionQuantityAfter: "0.6", strictExposureReduction: true,
      exposureNotionalBefore: "100", exposureNotionalAfter: "60" }));

    const closed = lifecycle("CLOSE", "1");
    expect(closed).toEqual(expect.objectContaining({ transition: "CLOSE", positionQuantityAfter: "0",
      strictExposureReduction: true, exposureNotionalAfter: "0" }));
    expect(() => lifecycle("REDUCE", "1")).toThrow("REDUCE_MUST_REMAIN_OPEN");
    expect(() => lifecycle("CLOSE", "0.4")).toThrow("CLOSE_MUST_FLATTEN");
    expect(() => lifecycle("CLOSE", "1.1")).toThrow("WOULD_REVERSE_OR_OVERSHOOT");
    expect(() => lifecycle("ENTER_LONG", "0.1")).toThrow("ENTER_REQUIRES_FLAT_POSITION");
    const closedBody = { ...closed };
    delete (closedBody as { contentDigestHex?: string }).contentDigestHex;
    const extendedBody = { ...closedBody, unexpectedAuthority: true };
    expect(() => assertHistoricalModeledPortfolioLifecycleV2({ ...extendedBody,
      contentDigestHex: computeSemanticSha256Hex(extendedBody) } as never)).toThrow(
      "HISTORICAL_MODELED_PORTFOLIO_LIFECYCLE_INVALID");
  });

  it("overlays sealed portfolio state without fabricating a reduction authority", () => {
    const base = Object.freeze({ decisionSemanticMode: "HISTORICAL" as const,
      rawDecisionAction: "ENTER_LONG" as const, rawDecisionReasonCodes: [] as readonly string[],
      action: "ENTER_LONG" as const, quantity: "0.4", proposalContentDigestHex: "1".repeat(64),
      portfolioReasonCodes: [] as readonly string[], reasonCodes: [] as readonly string[], decisionContentDigestHex: "2".repeat(64),
      whyNotCashReceiptDigestHex: "3".repeat(64), evLower: "1", evBase: "2", evUpper: "3" });
    const common = { organizationId: "org-1", accountId: "account-1", runId: "run-1",
      cycleId: "cycle-1", symbol: "BTCUSDT" } as const;
    expect(resolveHistoricalModeledPortfolioProposalV2({ ...common, decisionProposal: base,
      accounting: accounting(frontier("0")), hasPendingModeledOrder: false })).toBe(base);
    expect(resolveHistoricalModeledPortfolioProposalV2({ ...common, decisionProposal: base,
      accounting: accounting(), hasPendingModeledOrder: false })).toEqual(expect.objectContaining({
      rawDecisionAction: "ENTER_LONG", rawDecisionReasonCodes: [], action: "CASH", quantity: null,
      portfolioReasonCodes: ["HISTORICAL_PORTFOLIO_POSITION_ALREADY_OPEN"],
      reasonCodes: ["HISTORICAL_PORTFOLIO_POSITION_ALREADY_OPEN"],
    }));
    expect(resolveHistoricalModeledPortfolioProposalV2({ ...common, decisionProposal: base,
      accounting: accounting(frontier("0")), hasPendingModeledOrder: true })).toEqual(expect.objectContaining({
      action: "CASH", quantity: null,
      reasonCodes: ["HISTORICAL_PORTFOLIO_ORDER_TRANSITION_PENDING"],
    }));
    const cash = Object.freeze({ ...base, action: "CASH" as const, quantity: null,
      rawDecisionAction: "CASH" as const, rawDecisionReasonCodes: ["RAW_CASH"],
      portfolioReasonCodes: ["HISTORICAL_PORTFOLIO_RAW_DECISION_CASH"],
      proposalContentDigestHex: "4".repeat(64) });
    const close = resolveHistoricalModeledPortfolioProposalV2({ ...common, decisionProposal: cash,
      accounting: accounting(), hasPendingModeledOrder: false });
    expect(close).toEqual(expect.objectContaining({ action: "CLOSE", quantity: "1",
      rawDecisionAction: "CASH", rawDecisionReasonCodes: ["RAW_CASH"],
      portfolioReasonCodes: ["HISTORICAL_PORTFOLIO_DECISION_CASH_CLOSES_OPEN_POSITION"],
      reasonCodes: ["HISTORICAL_PORTFOLIO_DECISION_CASH_CLOSES_OPEN_POSITION"] }));
    expect(close.proposalContentDigestHex).not.toBe(cash.proposalContentDigestHex);
  });

  it("builds a separate capital-ineligible modeled Reality artifact from accounting", () => {
    const derived = accounting();
    const portfolio = lifecycle("REDUCE", "0.4", derived);
    const reality = buildHistoricalModeledRealityV2({ organizationId: "org-1", accountId: "account-1",
      runId: "run-1", cycleId: "cycle-1", accounting: derived, portfolioLifecycle: portfolio });
    expect(reality).toEqual(expect.objectContaining({
      schemaVersion: "waia.trader.historical_modeled_reality.v2",
      realityClass: "HISTORICAL_MODELED_ACCOUNTING_FRONTIER",
      source: "MODELED_HISTORICAL",
      capitalEligible: false,
      reconciledExposureNotional: "100",
      positions: [{ symbol: "BTCUSDT", quantity: "1", markPrice: "100", markedExposureNotional: "100" }],
    }));
    expect(() => assertHistoricalModeledRealityV2(reality)).not.toThrow();
    expect(() => assertHistoricalModeledRealityV2({ ...reality, capitalEligible: true } as never)).toThrow(
      "HISTORICAL_MODELED_REALITY_INVALID");
    expect(reality.schemaVersion).not.toBe("reality-projection/v2");
  });
});
