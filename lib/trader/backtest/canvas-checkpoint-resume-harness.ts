import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { canvasStateContentDigest } from "@/lib/trader/market-data/canvas/market-canvas-serialization";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import {
  loadApprovedBenchmarkFixture,
  seedBenchmarkSession,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  readReplayCheckpoint,
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import type { MarketCanvasState } from "@/lib/trader/market-data/canvas/market-canvas.types";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";
import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";

import {
  assertCanvasDigestStable,
  restoreCanvasFromCheckpoint,
  writeCanvasSidecarBeforeCheckpoint,
} from "@/lib/trader/backtest/canvas-checkpoint-integration";

const BENCHMARK_STRATEGY_VERSION = "0.1.0";

function barsThroughCycleCount(cycleCount: number): number {
  if (cycleCount <= 0) {
    return 0;
  }
  if (cycleCount === 1) {
    return EXPAND_MIN_BARS;
  }
  return EXPAND_MIN_BARS + (cycleCount - 1);
}

function createBenchmarkNewIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(416100 + sequence).padStart(12, "0")}`;
  };
}

async function withDeterministicRandomUuid<T>(run: () => Promise<T>): Promise<T> {
  let sequence = 0;
  const originalRandomUuid = crypto.randomUUID.bind(crypto);
  crypto.randomUUID = () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(416200 + sequence).padStart(12, "0")}`;
  };
  try {
    return await run();
  } finally {
    crypto.randomUUID = originalRandomUuid;
  }
}

async function runIncrementalFixture(input: {
  maxCycles?: number;
  checkpointRunRoot?: string;
  resumeCycleStartIndex?: number;
  initialCanvasState?: MarketCanvasState;
  initialBars1mPrefix?: readonly Bar[];
}) {
  return withDeterministicRandomUuid(async () => {
    const fixture = loadApprovedBenchmarkFixture();
    const { session, context } = await seedBenchmarkSession();
    const window = {
      start: new Date(fixture.bars[0]!.barOpenTime),
      end: new Date(fixture.bars.at(-1)!.barCloseTime),
    };
    const barSource = new HistoricalBarReplaySource({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      cycleIdPrefix: "htr-wp09-canvas-resume",
      windowMode: "cursor",
    });
    try {
      return await runBacktest({
        context,
        barSource,
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "htr-wp09-canvas-resume",
        defaultQuantity: "0.01",
        costModel: createCostModelV1("10", "5"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: BENCHMARK_STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "htr-wp09-canvas-resume",
        runId: "htr-wp09-canvas-resume",
        split: "validation",
        window,
        accountState: {
          positions: [],
          openOrderCount: 0,
          dailyPnl: "0",
          drawdown: "0",
          quoteExposureByCurrency: {},
        },
        exportedAt: new Date(window.end),
        activeStrategyIds: [MEAN_REVERSION_V0],
        newId: createBenchmarkNewIdFactory(),
        substrateMode: "incremental",
        checkpointRunRoot: input.checkpointRunRoot,
        resumeCycleStartIndex: input.resumeCycleStartIndex,
        initialCanvasState: input.initialCanvasState,
        initialBars1mPrefix: input.initialBars1mPrefix,
      });
    } finally {
      session.cleanup();
    }
  });
}

export type CanvasIncrementalCheckpointResumeHarness = {
  terminalState: "CANVAS_INCREMENTAL_RESUME_OK" | "CANVAS_INCREMENTAL_RESUME_FAILED";
  interruptAtCycle: number;
  uninterruptedCycleCount: number;
  resumedCycleCount: number;
  parity: {
    evidenceDigestMatch: boolean;
    semanticReproDigestMatch: boolean;
    cycleCountMatch: boolean;
    canvasDigestMatch: boolean;
    fullHistoryRescansZero: boolean;
  };
};

export async function runCanvasIncrementalCheckpointResumeHarness(
  interruptAtCycle = 40,
): Promise<CanvasIncrementalCheckpointResumeHarness> {
  const fixture = loadApprovedBenchmarkFixture();
  const runRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp09-canvas-resume-"));

  const uninterrupted = await runIncrementalFixture({});
  const partial = await runIncrementalFixture({
    maxCycles: interruptAtCycle,
    checkpointRunRoot: runRootDir,
  });

  const checkpointBody = {
    schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
    backtestRunId: "htr-wp09-canvas-resume",
    datasetContentDigest: computeBarSetDigest(fixture.bars),
    datasetId: "htr-wp09-canvas-resume",
    codeSha: "harness",
    activePhase: "validation" as const,
    dbDurableThroughPhase: "none" as const,
    evidenceDurableThroughCycleIndex: interruptAtCycle - 1,
    safeResumeThroughCycleIndex: interruptAtCycle - 1,
    evidenceRunDir: runRootDir,
    evidenceChainDigest: null,
    evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL" as const,
    dbConnectionMode: "harness",
    replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE" as const,
  };

  const checkpoint = writeCanvasSidecarBeforeCheckpoint({
    runRootDir,
    canvasState: partial.canvasState,
    checkpoint: checkpointBody,
  });
  expectCanvasSidecarPresent(checkpoint);
  if (partial.canvasStateRef && checkpoint.canvasStateRef !== partial.canvasStateRef) {
    throw new Error("checkpoint canvasStateRef must match backtest sidecar ref");
  }

  const restored = restoreCanvasFromCheckpoint(runRootDir, checkpoint)!;
  assertCanvasDigestStable(partial.canvasState, restored);

  const prefixBars = fixture.bars.slice(0, barsThroughCycleCount(interruptAtCycle));
  const resumed = await runIncrementalFixture({
    resumeCycleStartIndex: interruptAtCycle,
    initialCanvasState: restored,
    initialBars1mPrefix: prefixBars,
  });

  const parity = {
    evidenceDigestMatch: uninterrupted.evidenceDigest === resumed.evidenceDigest,
    semanticReproDigestMatch:
      computeReplayReproContentDigest(uninterrupted.exportDocument) ===
      computeReplayReproContentDigest(resumed.exportDocument),
    cycleCountMatch: uninterrupted.cycleCount === resumed.cycleCount,
    canvasDigestMatch:
      canvasStateContentDigest(uninterrupted.canvasState) ===
      canvasStateContentDigest(resumed.canvasState),
    fullHistoryRescansZero: getFullHistoryRescanCount() === 0,
  };

  const ok = Object.values(parity).every(Boolean);
  return {
    terminalState: ok ? "CANVAS_INCREMENTAL_RESUME_OK" : "CANVAS_INCREMENTAL_RESUME_FAILED",
    interruptAtCycle,
    uninterruptedCycleCount: uninterrupted.cycleCount,
    resumedCycleCount: resumed.cycleCount,
    parity,
  };
}

function expectCanvasSidecarPresent(
  checkpoint: NonNullable<ReturnType<typeof readReplayCheckpoint>>,
): void {
  if (!checkpoint.canvasStateRef) {
    throw new Error("expected canvasStateRef on checkpoint");
  }
}

export function assertCanvasIncrementalCheckpointResumeHarness(
  harness: CanvasIncrementalCheckpointResumeHarness,
): void {
  if (harness.terminalState !== "CANVAS_INCREMENTAL_RESUME_OK") {
    throw new Error(`canvas incremental resume failed: ${JSON.stringify(harness.parity)}`);
  }
}
