import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OrderExecutionService,
  SubmitOrderResult,
} from "@/lib/trader/execution/execution-service.types";
import type { ReconciliationReport } from "@/lib/trader/execution/reconciliation.types";
import * as evaluationCycleModule from "@/lib/trader/intelligence/evaluation-cycle";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import { FixtureBarReplaySource } from "@/lib/trader/market-data/fixture-bar-replay-source";
import type { BarPollSource } from "@/lib/trader/market-data/types";
import { msUntilNextBarClose, runPaperBarCloseLoop } from "@/lib/trader/paper/paper-bar-close-loop";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000264";

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function mockEvaluation(overrides: Partial<EvaluationCycleResult> = {}): EvaluationCycleResult {
  const signal = {
    strategySignalId: "signal-264",
    strategyId: "mean_reversion_v0" as const,
    strategyVersion: "0.1.0",
    organizationId: ORG,
    symbol: "BTC/USDT" as const,
    outcome: "SIGNAL" as const,
    side: "buy" as const,
    confidence: "0.8",
    expectedEdge: "0.01",
    horizon: "1h" as const,
    maxRisk: "100",
    reasonCodes: ["STRAT_MR_ZSCORE_BUY"],
    msvId: "msv-264",
    featureSetId: "feature-set-264",
    evaluatedAt: "2026-01-01T00:25:00.000Z",
  };
  const result: EvaluationCycleResult = {
    features: {
      featureSetId: "feature-set-264",
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
      msvId: "msv-264",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-01T00:25:00.000Z",
      featureSetId: "feature-set-264",
      physics: { close: "64000", zscoreVsSma20: "-2.5", realizedVol20: "300" },
      liquidity: { spreadBps: "1.5" },
      crowd: { fearGreedIndex: null, newsSentiment: "0" },
      futureContext: { eventRiskScore: "0" },
      derived: {
        regime: "TREND_BEAR",
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: ["mean_reversion_v0", "liquidity_sweep_reversal_v0"],
        riskMultiplier: "1.0",
        dataQualityScore: 0.9,
        reasonCodes: ["CDE_QUALITY_ALLOW_TRADING", "CDE_REGIME_TREND_BEAR"],
      },
    },
    signal,
    signals: [signal],
    ...overrides,
  };
  if (overrides.signal && !overrides.signals) {
    result.signals = [overrides.signal];
  }
  return result;
}

function mockDeps(): PaperCycleDeps {
  const submittedOrder = {
    id: "order-264",
    organizationId: ORG,
    clientOrderId: "client-paper-cycle-bar-close-0",
    state: "FILLED" as const,
    strategySignalId: "signal-264",
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
        clientOrderId: "client-paper-cycle-bar-close-0",
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

function mockPollFromReplay(prefix: string): BarPollSource {
  const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: prefix });
  return {
    reset: () => replay.reset(),
    fetchSnapshot: async () => {
      const next = replay.next();
      if (next.done) {
        throw new Error("[test] poll source exhausted");
      }
      return next.snapshot;
    },
  };
}

describe("paper bar-close loop (AT-E9 S5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("msUntilNextBarClose", () => {
    it("returns 0 when already on a bar boundary", () => {
      expect(msUntilNextBarClose(0, 60_000)).toBe(0);
      expect(msUntilNextBarClose(60_000, 60_000)).toBe(0);
    });

    it("returns remaining ms until the next boundary", () => {
      expect(msUntilNextBarClose(30_000, 60_000)).toBe(30_000);
      expect(msUntilNextBarClose(60_001, 60_000)).toBe(59_999);
    });

    it("rejects non-positive bar intervals", () => {
      expect(() => msUntilNextBarClose(0, 0)).toThrow(/barIntervalMs must be positive/);
    });
  });

  it("runs maxCycles with injectable no-op sleep and mock poll/deps", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());
    const poll = mockPollFromReplay("bar-close-unit");

    const result = await runPaperBarCloseLoop({
      deps,
      poll,
      context: requireOrgContext(ORG),
      accountKey: "acct-bar-close",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      maxCycles: 2,
      sleep: async () => {},
      nowMs: () => 0,
    });

    expect(result).toEqual({ cyclesRun: 2, aborted: false });
    expect(deps.execution.submitOrder).toHaveBeenCalledTimes(2);
    expect(deps.reconciliation.reconcile).toHaveBeenCalledTimes(2);
  });

  it("abortSignal stops loop before a third cycle when maxCycles is unset", async () => {
    const baseDeps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());
    const poll = mockPollFromReplay("bar-close-abort");
    const controller = new AbortController();

    const deps: PaperCycleDeps = {
      execution: {
        submitOrder: async (...args) => {
          const result = await baseDeps.execution.submitOrder(...args);
          if (vi.mocked(baseDeps.execution.submitOrder).mock.calls.length >= 2) {
            controller.abort();
          }
          return result;
        },
      },
      reconciliation: baseDeps.reconciliation,
    };

    const result = await runPaperBarCloseLoop({
      deps,
      poll,
      context: requireOrgContext(ORG),
      accountKey: "acct-bar-close",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      sleep: async () => {},
      nowMs: () => 0,
      abortSignal: controller.signal,
    });

    expect(result.cyclesRun).toBe(2);
    expect(result.aborted).toBe(true);
    expect(baseDeps.execution.submitOrder).toHaveBeenCalledTimes(2);
  });

  it("passes executionMode mock through runPaperCycleOnce submit path", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());
    const replay = new FixtureBarReplaySource({ mode: "full", cycleIdPrefix: "mock-mode" });
    const next = replay.next();
    expect(next.done).toBe(false);
    if (next.done) {
      return;
    }

    const poll: BarPollSource = {
      reset: () => replay.reset(),
      fetchSnapshot: async () => next.snapshot,
    };

    await runPaperBarCloseLoop({
      deps,
      poll,
      context: requireOrgContext(ORG),
      accountKey: "acct-bar-close",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      maxCycles: 1,
      sleep: async () => {},
      nowMs: () => 0,
    });

    expect(deps.execution.submitOrder).toHaveBeenCalledWith(
      requireOrgContext(ORG),
      expect.objectContaining({ executionMode: "mock" }),
    );
  });

  it("rejects non-positive maxCycles", async () => {
    await expect(
      runPaperBarCloseLoop({
        deps: mockDeps(),
        poll: mockPollFromReplay("invalid"),
        context: requireOrgContext(ORG),
        accountKey: "acct-bar-close",
        defaultQuantity: "0.01",
        accountState: EMPTY_STATE,
        maxCycles: 0,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/maxCycles must be positive/);
  });

  it("emits exactly two paper_loop cycle_complete events for maxCycles 2", async () => {
    const deps = mockDeps();
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(mockEvaluation());
    const poll = mockPollFromReplay("bar-close-telemetry");
    const lines: string[] = [];
    const telemetrySink = (line: string) => lines.push(line);

    const result = await runPaperBarCloseLoop({
      deps,
      poll,
      context: requireOrgContext(ORG),
      accountKey: "acct-bar-close",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      maxCycles: 2,
      sleep: async () => {},
      nowMs: () => 0,
      telemetrySink,
    });

    expect(result).toEqual({ cyclesRun: 2, aborted: false });

    const cycleCompleteLines = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.kind === "paper_loop" && event.outcome === "cycle_complete");

    expect(cycleCompleteLines).toHaveLength(2);
    expect(cycleCompleteLines[0]?.cycles_run).toBe(1);
    expect(cycleCompleteLines[1]?.cycles_run).toBe(2);
    expect(cycleCompleteLines[0]?.execution_status).toBe("submitted");
  });
});
