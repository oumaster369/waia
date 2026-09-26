import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", async (load) => {
  const actual =
    await load<
      typeof import("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2")
    >();
  return { ...actual, requireForecastRuntimeAuthorizedOutcomeV2: vi.fn((value) => value) };
});

import * as evaluationCycleModule from "@/lib/trader/intelligence/evaluation-cycle";
import type { ForecastRuntimeOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type { Bar, EvaluationCycleResult, Quote } from "@/lib/trader/intelligence/types";
import type { SubmitOrderResult } from "@/lib/trader/execution/execution-service.types";
import type { ReconciliationReport } from "@/lib/trader/execution/reconciliation.types";
import { buildKnowledgeSelectionReceiptV2 } from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";
import {
  runLiveCycleOnce,
  type LiveCanonicalOrdinaryCapitalEnvelopeV2,
  type LiveCycleDeps,
} from "@/lib/trader/live/run-live-cycle";
import { buildAuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";
import type {
  CanonicalDecisionCapitalAuthorityV2Deps,
  DecisionAuthorityV2,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000261";
const SYMBOL = "BTCUSDT";
const PIT = "2026-01-01T00:25:00.000Z";
const DIGEST = "a".repeat(64);
const digest = (character: string) => character.repeat(64);

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function forecast(): ForecastRuntimeOutcomeV2 {
  return {
    status: "FORECAST_AUTHORIZED",
    authority: {
      organizationId: ORG,
      contentDigestHex: digest("a"),
      anchorClosedBarAt: PIT,
      selectedPredictivePackageContentDigestHex: DIGEST,
    },
    issuance: { package: { family: { symbol: SYMBOL } } },
  } as unknown as ForecastRuntimeOutcomeV2;
}

function mockEvaluation(overrides: Partial<EvaluationCycleResult> = {}): EvaluationCycleResult {
  const signal = {
    strategySignalId: "signal-1026",
    strategyId: "mean_reversion_v0" as const,
    strategyVersion: "0.1.0",
    organizationId: ORG,
    symbol: SYMBOL,
    outcome: "SIGNAL" as const,
    side: "buy" as const,
    confidence: "0.8",
    expectedEdge: "0.01",
    horizon: "1h" as const,
    maxRisk: "100",
    reasonCodes: ["STRAT_MR_ZSCORE_BUY"],
    msvId: "msv-1026",
    featureSetId: "feature-set-1026",
    evaluatedAt: PIT,
  };
  const result: EvaluationCycleResult = {
    features: {
      featureSetId: "feature-set-1026",
      instrumentId: SYMBOL,
      evaluatedAt: PIT,
      features: {
        close: "64000",
        sma20: "65000",
        zscoreVsSma20: "-2.5",
        priceDispersion20: "300",
        spreadBps: "1.5",
      },
      dataQualityScore: 0.9,
      inputs: { barCount: 25 },
    },
    msv: {
      msvId: "msv-1026",
      instrumentId: SYMBOL,
      evaluatedAt: PIT,
      featureSetId: "feature-set-1026",
      physics: { close: "64000", zscoreVsSma20: "-2.5", priceDispersion20: "300" },
      liquidity: { spreadBps: "1.5" },
      crowd: { fearGreedIndex: null, newsSentiment: "0" },
      futureContext: { eventRiskScore: "0" },
      derived: {
        regime: "TREND_BEAR",
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: ["mean_reversion_v0"],
        riskMultiplier: "1.0",
        dataQualityScore: 0.9,
        reasonCodes: ["CDE_QUALITY_ALLOW_TRADING"],
      },
    },
    signal,
    signals: [signal],
    forecastRuntimeOutcome: forecast(),
    ...overrides,
  };
  if (overrides.signal && !overrides.signals) {
    result.signals = [overrides.signal];
  }
  return result;
}

function snapshot() {
  const bars: Bar[] = [
    {
      symbol: SYMBOL,
      interval: "1m",
      open: "64000",
      high: "64000",
      low: "64000",
      close: "64000",
      volume: "10.00",
      barOpenTime: "2026-01-01T00:24:00.000Z",
      barCloseTime: PIT,
    },
  ];
  const quote: Quote = {
    symbol: SYMBOL,
    bid: "64000.00",
    ask: "64000.00",
    last: "64000.00",
    timestamp: PIT,
  };
  return {
    bars,
    quote,
    evaluatedAt: PIT,
    cycleIndex: 0,
    cycleId: "dee-1026-0",
  };
}

function runtimeContext() {
  return buildAuthoritativeRuntimeContextV2({
    organizationId: ORG,
    accountId: "acct-1026",
    symbol: SYMBOL,
    pitAnchor: PIT,
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    runtimeAssessmentDigestHex: DIGEST,
    driftPosture: "NORMAL",
    driftRestrictionDigestHex: DIGEST,
    qualificationTupleDigestHex: DIGEST,
    packageDigestHex: DIGEST,
    informationContractDigestHex: DIGEST,
    informationNeedPlanDigestHex: DIGEST,
    releaseDigestHex: DIGEST,
  });
}

function navigator() {
  return buildKnowledgeSelectionReceiptV2({
    organizationId: ORG,
    runId: "run-1026",
    symbol: SYMBOL,
    purpose: "forecast",
    questionId: "q-1026",
    pitAnchor: PIT,
    informationNeedPlanDigestHex: DIGEST,
    outcome: "SELECTED_MINIMAL_SUFFICIENT",
    selected: [{ knowledgeEdgeId: "edge-1", version: 1, contentDigestHex: DIGEST }],
    rejected: [],
    evidenceBudget: 8,
    knowledgeDigestHex: DIGEST,
  });
}

function envelope(
  patch: Partial<LiveCanonicalOrdinaryCapitalEnvelopeV2> = {},
): LiveCanonicalOrdinaryCapitalEnvelopeV2 {
  const context = runtimeContext();
  return {
    context,
    navigatorReceipt: navigator(),
    predictiveAdmissionVerdict: "ADMITTED",
    futureCycleEffect: null,
    currentRuntimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    currentDriftPosture: "NORMAL",
    ...patch,
  };
}

function decision(): DecisionAuthorityV2 {
  return {
    decisionId: "decision-1026",
    semanticDigestHex: digest("b"),
    contentDigestHex: digest("c"),
    forecastAuthorityContentDigestHex: digest("a"),
    action: "ENTER_LONG",
    evLower: "1",
    evBase: "2",
    evUpper: "3",
    economicSizeSetId: "sizes-1",
    economicSizeSetDigestHex: digest("d"),
    qualifiedQuantity: "0.01",
  };
}

function submittedOrder(): Extract<SubmitOrderResult, { status: "submitted" }> {
  return {
    status: "submitted",
    order: {
      id: "order-1026",
      organizationId: ORG,
      credentialId: null,
      venue: "htx",
      executionMode: "live",
      symbol: SYMBOL,
      side: "buy",
      type: "market",
      price: null,
      quantity: "0.005",
      filledQuantity: "0",
      avgFillPrice: null,
      state: "SENT_TO_EXCHANGE",
      stateVersion: 1,
      exchangeOrderId: null,
      clientOrderId: "client-1026",
      idempotencyKey: "idem-1026",
      riskDecisionId: "verdict-1",
      riskAllowanceId: "allowance-1",
      riskAllowanceBindingDigest: digest("7"),
      strategySignalId: null,
      allocationDecisionId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  };
}

function capitalDeps(
  patch: Partial<CanonicalDecisionCapitalAuthorityV2Deps> = {},
): CanonicalDecisionCapitalAuthorityV2Deps {
  const exactDecision = decision();
  return {
    decide: vi.fn(async () => ({ status: "ACTIONABLE" as const, decision: exactDecision })),
    assessRisk: vi.fn(async () => ({
      status: "PERMITTED" as const,
      decisionContentDigestHex: exactDecision.contentDigestHex,
      riskVerdictId: "verdict-1",
      riskVerdictContentDigestHex: digest("e"),
      riskAllowanceId: "allowance-1",
      riskAllowanceContentDigestHex: digest("f"),
      approvedQualifiedQuantity: "0.005",
    })),
    execute: vi.fn(async () => ({
      decisionContentDigestHex: exactDecision.contentDigestHex,
      riskAllowanceId: "allowance-1",
      riskAllowanceContentDigestHex: digest("f"),
      riskAllowanceOrderBindingDigestHex: digest("7"),
      executionPlanId: "plan-1",
      executionPlanContentDigestHex: digest("1"),
      executionAttemptId: "attempt-1",
      executionAttemptContentDigestHex: digest("2"),
      submittedQuantity: "0.005",
      execution: submittedOrder(),
    })),
    ...patch,
  };
}

function reconciliationReport(): ReconciliationReport {
  return {
    organizationId: ORG,
    runStartedAt: new Date(0),
    outcomes: [
      {
        clientOrderId: "client-1026",
        classification: "IN_SYNC",
        recordedFills: [],
        markedReconciliationRequired: false,
      },
    ],
    counts: {
      IN_SYNC: 1,
      VENUE_ACKED: 0,
      FILL_PROGRESS: 0,
      VENUE_TERMINALIZED: 0,
      NOT_FOUND_AT_VENUE: 0,
      UNKNOWN_POSITION: 0,
      AMBIGUOUS_STALE: 0,
      TERMINAL_DRIFT: 0,
      SKIPPED_CONFLICT: 0,
    },
  };
}

function liveDeps(patch: Partial<LiveCycleDeps> = {}): LiveCycleDeps {
  return {
    execution: {
      submitOrder: vi.fn(async () => submittedOrder()),
    },
    reconciliation: {
      reconcile: vi.fn(async () => reconciliationReport()),
    },
    reportingBridge: {} as LiveCycleDeps["reportingBridge"],
    feeComputation: {} as LiveCycleDeps["feeComputation"],
    hwmLedger: {} as LiveCycleDeps["hwmLedger"],
    orderRepository: {} as LiveCycleDeps["orderRepository"],
    ...patch,
  };
}

async function runLive(deps: LiveCycleDeps) {
  return runLiveCycleOnce(deps, {
    context: requireOrgContext(ORG),
    snapshot: snapshot(),
    accountKey: "acct-1026",
    exchangeAccountId: "htx-spot-1",
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.0",
    credentialId: "cred-1026",
    defaultQuantity: "0.01",
    accountState: EMPTY_STATE,
  });
}

describe("DEE-1026 live-equivalent canonical recurring cutover", () => {
  beforeEach(() => {
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());
  });

  it("fails closed when Decision V2 authority deps are omitted", async () => {
    const deps = liveDeps({
      canonicalOrdinaryCapitalEnvelopeV2: envelope(),
    });
    const result = await runLive(deps);
    expect(result.submitBlocked).toBe(true);
    expect(result.skipReason).toBe("decision_v2_authority_missing");
    expect(result.execution).toBeNull();
    expect(deps.execution.submitOrder).not.toHaveBeenCalled();
    expect(deps.reconciliation.reconcile).not.toHaveBeenCalled();
  });

  it("does not submit when the epistemic envelope is omitted", async () => {
    const authority = capitalDeps();
    const deps = liveDeps({
      decisionCapitalAuthorityV2: authority,
    });
    const result = await runLive(deps);
    expect(result.submitBlocked).toBe(true);
    expect(result.skipReason).toBe("decision_v2_no_trade");
    expect(result.canonicalOrdinaryCapitalCycleV2).toMatchObject({
      status: "NO_TRADE",
      stage: "EPISTEMIC",
      reasonCodes: ["CANONICAL_ENVELOPE_MISSING"],
    });
    expect(authority.decide).not.toHaveBeenCalled();
    expect(authority.execute).not.toHaveBeenCalled();
  });

  it("does not submit when a prebuilt envelope context belongs to another account", async () => {
    const authority = capitalDeps();
    const foreignContext = buildAuthoritativeRuntimeContextV2({
      organizationId: ORG,
      accountId: "acct-other",
      symbol: SYMBOL,
      pitAnchor: PIT,
      runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
      runtimeAssessmentDigestHex: DIGEST,
      driftPosture: "NORMAL",
      driftRestrictionDigestHex: DIGEST,
      qualificationTupleDigestHex: DIGEST,
      packageDigestHex: DIGEST,
      informationContractDigestHex: DIGEST,
      informationNeedPlanDigestHex: DIGEST,
      releaseDigestHex: DIGEST,
    });
    const deps = liveDeps({
      decisionCapitalAuthorityV2: authority,
      canonicalOrdinaryCapitalEnvelopeV2: envelope({ context: foreignContext }),
    });
    const result = await runLive(deps);
    expect(result.submitBlocked).toBe(true);
    expect(result.skipReason).toBe("decision_v2_no_trade");
    expect(result.canonicalOrdinaryCapitalCycleV2).toMatchObject({
      status: "NO_TRADE",
      stage: "EPISTEMIC",
      reasonCodes: ["ENVELOPE_IDENTITY_MISMATCH"],
    });
    expect(authority.decide).not.toHaveBeenCalled();
    expect(authority.execute).not.toHaveBeenCalled();
  });

  it("does not submit when Navigator is missing", async () => {
    const authority = capitalDeps();
    const deps = liveDeps({
      decisionCapitalAuthorityV2: authority,
      canonicalOrdinaryCapitalEnvelopeV2: envelope({ navigatorReceipt: null }),
    });
    const result = await runLive(deps);
    expect(result.submitBlocked).toBe(true);
    expect(result.skipReason).toBe("decision_v2_no_trade");
    expect(result.canonicalOrdinaryCapitalCycleV2).toMatchObject({
      status: "NO_TRADE",
      stage: "EPISTEMIC",
      reasonCodes: ["NAVIGATOR_RECEIPT_MISSING"],
    });
    expect(authority.decide).not.toHaveBeenCalled();
    expect(authority.execute).not.toHaveBeenCalled();
    expect(deps.reconciliation.reconcile).not.toHaveBeenCalled();
  });

  it("does not submit when Predictive Admission is RESEARCH_ONLY", async () => {
    const authority = capitalDeps();
    const deps = liveDeps({
      decisionCapitalAuthorityV2: authority,
      canonicalOrdinaryCapitalEnvelopeV2: envelope({
        predictiveAdmissionVerdict: "RESEARCH_ONLY",
      }),
    });
    const result = await runLive(deps);
    expect(result.submitBlocked).toBe(true);
    expect(result.skipReason).toBe("decision_v2_no_trade");
    expect(result.canonicalOrdinaryCapitalCycleV2).toMatchObject({
      status: "NO_TRADE",
      stage: "EPISTEMIC",
      reasonCodes: ["RESEARCH_ONLY_NOT_CAPITAL_ELIGIBLE"],
    });
    expect(authority.decide).not.toHaveBeenCalled();
    expect(authority.execute).not.toHaveBeenCalled();
  });

  it("does not submit when admission template posture does not match the envelope", async () => {
    const authority = capitalDeps();
    const deps = liveDeps({
      decisionCapitalAuthorityV2: authority,
      canonicalOrdinaryCapitalEnvelopeV2: envelope({
        currentRuntimePosture: "NO_NEW_RISK",
      }),
    });
    const result = await runLive(deps);
    expect(result.submitBlocked).toBe(true);
    expect(result.skipReason).toBe("decision_v2_no_trade");
    expect(result.canonicalOrdinaryCapitalCycleV2).toMatchObject({
      status: "NO_TRADE",
      stage: "ADMISSION",
      reasonCodes: ["ADMISSION_INPUT_MISMATCH"],
    });
    expect(authority.decide).not.toHaveBeenCalled();
    expect(authority.execute).not.toHaveBeenCalled();
  });

  it("submits and reconciles after EXECUTION_BOUND from the recurring builder", async () => {
    const authority = capitalDeps();
    const deps = liveDeps({
      decisionCapitalAuthorityV2: authority,
      canonicalOrdinaryCapitalEnvelopeV2: envelope(),
    });
    const result = await runLive(deps);
    expect(result.submitBlocked).toBe(false);
    expect(result.skipReason).toBeUndefined();
    expect(result.canonicalOrdinaryCapitalCycleV2?.status).toBe("EXECUTION_BOUND");
    expect(result.decisionCapitalAuthorityV2?.status).toBe("EXECUTION_BOUND");
    expect(result.execution?.status).toBe("submitted");
    expect(result.reconciliation?.counts.IN_SYNC).toBe(1);
    expect(result.reporting).toBeNull();
    expect(authority.execute).toHaveBeenCalledTimes(1);
    expect(deps.execution.submitOrder).not.toHaveBeenCalled();
    expect(deps.reconciliation.reconcile).toHaveBeenCalledWith(requireOrgContext(ORG), {
      kind: "order",
      orderId: "order-1026",
    });
  });
});
