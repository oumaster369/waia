import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
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
import type { FhvRehearsalLaunchConfigV1 } from "@/lib/trader/observability/fhv-rehearsal-launcher";

export const FHV_REHEARSAL_CHECKPOINT_CYCLE = 40;
export const FHV_REHEARSAL_RUNTIME_MAX_SEC = 300;
const BENCHMARK_STRATEGY_VERSION = "0.1.0";

export type FhvRehearsalCampaignProgressV1 = Readonly<{
  schemaVersion: "fhv-rehearsal-campaign-progress/v1";
  runId: string;
  cyclesProcessed: number;
  expectedCycles: number;
  phase: "running" | "paused_at_checkpoint" | "completed" | "timeout";
  updatedAtUtc: string;
}>;

export type FhvRehearsalCampaignResult = Readonly<{
  terminalState: ReplayRunTerminalState | "REHEARSAL_PAUSED" | "REHEARSAL_TIMEOUT";
  cyclesProcessed: number;
  evidenceDigest: string;
  semanticReproDigest: string;
  classification: "REHEARSAL_OK" | "REHEARSAL_FAILED" | "REHEARSAL_PAUSED" | "REHEARSAL_TIMEOUT";
}>;

export type FhvRehearsalMonotonicDeadline = Readonly<{
  deadlineMs: number;
}>;

export class FhvRehearsalCampaignError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvRehearsalCampaignError";
  }
}

export function createFhvRehearsalMonotonicDeadline(
  maxRuntimeMs: number,
  startedAtMs: number = Date.now(),
): FhvRehearsalMonotonicDeadline {
  return { deadlineMs: startedAtMs + maxRuntimeMs };
}

export function assertFhvRehearsalWithinDeadline(deadline: FhvRehearsalMonotonicDeadline): void {
  if (Date.now() > deadline.deadlineMs) {
    throw new FhvRehearsalCampaignError(
      "REHEARSAL_DEADLINE_EXCEEDED",
      "Campaign exceeded the configured rehearsal runtime deadline.",
    );
  }
}

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
  const parsed = JSON.parse(readFileSync(path, "utf8")) as FhvRehearsalCampaignProgressV1 & {
    barsProcessed?: number;
  };
  return {
    ...parsed,
    cyclesProcessed: parsed.cyclesProcessed ?? parsed.barsProcessed ?? 0,
  };
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
  return readControlFileContent(path).length > 0;
}

export function isFhvResumeFromCheckpointRequested(runRoot: string): boolean {
  const path = join(runRoot, "control", "resume_from_checkpoint-request.v1.json");
  if (!existsSync(path)) {
    return false;
  }
  return readControlFileContent(path).length > 0;
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
  deadline?: FhvRehearsalMonotonicDeadline;
  onCycleComplete?: (cyclesProcessed: number) => void;
  shouldStopAfterCycle?: (cyclesProcessed: number) => boolean;
}): Promise<{
  cycleCount: number;
  evidenceDigest: string;
  semanticReproDigest: string;
  canvasState: Awaited<ReturnType<typeof runBacktest>>["canvasState"];
  stoppedEarly: boolean;
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
    let stoppedEarly = false;
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
        onCycleBoundary: ({ cycleCount }) => {
          if (input.deadline) {
            assertFhvRehearsalWithinDeadline(input.deadline);
          }
          input.onCycleComplete?.(cycleCount);
          if (input.shouldStopAfterCycle?.(cycleCount)) {
            stoppedEarly = true;
            return "stop";
          }
          return "continue";
        },
      });
      return {
        cycleCount: backtest.cycleCount,
        evidenceDigest: backtest.evidenceDigest,
        semanticReproDigest: computeReplayReproContentDigest(backtest.exportDocument),
        canvasState: backtest.canvasState,
        stoppedEarly,
      };
    } finally {
      session.cleanup();
    }
  });
}

