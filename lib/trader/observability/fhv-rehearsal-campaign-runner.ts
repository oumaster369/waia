import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertCanvasDigestStable,
  restoreCanvasFromCheckpoint,
  writeCanvasSidecarBeforeCheckpoint,
} from "@/lib/trader/backtest/canvas-checkpoint-integration";
import {
  HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
  HTR_WP03_BENCHMARK_FIXTURE_SHA256,
  loadApprovedBenchmarkFixture,
  readGitCodeSha,
  seedBenchmarkSession,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { createStreamingEvidenceSink } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-sink";
import {
  readReplayCheckpoint,
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
  type ReplayRunTerminalState,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import type { Bar } from "@/lib/trader/intelligence/types";
import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";
import { assertFhvCampaignRuntimeIdentity } from "@/lib/trader/observability/fhv-campaign-runtime-identity";

export const FHV_REHEARSAL_CHECKPOINT_CYCLE = 40;
const BENCHMARK_STRATEGY_VERSION = "0.1.0";

export type FhvRehearsalCampaignProgressV1 = Readonly<{
  schemaVersion: "fhv-rehearsal-campaign-progress/v1";
  runId: string;
  barsProcessed: number;
  expectedCycles: number;
  phase: "running" | "paused_at_checkpoint" | "completed";
  updatedAtUtc: string;
}>;

export type FhvRehearsalCampaignResult = Readonly<{
  terminalState: ReplayRunTerminalState | "REHEARSAL_PAUSED";
  barsProcessed: number;
  evidenceDigest: string;
  semanticReproDigest: string;
  classification: "REHEARSAL_OK" | "REHEARSAL_FAILED" | "REHEARSAL_PAUSED";
}>;

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
    return `00000000-0000-4000-8000-${String(416900 + sequence).padStart(12, "0")}`;
  };
}

