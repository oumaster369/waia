import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { MEAN_REVERSION_V0, type Bar, type FeatureSnapshot } from "@/lib/trader/intelligence/types";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import * as paperCycleRunnerModule from "@/lib/trader/paper/paper-cycle-runner";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000458a1";
const START_MS = Date.parse("2026-09-30T00:00:00.000Z");

function buildBars(): Bar[] {
  const closes = [...Array.from({ length: 20 }, () => "65000.00"), "50000.00", "90000.00"];
  return closes.map((close, index) => {
    const barOpenTime = new Date(START_MS + index * 60_000).toISOString();
    return {
      symbol: "BTC/USDT",
      interval: "1m",
      open: close,
      high: close,
      low: close,
      close,
      volume: "10",
      barOpenTime,
      barCloseTime: new Date(START_MS + (index + 1) * 60_000).toISOString(),
    };
  });
}

describe("runBacktest evaluation bar context", () => {
  let session: Awaited<ReturnType<typeof createInMemoryResearchBacktestSession>>;
  let context: ReturnType<typeof requireOrgContext>;
  let bars: Bar[];

  beforeEach(async () => {
    session = await createInMemoryResearchBacktestSession();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "backtest-evaluation-context@waia.invalid",
      password: "test-only-password",
      identityLabel: "Backtest Evaluation Context",
    });
    const organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Backtest Evaluation Context",
    });
    context = requireOrgContext(organizationId);
    bars = buildBars();
  });

  afterEach(() => {
    session.cleanup();
  });

  async function execute(input: {
    runId: string;
    source: HistoricalBarReplaySource;
    maxCycles: number;
    resumeCycleStartIndex?: number;
    initialBars1mPrefix?: readonly Bar[];
  }) {
    return runBacktest({
      context,
      barSource: input.source,
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: `evaluation-context-${input.runId}`,
      defaultQuantity: "0.01",
      costModel: createCostModelV1("0", "0"),
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: "0.1.0",
      regimeLabel: "AGGREGATE",
      datasetId: `dataset-${input.runId}`,
      runId: input.runId,
      split: "validation",
      window: {
        start: new Date(bars[0]!.barOpenTime),
        end: new Date(bars.at(-1)!.barCloseTime),
      },
      accountState: createHtrInitialAccountRiskState(),
      exportedAt: new Date(bars.at(-1)!.barCloseTime),
      activeStrategyIds: ["__htr-blocked__"],
      maxCycles: input.maxCycles,
      hypothesisSessionState: createEmptyHypothesisSessionState(),
      enableReplayFusedContext: false,
      historicalExecutionProfile: session.historicalExecutionProfile,
      ...(input.resumeCycleStartIndex === undefined
        ? {}
        : { resumeCycleStartIndex: input.resumeCycleStartIndex }),
      ...(input.initialBars1mPrefix === undefined
        ? {}
        : { initialBars1mPrefix: input.initialBars1mPrefix }),
    });
  }

  function expectEvaluationUsesBars(actual: FeatureSnapshot, visibleBars: readonly Bar[]) {
    const expected = computeFeatureSnapshot({
      bars: visibleBars,
      evaluatedAt: visibleBars.at(-1)!.barCloseTime,
    });
    expect(actual.instrumentId).toBe(expected.instrumentId);
    expect(actual.evaluatedAt).toBe(expected.evaluatedAt);
    expect(actual.inputs.barCount).toBe(expected.inputs.barCount);
    expect(actual.features).toEqual(expected.features);
  }

  it("uses the accumulated point-in-time cursor history for real CDE classification", async () => {
    const source = new HistoricalBarReplaySource({ bars, cycleIdPrefix: "dee-1158-cursor" });
    const cycleSpy = vi.spyOn(paperCycleRunnerModule, "runPaperCycleOnce");
    let result: Awaited<ReturnType<typeof execute>>;
    let dropEvaluationBars: readonly Bar[] | undefined;
    let dropSnapshotBars: readonly Bar[] | undefined;
    try {
      result = await execute({ runId: "cursor", source, maxCycles: 3 });
      const dropCycleInput = cycleSpy.mock.calls[1]?.[1];
      dropEvaluationBars = dropCycleInput?.evaluationBars;
      dropSnapshotBars = dropCycleInput?.snapshot.bars;
    } finally {
      cycleSpy.mockRestore();
    }

    expect(result.cycleResults).toHaveLength(3);
    expect(dropSnapshotBars).toHaveLength(1);
    expect(dropSnapshotBars?.[0]?.close).toBe("50000.00");
    expect(dropEvaluationBars).toHaveLength(21);
    expect(Object.isFrozen(dropEvaluationBars)).toBe(true);
    expect(dropEvaluationBars?.every(Object.isFrozen)).toBe(true);
    expect(dropEvaluationBars?.at(-1)?.close).toBe("50000.00");
    expectEvaluationUsesBars(result.cycleResults[0]!.evaluation.features, bars.slice(0, 20));
    expect(result.cycleResults[0]!.evaluation.msv.derived.regime).toBe("CHOP");

    const atDrop = result.cycleResults[1]!.evaluation;
    expectEvaluationUsesBars(atDrop.features, bars.slice(0, 21));
    expect(atDrop.features.features.close).toBe("50000.00");
    expect(atDrop.msv.derived.regime).toBe("TREND_BEAR");

    // The later 90,000 close must not leak backward into the drop-cycle feature window.
    expect(atDrop.features.features.close).not.toBe(bars.at(-1)!.close);
    expect(atDrop.features.instrumentId).toBe("BTC/USDT");
    expect(atDrop.features.evaluatedAt).toBe(bars[20]!.barCloseTime);
    expect(result.cycleResults[0]!.evaluation.features.features.close).toBe("65000.00");
    expect(dropEvaluationBars).toHaveLength(21);
    expect(dropEvaluationBars?.at(-1)?.close).toBe("50000.00");
  });

  it("does not append an expanding snapshot twice to its already-complete context", async () => {
    const source = new HistoricalBarReplaySource({
      bars,
      cycleIdPrefix: "dee-1158-expanding",
      windowMode: "expanding",
    });
    const result = await execute({ runId: "expanding", source, maxCycles: 2 });

    expect(result.cycleResults).toHaveLength(2);
    expectEvaluationUsesBars(result.cycleResults[1]!.evaluation.features, bars.slice(0, 21));
    expect(result.cycleResults[1]!.evaluation.msv.derived.regime).toBe("TREND_BEAR");
  });

  it("continues point-in-time context from an initial prefix when resuming", async () => {
    const source = new HistoricalBarReplaySource({ bars, cycleIdPrefix: "dee-1158-resume" });
    const result = await execute({
      runId: "resume",
      source,
      maxCycles: 2,
      resumeCycleStartIndex: 1,
      initialBars1mPrefix: [
        ...bars.slice(0, 20),
        {
          ...bars[0]!,
          symbol: "ETH/USDT",
          open: "3000.00",
          high: "3000.00",
          low: "3000.00",
          close: "3000.00",
        },
        {
          ...bars[0]!,
          interval: "15m",
          open: "100.00",
          high: "100.00",
          low: "100.00",
          close: "100.00",
        },
      ],
    });

    expect(result.cycleResults).toHaveLength(1);
    expectEvaluationUsesBars(result.cycleResults[0]!.evaluation.features, bars.slice(0, 21));
    expect(result.cycleResults[0]!.evaluation.msv.derived.regime).toBe("TREND_BEAR");
  });

  it.each([
    {
      label: "future same-asset prefix bar",
      extendPrefix: (history: Bar[]) => [...history, bars[21]!],
    },
    {
      label: "duplicate same-asset prefix bar",
      extendPrefix: (history: Bar[]) => [...history, history[19]!],
    },
  ])("rejects a $label during resumed point-in-time evaluation", async ({ extendPrefix }) => {
    const source = new HistoricalBarReplaySource({
      bars,
      cycleIdPrefix: "dee-1158-invalid-prefix",
    });
    await expect(
      execute({
        runId: "invalid-prefix",
        source,
        maxCycles: 2,
        resumeCycleStartIndex: 1,
        initialBars1mPrefix: extendPrefix(bars.slice(0, 20)),
      }),
    ).rejects.toThrow("BACKTEST_EVALUATION_CONTEXT_INVALID_CHRONOLOGY");
  });
});
