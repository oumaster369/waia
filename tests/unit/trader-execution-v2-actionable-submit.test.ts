import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", async (load) => {
  const actual =
    await load<
      typeof import("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2")
    >();
  return { ...actual, requireForecastRuntimeAuthorizedOutcomeV2: vi.fn((value) => value) };
});

import * as evaluationCycleModule from "@/lib/trader/intelligence/evaluation-cycle";
import { declareResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import type { ForecastRuntimeOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type { Bar, EvaluationCycleResult, Quote } from "@/lib/trader/intelligence/types";
import type {
  ExecutionV2AdmitAndSubmitInput,
  ExecutionV2CycleSubmitPort,
} from "@/lib/trader/execution/v2/org-order-path";
import { submitExecutionV2ForStrategyDecision } from "@/lib/trader/execution/v2/org-order-path";
import { runLiveCycleOnce, type LiveCycleDeps } from "@/lib/trader/live/run-live-cycle";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import type {
  CanonicalDecisionCapitalAuthorityV2Deps,
  DecisionAuthorityV2,
  DecisionStageOutcomeV2,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-000000115101";
const SYMBOL = "BTC/USDT";
const PIT = "2026-01-01T00:25:00.000Z";
const DIGEST = "a".repeat(64);

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
      contentDigestHex: DIGEST,
      anchorClosedBarAt: PIT,
      selectedPredictivePackageContentDigestHex: DIGEST,
    },
    issuance: { package: { family: { symbol: SYMBOL } } },
  } as unknown as ForecastRuntimeOutcomeV2;
}

