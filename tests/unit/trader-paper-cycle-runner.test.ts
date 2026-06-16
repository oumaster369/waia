import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OrderExecutionService,
  SubmitOrderResult,
} from "@/lib/trader/execution/execution-service.types";
import type { ReconciliationReport } from "@/lib/trader/execution/reconciliation.types";
import * as evaluationCycleModule from "@/lib/trader/intelligence/evaluation-cycle";
import type { Bar, EvaluationCycleResult, Quote } from "@/lib/trader/intelligence/types";
import { FixtureBarReplaySource } from "@/lib/trader/market-data/fixture-bar-replay-source";
import {
  cycleOrderKeys,
  runFixturePaperCycles,
  runPaperCycleOnce,
} from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000260";

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function mockEvaluation(overrides: Partial<EvaluationCycleResult> = {}): EvaluationCycleResult {
  return {
    features: {
      featureSetId: "feature-set-260",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-01T00:25:00.000Z",
      features: {
        close: "64000",
        sma20: "65000",
        zscoreVsSma20: "-2.5",
        realizedVol20: "300",
        spreadBps: "1.5",
      },
      dataQualityScore: 0.9,
      inputs: { barCount: 25 },
    },
    msv: {
      msvId: "msv-260",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-01T00:25:00.000Z",
      featureSetId: "feature-set-260",
      physics: { close: "64000", zscoreVsSma20: "-2.5", realizedVol20: "300" },
      liquidity: { spreadBps: "1.5" },
      crowd: { fearGreedIndex: null, newsSentiment: "0" },
      futureContext: { eventRiskScore: "0" },
      derived: {
        regime: "TREND_BEAR",
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: ["mean_reversion_v0"],
        riskMultiplier: "1.0",
        dataQualityScore: 0.9,
        reasonCodes: ["CDE_QUALITY_ALLOW_TRADING", "CDE_REGIME_TREND_BEAR"],
      },
    },
    signal: {
      strategySignalId: "signal-260",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      organizationId: ORG,
      symbol: "BTC/USDT",
      outcome: "SIGNAL",
      side: "buy",
      confidence: "0.8",
      expectedEdge: "0.01",
      horizon: "1h",
      maxRisk: "100",
      reasonCodes: ["STRAT_MR_ZSCORE_BUY"],
      msvId: "msv-260",
      featureSetId: "feature-set-260",
      evaluatedAt: "2026-01-01T00:25:00.000Z",
    },
    ...overrides,
  };
}

function flatBars(count: number, close = "65000.00"): Bar[] {
  const bars: Bar[] = [];
  for (let index = 0; index < count; index += 1) {
    const openTime = new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000,
    ).toISOString();
    const closeTime = new Date(Date.parse(openTime) + 60_000).toISOString();
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      open: close,
      high: close,
      low: close,
      close,
      volume: "10.00",
      barOpenTime: openTime,
      barCloseTime: closeTime,
    });
  }
  return bars;
}

function mockDeps(): PaperCycleDeps {
  const submittedOrder = {
    id: "order-260",
    organizationId: ORG,
    clientOrderId: "client-paper-cycle-dee-260-0",
    state: "FILLED" as const,
    strategySignalId: "signal-260",
  };

  const executionResult: SubmitOrderResult = {
    status: "submitted",
    order: submittedOrder as SubmitOrderResult extends { status: "submitted" }
      ? SubmitOrderResult["order"]
      : never,
  };

  const reconciliationReport: ReconciliationReport = {
    organizationId: ORG,
    runStartedAt: new Date(0),
    outcomes: [
      {
        clientOrderId: "client-paper-cycle-dee-260-0",
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

  return {
    execution: {
      submitOrder: vi.fn(async () => executionResult),
    } satisfies OrderExecutionService,
    reconciliation: {
      reconcile: vi.fn(async () => reconciliationReport),
    },
  };
}

describe("paper cycle runner (DEE-260)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("cycleOrderKeys uses cycleId suffix convention", () => {
    expect(cycleOrderKeys("dee-260-2")).toEqual({
      clientOrderId: "client-paper-cycle-dee-260-2",
      idempotencyKey: "idem-paper-cycle-dee-260-2",
    });
  });

  it("passes telemetrySink to runEvaluationCycle", async () => {
    const lines: string[] = [];
    const sink = (line: string) => lines.push(line);
    const deps = mockDeps();
    const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "dee-260" });
    const next = replay.next();
    expect(next.done).toBe(false);
    if (next.done) {
      return;
    }

    const spy = vi
      .spyOn(evaluationCycleModule, "runEvaluationCycle")
      .mockReturnValue(mockEvaluation());

    await runPaperCycleOnce(deps, {
      context: requireOrgContext(ORG),
      snapshot: next.snapshot,
      accountKey: "acct-260",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      telemetrySink: sink,
    });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ telemetrySink: sink }));
  });

  it("uses cycleId-derived idempotency keys on submit", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());

    const snapshot = {
      bars: flatBars(25),
      quote: {
        symbol: "BTC/USDT",
        bid: "65000.00",
        ask: "65000.00",
        last: "65000.00",
        timestamp: flatBars(25).at(-1)!.barCloseTime,
      } satisfies Quote,
      evaluatedAt: flatBars(25).at(-1)!.barCloseTime,
      cycleIndex: 2,
      cycleId: "dee-260-2",
    };

    await runPaperCycleOnce(deps, {
      context: requireOrgContext(ORG),
      snapshot,
      accountKey: "acct-260",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
    });

    expect(deps.execution.submitOrder).toHaveBeenCalledWith(
      requireOrgContext(ORG),
      expect.objectContaining({
        clientOrderId: "client-paper-cycle-dee-260-2",
        idempotencyKey: "idem-paper-cycle-dee-260-2",
      }),
    );
  });

  it("returns NO_SIGNAL without submitting", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(
      mockEvaluation({
        signal: {
          ...mockEvaluation().signal,
          outcome: "NO_SIGNAL",
          side: undefined,
        },
      }),
    );

    const replay = new FixtureBarReplaySource({ mode: "full" });
    const next = replay.next();
    expect(next.done).toBe(false);
    if (next.done) {
      return;
    }

    const result = await runPaperCycleOnce(deps, {
      context: requireOrgContext(ORG),
      snapshot: next.snapshot,
      accountKey: "acct-260",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
    });

    expect(result.skipReason).toBe("no_signal");
    expect(result.execution).toBeNull();
    expect(deps.execution.submitOrder).not.toHaveBeenCalled();
  });

  it("runFixturePaperCycles runs N cycles with shared replay source", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());
    const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "batch" });

    const { results } = await runFixturePaperCycles({
      deps,
      context: requireOrgContext(ORG),
      n: 3,
      replay,
      accountKey: "acct-260",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
    });

    expect(results).toHaveLength(3);
    expect(deps.execution.submitOrder).toHaveBeenCalledTimes(3);
    expect(deps.reconciliation.reconcile).toHaveBeenCalledTimes(3);
  });
});