function writePausedCheckpoint(input: {
  runRoot: string;
  runId: string;
  partial: Awaited<ReturnType<typeof runWp03Segment>>;
  checkpointCycle: number;
}): void {
  const fixture = loadApprovedBenchmarkFixture();
  writeCanvasSidecarBeforeCheckpoint({
    runRootDir: input.runRoot,
    canvasState: input.partial.canvasState,
    checkpoint: {
      schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
      backtestRunId: input.runId,
      datasetContentDigest: computeBarSetDigest(fixture.bars),
      datasetId: "fhv-rehearsal-wp03",
      codeSha: readGitCodeSha(),
      activePhase: "validation",
      dbDurableThroughPhase: "none",
      evidenceDurableThroughCycleIndex: input.checkpointCycle - 1,
      safeResumeThroughCycleIndex: input.checkpointCycle - 1,
      evidenceRunDir: resolveFhvRehearsalEvidenceDir(input.runRoot),
      evidenceChainDigest: null,
      evidenceTerminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
      dbConnectionMode: "harness",
      replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      fixtureSha256: HTR_WP03_BENCHMARK_FIXTURE_SHA256,
    },
  });
}

async function finalizePauseAtCheckpoint(input: {
  runRoot: string;
  runId: string;
  partial: Awaited<ReturnType<typeof runWp03Segment>>;
  checkpointCycle: number;
}): Promise<FhvRehearsalCampaignResult> {
  writePausedCheckpoint(input);
  writeFhvRehearsalCampaignProgress(input.runRoot, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: input.runId,
    cyclesProcessed: input.partial.cycleCount,
    expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    phase: "paused_at_checkpoint",
    updatedAtUtc: new Date().toISOString(),
  });
  consumeFhvCampaignControlMarker(input.runRoot, "PAUSE_AT_CHECKPOINT");
  writeFileAtomic(
    join(input.runRoot, "fhv-rehearsal-terminal.v1.json"),
    `${JSON.stringify({ classification: "REHEARSAL_PAUSED", cyclesProcessed: input.partial.cycleCount }, null, 2)}\n`,
  );
  return {
    terminalState: "REHEARSAL_PAUSED",
    cyclesProcessed: input.partial.cycleCount,
    evidenceDigest: input.partial.evidenceDigest,
    semanticReproDigest: input.partial.semanticReproDigest,
    classification: "REHEARSAL_PAUSED",
  };
}

async function runCampaignWithPauseSupport(input: {
  runRoot: string;
  runId: string;
  manifest: FhvRehearsalLaunchConfigV1;
  monotonicDeadline?: FhvRehearsalMonotonicDeadline;
  checkpointCycle?: number;
}): Promise<FhvRehearsalCampaignResult> {
  const checkpointCycle = input.checkpointCycle ?? FHV_REHEARSAL_CHECKPOINT_CYCLE;
  const deadline =
    input.monotonicDeadline ?? createFhvRehearsalMonotonicDeadline(input.manifest.maxRuntimeMs);
  let pauseObserved = isFhvPauseAtCheckpointRequested(input.runRoot);

  const segment = await runWp03Segment({
    runRoot: input.runRoot,
    runId: input.runId,
    checkpointRunRoot: pauseObserved ? input.runRoot : undefined,
    evidenceSealMode: pauseObserved ? "partial" : "complete",
    maxCycles: pauseObserved ? checkpointCycle : undefined,
    deadline,
    onCycleComplete: (cyclesProcessed) => {
      writeFhvRehearsalCampaignProgress(input.runRoot, {
        schemaVersion: "fhv-rehearsal-campaign-progress/v1",
        runId: input.runId,
        cyclesProcessed,
        expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
        phase: "running",
        updatedAtUtc: new Date().toISOString(),
      });
      appendFhvRehearsalProgressSample(input.runRoot, cyclesProcessed);
    },
    shouldStopAfterCycle: (cyclesProcessed) => {
      if (isFhvPauseAtCheckpointRequested(input.runRoot)) {
        pauseObserved = true;
        return cyclesProcessed >= checkpointCycle;
      }
      return false;
    },
  });

  if (pauseObserved && (segment.stoppedEarly || segment.cycleCount >= checkpointCycle)) {
    return finalizePauseAtCheckpoint({
      runRoot: input.runRoot,
      runId: input.runId,
      partial: segment,
      checkpointCycle,
    });
  }

  writeFhvRehearsalCampaignProgress(input.runRoot, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: input.runId,
    cyclesProcessed: segment.cycleCount,
    expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    phase: "completed",
    updatedAtUtc: new Date().toISOString(),
  });
  writeFileAtomic(
    join(input.runRoot, "fhv-rehearsal-terminal.v1.json"),
    `${JSON.stringify({ classification: "REHEARSAL_OK", cyclesProcessed: segment.cycleCount }, null, 2)}\n`,
  );
  return {
    terminalState: "REPLAY_RUN_OK",
    cyclesProcessed: segment.cycleCount,
    evidenceDigest: segment.evidenceDigest,
    semanticReproDigest: segment.semanticReproDigest,
    classification: "REHEARSAL_OK",
  };
}