function mockEvaluation(): EvaluationCycleResult {
  const signal = {
    strategySignalId: "signal-1151",
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
    msvId: "msv-1151",
    featureSetId: "feature-set-1151",
    evaluatedAt: PIT,
  };
  return {
    features: {
      featureSetId: "feature-set-1151",
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
      msvId: "msv-1151",
      instrumentId: SYMBOL,
      evaluatedAt: PIT,
      featureSetId: "feature-set-1151",
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
  };
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
  return { bars, quote, evaluatedAt: PIT, cycleIndex: 0, cycleId: "dee-1151-0" };
}

function actionableDecision(): DecisionAuthorityV2 {
  return {
    decisionId: "decision-1151",
    semanticDigestHex: "b".repeat(64),
    contentDigestHex: "c".repeat(64),
    forecastAuthorityContentDigestHex: DIGEST,
    action: "ENTER_LONG",
    evLower: "1",
    evBase: "2",
    evUpper: "3",
    economicSizeSetId: "sizes-1",
    economicSizeSetDigestHex: "d".repeat(64),
    qualifiedQuantity: "0.01",
  };
}

function noTrade(): DecisionStageOutcomeV2 {
  return {
    status: "NO_TRADE",
    decisionId: "decision-none",
    decisionContentDigestHex: "c".repeat(64),
    forecastAuthorityContentDigestHex: DIGEST,
    reasonCodes: ["EXECUTION_V2_DECISION_NOT_QUALIFIED"],
  };
}

function authority(decision: DecisionStageOutcomeV2): CanonicalDecisionCapitalAuthorityV2Deps {
  return {
    decide: vi.fn(async () => decision),
    assessRisk: vi.fn(async () => {
      throw new Error("assessRisk must not run on the Execution V2 submit branch");
    }),
    execute: vi.fn(async () => {
      throw new Error("execute must not run on the Execution V2 submit branch");
    }),
  };
}

function admissionRequest(): ExecutionV2AdmitAndSubmitInput {
  return { marker: "fake-admission" } as unknown as ExecutionV2AdmitAndSubmitInput;
}

describe("Execution V2 actionable submit (DEE-1151)", () => {
  beforeEach(() => {
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());
  });

  it("does not admit a NO_TRADE decision", async () => {
    const admitAndSubmit = vi.fn();
    await expect(
      submitExecutionV2ForStrategyDecision(
        noTrade(),
        { admitAndSubmit },
        requireOrgContext(ORG),
        admissionRequest(),
      ),
    ).resolves.toBeNull();
    expect(admitAndSubmit).not.toHaveBeenCalled();
  });

  it("admits a fake actionable decision exactly once", async () => {
    const admitAndSubmit = vi.fn(async () => ({ admitted: true, submission: { status: "READY" } }));
    const decision = { status: "ACTIONABLE" as const, decision: actionableDecision() };
    await submitExecutionV2ForStrategyDecision(
      decision,
      { admitAndSubmit } as unknown as ExecutionV2CycleSubmitPort,
      requireOrgContext(ORG),
      admissionRequest(),
    );
    expect(admitAndSubmit).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an actionable decision has no admission request", async () => {
    const admitAndSubmit = vi.fn();
    await expect(
      submitExecutionV2ForStrategyDecision(
        { status: "ACTIONABLE", decision: actionableDecision() },
        { admitAndSubmit },
        requireOrgContext(ORG),
        null,
      ),
    ).rejects.toThrow("EXECUTION_V2_ADMISSION_INPUTS_INCOMPLETE");
    expect(admitAndSubmit).not.toHaveBeenCalled();
  });

  it("paper and live cycles call admitAndSubmit only for a non-NO_TRADE decision", async () => {
    const paperSource = readFileSync(
      resolve(process.cwd(), "lib/trader/paper/paper-cycle-runner.ts"),
      "utf8",
    );
    const liveSource = readFileSync(
      resolve(process.cwd(), "lib/trader/live/run-live-cycle.ts"),
      "utf8",
    );
    expect(paperSource).toContain("submitExecutionV2ForStrategyDecision");
    expect(liveSource).toContain("submitExecutionV2ForStrategyDecision");
    expect(paperSource).not.toContain("runDecisionCapitalAuthorityV2");
    expect(liveSource).not.toContain("runDecisionCapitalAuthorityV2");
    expect(paperSource).toContain(".submitOrder(");
    expect(liveSource).not.toContain(".submitOrder(");

    const request = admissionRequest();
    const admitted = { admitted: true, submission: { status: "READY" } };

    const paperNoTrade = authority(noTrade());
    const paperNoTradeSubmit = vi.fn();
    const paperNoTradeResult = await runPaperCycleOnce(
      {
        execution: { submitOrder: vi.fn() },
        reconciliation: { reconcile: vi.fn() },
        decisionCapitalAuthorityV2: paperNoTrade,
        executionV2: { admitAndSubmit: paperNoTradeSubmit },
        executionV2AdmissionForActionableDecision: () => request,
      } as unknown as PaperCycleDeps,
      {
        context: requireOrgContext(ORG),
        snapshot: snapshot(),
        accountKey: "acct-1151",
        defaultQuantity: "0.01",
        executionMode: "paper",
        accountState: EMPTY_STATE,
        informationSufficiencyAuthority: declareResearchNonCapitalInformationAuthorityV2({
          organizationId: ORG,
          reason: "TRADER_EXECUTION_V2_ACTIONABLE_SUBMIT_UNIT_TEST",
        }),
      },
    );
    expect(paperNoTrade.decide).toHaveBeenCalled();
    expect(paperNoTradeSubmit).not.toHaveBeenCalled();
    expect(paperNoTrade.execute).not.toHaveBeenCalled();
    expect(paperNoTradeResult.skipReason).toBe("decision_v2_no_trade");

    const paperAction = authority({ status: "ACTIONABLE", decision: actionableDecision() });
    const paperSubmit = vi.fn(async () => admitted);
    const paperResult = await runPaperCycleOnce(
      {
        execution: { submitOrder: vi.fn() },
        reconciliation: { reconcile: vi.fn() },
        decisionCapitalAuthorityV2: paperAction,
        executionV2: { admitAndSubmit: paperSubmit },
        executionV2AdmissionForActionableDecision: () => request,
      } as unknown as PaperCycleDeps,
      {
        context: requireOrgContext(ORG),
        snapshot: snapshot(),
        accountKey: "acct-1151",
        defaultQuantity: "0.01",
        executionMode: "paper",
        accountState: EMPTY_STATE,
        informationSufficiencyAuthority: declareResearchNonCapitalInformationAuthorityV2({
          organizationId: ORG,
          reason: "TRADER_EXECUTION_V2_ACTIONABLE_SUBMIT_UNIT_TEST",
        }),
      },
    );
    expect(paperSubmit).toHaveBeenCalledTimes(1);
    expect(paperSubmit).toHaveBeenCalledWith(requireOrgContext(ORG), request);
    expect(paperAction.execute).not.toHaveBeenCalled();
    expect(paperResult.submitBlocked).toBe(false);

    const liveBase = {
      execution: { submitOrder: vi.fn() },
      reconciliation: { reconcile: vi.fn() },
      reportingBridge: {},
      feeComputation: {},
      hwmLedger: {},
      orderRepository: {},
    };
    const liveNoTrade = authority(noTrade());
    const liveNoTradeSubmit = vi.fn();
    const liveNoTradeResult = await runLiveCycleOnce(
      {
        ...liveBase,
        decisionCapitalAuthorityV2: liveNoTrade,
        executionV2: { admitAndSubmit: liveNoTradeSubmit },
        executionV2AdmissionForActionableDecision: () => request,
      } as unknown as LiveCycleDeps,
      {
        context: requireOrgContext(ORG),
        snapshot: snapshot(),
        accountKey: "acct-1151",
        exchangeAccountId: "htx-spot-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        credentialId: "cred-1151",
        defaultQuantity: "0.01",
      },
    );
    expect(liveNoTradeSubmit).not.toHaveBeenCalled();
    expect(liveNoTrade.execute).not.toHaveBeenCalled();
    expect(liveNoTradeResult.skipReason).toBe("decision_v2_no_trade");

    const liveAction = authority({ status: "ACTIONABLE", decision: actionableDecision() });
    const liveSubmit = vi.fn(async () => admitted);
    const liveResult = await runLiveCycleOnce(
      {
        ...liveBase,
        decisionCapitalAuthorityV2: liveAction,
        executionV2: { admitAndSubmit: liveSubmit },
        executionV2AdmissionForActionableDecision: () => request,
      } as unknown as LiveCycleDeps,
      {
        context: requireOrgContext(ORG),
        snapshot: snapshot(),
        accountKey: "acct-1151",
        exchangeAccountId: "htx-spot-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        credentialId: "cred-1151",
        defaultQuantity: "0.01",
      },
    );
    expect(liveSubmit).toHaveBeenCalledTimes(1);
    expect(liveAction.execute).not.toHaveBeenCalled();
    expect(liveResult.submitBlocked).toBe(false);
  });
});