async function withDeterministicRandomUuid<T>(run: () => Promise<T>): Promise<T> {
  let sequence = 0;
  const originalRandomUuid = crypto.randomUUID.bind(crypto);
  crypto.randomUUID = () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(416950 + sequence).padStart(12, "0")}`;
  };
  try {
    return await run();
  } finally {
    crypto.randomUUID = originalRandomUuid;
  }
}

export function resolveFhvRehearsalEvidenceDir(runRoot: string): string {
  return join(runRoot, "streaming-evidence");
}

export function writeFhvRehearsalCampaignProgress(
  runRoot: string,
  progress: FhvRehearsalCampaignProgressV1,
): void {
  writeFileAtomic(
    join(runRoot, "fhv-rehearsal-campaign-progress.v1.json"),
    `${JSON.stringify(progress, null, 2)}\n`,
  );
}

export function readFhvRehearsalCampaignProgress(
  runRoot: string,
): FhvRehearsalCampaignProgressV1 | null {
  const path = join(runRoot, "fhv-rehearsal-campaign-progress.v1.json");
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvRehearsalCampaignProgressV1;
}

function readControlFileContent(path: string): string {
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8").trim();
}

export function isFhvPauseAtCheckpointRequested(runRoot: string): boolean {
  const path = join(runRoot, "control", "pause_at_checkpoint-request.v1.json");
  if (!existsSync(path)) {
    return false;
  }
  const content = readControlFileContent(path);
  return content.length > 0;
}

export function isFhvResumeFromCheckpointRequested(runRoot: string): boolean {
  const path = join(runRoot, "control", "resume_from_checkpoint-request.v1.json");
  if (!existsSync(path)) {
    return false;
  }
  const content = readControlFileContent(path);
  return content.length > 0;
}

export function consumeFhvCampaignControlMarker(runRoot: string, action: string): void {
  const path = join(runRoot, "control", `${action.toLowerCase()}-request.v1.json`);
  if (existsSync(path)) {
    writeFileAtomic(path, "");
  }
}

async function runWp03Segment(input: {
  runRoot: string;
  runId: string;
  maxCycles?: number;
  checkpointRunRoot?: string;
  resumeCycleStartIndex?: number;
  initialCanvasState?: Awaited<ReturnType<typeof runBacktest>>["canvasState"];
  initialBars1mPrefix?: readonly Bar[];
  evidenceSealMode?: "complete" | "partial";
  evidenceDir?: string;
}): Promise<{
  cycleCount: number;
  evidenceDigest: string;
  semanticReproDigest: string;
  canvasState: Awaited<ReturnType<typeof runBacktest>>["canvasState"];
}> {
  return withDeterministicRandomUuid(async () => {
    const fixture = loadApprovedBenchmarkFixture();
    const { session, context } = await seedBenchmarkSession();
    const evidenceDir = input.evidenceDir ?? resolveFhvRehearsalEvidenceDir(input.runRoot);
    mkdirSync(evidenceDir, { recursive: true });
    const evidenceSink = createStreamingEvidenceSink({
      runDir: evidenceDir,
      runId: input.runId,
      gitSha: readGitCodeSha(),
      environment: "fhv-rehearsal-campaign",
    });
    const window = {
      start: new Date(fixture.bars[0]!.barOpenTime),
      end: new Date(fixture.bars.at(-1)!.barCloseTime),
    };
    const barSource = new HistoricalBarReplaySource({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      cycleIdPrefix: buildResearchValidationCycleIdPrefix(input.runId),
      windowMode: "cursor",
    });
    try {
      const backtest = await runBacktest({
        context,
        barSource,
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "fhv-rehearsal-wp03",
        defaultQuantity: "0.01",
        costModel: costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1()),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: BENCHMARK_STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "fhv-rehearsal-wp03",
        runId: input.runId,
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
        retentionMode: "STREAM_ONLY",
        evidenceSink,
        maxCycles: input.maxCycles,
        checkpointRunRoot: input.checkpointRunRoot,
        resumeCycleStartIndex: input.resumeCycleStartIndex,
        initialCanvasState: input.initialCanvasState,
        initialBars1mPrefix: input.initialBars1mPrefix,
        evidenceSealMode: input.evidenceSealMode ?? (input.maxCycles ? "partial" : "complete"),
        evidenceSealReason: input.maxCycles ? "fhv-rehearsal-checkpoint-boundary" : undefined,
      });
      return {
        cycleCount: backtest.cycleCount,
        evidenceDigest: backtest.evidenceDigest,
        semanticReproDigest: computeReplayReproContentDigest(backtest.exportDocument),
        canvasState: backtest.canvasState,
      };
    } finally {
      session.cleanup();
    }
  });
}

async function runUninterrupted(input: {
  runRoot: string;
  runId: string;
}): Promise<FhvRehearsalCampaignResult> {
  const segment = await runWp03Segment({
    runRoot: input.runRoot,
    runId: input.runId,
    evidenceSealMode: "complete",
  });
  writeFhvRehearsalCampaignProgress(input.runRoot, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: input.runId,
    barsProcessed: segment.cycleCount,
    expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    phase: "completed",
    updatedAtUtc: new Date().toISOString(),
  });
  return {
    terminalState: "REPLAY_RUN_OK",
    barsProcessed: segment.cycleCount,
    evidenceDigest: segment.evidenceDigest,
    semanticReproDigest: segment.semanticReproDigest,
    classification: "REHEARSAL_OK",
  };
}

async function runPartialPause(input: {
  runRoot: string;
  runId: string;
}): Promise<FhvRehearsalCampaignResult> {
  const fixture = loadApprovedBenchmarkFixture();
  const partial = await runWp03Segment({
    runRoot: input.runRoot,
    runId: input.runId,
    maxCycles: FHV_REHEARSAL_CHECKPOINT_CYCLE,
    checkpointRunRoot: input.runRoot,
    evidenceSealMode: "partial",
  });
  const checkpoint = writeCanvasSidecarBeforeCheckpoint({
    runRootDir: input.runRoot,
    canvasState: partial.canvasState,
    checkpoint: {
      schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
      backtestRunId: input.runId,
      datasetContentDigest: computeBarSetDigest(fixture.bars),
      datasetId: "fhv-rehearsal-wp03",
      codeSha: readGitCodeSha(),
      activePhase: "validation",
      dbDurableThroughPhase: "none",
      evidenceDurableThroughCycleIndex: FHV_REHEARSAL_CHECKPOINT_CYCLE - 1,
      safeResumeThroughCycleIndex: FHV_REHEARSAL_CHECKPOINT_CYCLE - 1,
      evidenceRunDir: resolveFhvRehearsalEvidenceDir(input.runRoot),
      evidenceChainDigest: null,
      evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
      dbConnectionMode: "harness",
      replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      fixtureSha256: HTR_WP03_BENCHMARK_FIXTURE_SHA256,
    },
  });
  if (!checkpoint.canvasStateRef) {
    throw new Error("FHV_REHEARSAL_CHECKPOINT_MISSING_CANVAS");
  }
  writeFhvRehearsalCampaignProgress(input.runRoot, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: input.runId,
    barsProcessed: partial.cycleCount,
    expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    phase: "paused_at_checkpoint",
    updatedAtUtc: new Date().toISOString(),
  });
  consumeFhvCampaignControlMarker(input.runRoot, "PAUSE_AT_CHECKPOINT");
  return {
    terminalState: "REHEARSAL_PAUSED",
    barsProcessed: partial.cycleCount,
    evidenceDigest: partial.evidenceDigest,
    semanticReproDigest: partial.semanticReproDigest,
    classification: "REHEARSAL_PAUSED",
  };
}

async function runResumeFromCheckpoint(input: {
  runRoot: string;
  runId: string;
}): Promise<FhvRehearsalCampaignResult> {
  const fixture = loadApprovedBenchmarkFixture();
  const checkpoint = readReplayCheckpoint(input.runRoot);
  if (!checkpoint) {
    throw new Error("FHV_REHEARSAL_CHECKPOINT_MISSING");
  }
  const restored = restoreCanvasFromCheckpoint(input.runRoot, checkpoint);
  if (!restored) {
    throw new Error("FHV_REHEARSAL_CANVAS_RESTORE_FAILED");
  }
  const prefixBars = fixture.bars.slice(0, barsThroughCycleCount(FHV_REHEARSAL_CHECKPOINT_CYCLE));
  const resumed = await runWp03Segment({
    runRoot: input.runRoot,
    runId: input.runId,
    resumeCycleStartIndex: FHV_REHEARSAL_CHECKPOINT_CYCLE,
    initialCanvasState: restored,
    initialBars1mPrefix: prefixBars,
    evidenceSealMode: "complete",
    evidenceDir: join(input.runRoot, "streaming-evidence-resume"),
  });
  if (getFullHistoryRescanCount() !== 0) {
    throw new Error("FHV_REHEARSAL_RESUME_FULL_HISTORY_RESCAN");
  }
  consumeFhvCampaignControlMarker(input.runRoot, "RESUME_FROM_CHECKPOINT");
  writeFhvRehearsalCampaignProgress(input.runRoot, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: input.runId,
    barsProcessed: resumed.cycleCount,
    expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    phase: "completed",
    updatedAtUtc: new Date().toISOString(),
  });
  writeFileAtomic(
    join(input.runRoot, "fhv-rehearsal-terminal.v1.json"),
    `${JSON.stringify({ classification: "REHEARSAL_OK", ...resumed }, null, 2)}\n`,
  );
  return {
    terminalState: "REPLAY_RUN_OK",
    barsProcessed: resumed.cycleCount,
    evidenceDigest: resumed.evidenceDigest,
    semanticReproDigest: resumed.semanticReproDigest,
    classification: "REHEARSAL_OK",
  };
}

export async function runFhvRehearsalCampaign(input: {
  runRoot: string;
  targetSha: string;
  runId: string;
  organizationId: string;
  resumeFromCheckpoint?: boolean;
}): Promise<FhvRehearsalCampaignResult> {
  assertFhvCampaignRuntimeIdentity(input);
  mkdirSync(resolveFhvRehearsalEvidenceDir(input.runRoot), { recursive: true });

  if (input.resumeFromCheckpoint || isFhvResumeFromCheckpointRequested(input.runRoot)) {
    return runResumeFromCheckpoint(input);
  }
  if (isFhvPauseAtCheckpointRequested(input.runRoot)) {
    return runPartialPause(input);
  }
  const existing = readReplayCheckpoint(input.runRoot);
  if (
    existing &&
    readFhvRehearsalCampaignProgress(input.runRoot)?.phase === "paused_at_checkpoint"
  ) {
    return {
      terminalState: "REHEARSAL_PAUSED",
      barsProcessed: FHV_REHEARSAL_CHECKPOINT_CYCLE,
      evidenceDigest: "",
      semanticReproDigest: "",
      classification: "REHEARSAL_PAUSED",
    };
  }
  return runUninterrupted(input);
}

export async function runFhvRehearsalCampaignParityProof(input: {
  runRootUninterrupted: string;
  runRootPauseResume: string;
  runId: string;
  targetSha: string;
  organizationId: string;
}): Promise<{ uninterruptedDigest: string; resumedDigest: string; match: boolean }> {
  const uninterrupted = await runFhvRehearsalCampaign({
    runRoot: input.runRootUninterrupted,
    runId: input.runId,
    targetSha: input.targetSha,
    organizationId: input.organizationId,
  });
  writeFhvCampaignControlPauseRequest(input.runRootPauseResume);
  const paused = await runFhvRehearsalCampaign({
    runRoot: input.runRootPauseResume,
    runId: input.runId,
    targetSha: input.targetSha,
    organizationId: input.organizationId,
  });
  if (paused.classification !== "REHEARSAL_PAUSED") {
    throw new Error("Expected paused rehearsal classification.");
  }
  writeFhvCampaignControlResumeRequest(input.runRootPauseResume);
  const resumed = await runFhvRehearsalCampaign({
    runRoot: input.runRootPauseResume,
    runId: input.runId,
    targetSha: input.targetSha,
    organizationId: input.organizationId,
    resumeFromCheckpoint: true,
  });
  return {
    uninterruptedDigest: uninterrupted.semanticReproDigest,
    resumedDigest: resumed.semanticReproDigest,
    match: uninterrupted.semanticReproDigest === resumed.semanticReproDigest,
  };
}

function writeFhvCampaignControlPauseRequest(runRoot: string): void {
  mkdirSync(join(runRoot, "control"), { recursive: true });
  writeFileAtomic(
    join(runRoot, "control", "pause_at_checkpoint-request.v1.json"),
    `${JSON.stringify({ action: "PAUSE_AT_CHECKPOINT" }, null, 2)}\n`,
  );
}

function writeFhvCampaignControlResumeRequest(runRoot: string): void {
  mkdirSync(join(runRoot, "control"), { recursive: true });
  writeFileAtomic(
    join(runRoot, "control", "resume_from_checkpoint-request.v1.json"),
    `${JSON.stringify({ action: "RESUME_FROM_CHECKPOINT" }, null, 2)}\n`,
  );
}

export function assertCanvasDigestStableForTests(
  before: Awaited<ReturnType<typeof runBacktest>>["canvasState"],
  after: Awaited<ReturnType<typeof runBacktest>>["canvasState"],
): void {
  assertCanvasDigestStable(before, after);
}