async function runResumeFromCheckpoint(input: {
  runRoot: string;
  runId: string;
  manifest: FhvRehearsalLaunchConfigV1;
  monotonicDeadline?: FhvRehearsalMonotonicDeadline;
}): Promise<FhvRehearsalCampaignResult> {
  const fixture = loadApprovedBenchmarkFixture();
  const checkpoint = readReplayCheckpoint(input.runRoot);
  if (!checkpoint) {
    throw new FhvRehearsalCampaignError("FHV_REHEARSAL_CHECKPOINT_MISSING", "Checkpoint missing.");
  }
  const restored = restoreCanvasFromCheckpoint(input.runRoot, checkpoint);
  if (!restored) {
    throw new FhvRehearsalCampaignError(
      "FHV_REHEARSAL_CANVAS_RESTORE_FAILED",
      "Canvas restore failed.",
    );
  }
  const deadline =
    input.monotonicDeadline ?? createFhvRehearsalMonotonicDeadline(input.manifest.maxRuntimeMs);
  const resumeFromCycle = checkpoint.safeResumeThroughCycleIndex + 1;
  const prefixBars = fixture.bars.slice(0, barsThroughCycleCount(resumeFromCycle));
  const resumed = await runWp03Segment({
    runRoot: input.runRoot,
    runId: input.runId,
    resumeCycleStartIndex: resumeFromCycle,
    initialCanvasState: restored,
    initialBars1mPrefix: prefixBars,
    evidenceSealMode: "complete",
    evidenceDir: join(input.runRoot, "streaming-evidence-resume"),
    deadline,
    onCycleComplete: (cyclesProcessed) => {
      writeFhvRehearsalCampaignProgress(input.runRoot, {
        schemaVersion: "fhv-rehearsal-campaign-progress/v1",
        runId: input.runId,
        cyclesProcessed,
        expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
        phase: "running",
        updatedAtUtc: new Date().toISOString(),
      });
      appendFhvRehearsalProgressSample(input.runRoot, cyclesProcessed);
    },
  });
  if (getFullHistoryRescanCount() !== 0) {
    throw new FhvRehearsalCampaignError(
      "FHV_REHEARSAL_RESUME_FULL_HISTORY_RESCAN",
      "Resume triggered full-history rescan.",
    );
  }
  consumeFhvCampaignControlMarker(input.runRoot, "RESUME_FROM_CHECKPOINT");
  writeFhvRehearsalCampaignProgress(input.runRoot, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: input.runId,
    cyclesProcessed: resumed.cycleCount,
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
    cyclesProcessed: resumed.cycleCount,
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
  /** Hermetic tests may inject a monotonic deadline override. */
  monotonicDeadline?: FhvRehearsalMonotonicDeadline;
  /** Hermetic tests may lower the checkpoint boundary (default 40). */
  checkpointCycle?: number;
}): Promise<FhvRehearsalCampaignResult> {
  const manifest = assertFhvCampaignRuntimeIdentity(input);
  mkdirSync(resolveFhvRehearsalEvidenceDir(input.runRoot), { recursive: true });

  if (isFhvResumeFromCheckpointRequested(input.runRoot)) {
    return runResumeFromCheckpoint({
      runRoot: input.runRoot,
      runId: input.runId,
      manifest,
      monotonicDeadline: input.monotonicDeadline,
    });
  }

  const existingProgress = readFhvRehearsalCampaignProgress(input.runRoot);
  const existingCheckpoint = readReplayCheckpoint(input.runRoot);
  if (
    existingProgress?.phase === "paused_at_checkpoint" &&
    existingCheckpoint &&
    !isFhvResumeFromCheckpointRequested(input.runRoot)
  ) {
    return {
      terminalState: "REHEARSAL_PAUSED",
      cyclesProcessed: existingProgress.cyclesProcessed,
      evidenceDigest: "",
      semanticReproDigest: "",
      classification: "REHEARSAL_PAUSED",
    };
  }

  try {
    return await runCampaignWithPauseSupport({
      runRoot: input.runRoot,
      runId: input.runId,
      manifest,
      monotonicDeadline: input.monotonicDeadline,
      checkpointCycle: input.checkpointCycle,
    });
  } catch (error) {
    if (
      error instanceof FhvRehearsalCampaignError &&
      error.code === "REHEARSAL_DEADLINE_EXCEEDED"
    ) {
      writeFhvRehearsalCampaignProgress(input.runRoot, {
        schemaVersion: "fhv-rehearsal-campaign-progress/v1",
        runId: input.runId,
        cyclesProcessed: readFhvRehearsalCampaignProgress(input.runRoot)?.cyclesProcessed ?? 0,
        expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
        phase: "timeout",
        updatedAtUtc: new Date().toISOString(),
      });
      writeFileAtomic(
        join(input.runRoot, "fhv-rehearsal-terminal.v1.json"),
        `${JSON.stringify({ classification: "REHEARSAL_TIMEOUT" }, null, 2)}\n`,
      );
      return {
        terminalState: "REHEARSAL_TIMEOUT",
        cyclesProcessed: readFhvRehearsalCampaignProgress(input.runRoot)?.cyclesProcessed ?? 0,
        evidenceDigest: "",
        semanticReproDigest: "",
        classification: "REHEARSAL_TIMEOUT",
      };
    }
    throw error;
  }
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
  });
  return {
    uninterruptedDigest: uninterrupted.semanticReproDigest,
    resumedDigest: resumed.semanticReproDigest,
    match: uninterrupted.semanticReproDigest === resumed.semanticReproDigest,
  };
}

export function writeFhvCampaignControlPauseRequest(runRoot: string): void {
  mkdirSync(join(runRoot, "control"), { recursive: true });
  writeFileAtomic(
    join(runRoot, "control", "pause_at_checkpoint-request.v1.json"),
    `${JSON.stringify({ action: "PAUSE_AT_CHECKPOINT" }, null, 2)}\n`,
  );
}

export function writeFhvCampaignControlResumeRequest(runRoot: string): void {
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

export function appendFhvRehearsalProgressSample(runRoot: string, cyclesProcessed: number): void {
  const path = join(runRoot, "fhv-rehearsal-progress-samples.v1.jsonl");
  appendFileSync(
    path,
    `${JSON.stringify({ cyclesProcessed, recordedAtUtc: new Date().toISOString() })}\n`,
  );
}

export function readFhvRehearsalProgressSamples(runRoot: string): readonly number[] {
  const path = join(runRoot, "fhv-rehearsal-progress-samples.v1.jsonl");
  if (!existsSync(path)) {
    const progress = readFhvRehearsalCampaignProgress(runRoot);
    return progress ? [progress.cyclesProcessed] : [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { cyclesProcessed: number }).cyclesProcessed);
}
