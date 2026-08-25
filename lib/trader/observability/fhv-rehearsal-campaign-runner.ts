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
import {
  getFullHistoryRescanCount,
  resetFullHistoryRescanCount,
} from "@/lib/trader/backtest/replay-runtime-metrics";
import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { maybeHoldFhvCrossProcessPauseTestBarrier } from "@/lib/trader/observability/fhv-rehearsal-pause-test-barrier";
import { createStreamingEvidenceSink } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-sink";
import {
  readReplayCheckpoint,
  readReplayRunChainManifest,
  REPLAY_CHECKPOINT_SCHEMA_VERSION,
  resolveEvidenceFrontier,
  buildReplayRunChainManifest,
  writeReplayRunChainManifest,
  type ReplayRunTerminalState,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";
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
import { validateFhvCanonicalRunChainCompletion } from "@/lib/trader/observability/fhv-canonical-run-chain";
import { assertFhvCampaignRuntimeIdentity } from "@/lib/trader/observability/fhv-campaign-runtime-identity";
import type { FhvRehearsalLaunchConfigV1 } from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { readFhvRehearsalManifest } from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import { writeFhvOperatorStatusAtomic } from "@/lib/trader/observability/fhv-status-writer";
import {
  consumeFhvCampaignControlRequest,
  writeFhvCampaignControlRequest,
} from "@/lib/trader/observability/fhv-campaign-control-files";
import {
  readFhvCampaignControlRequest,
  FhvControlRequestError,
  resolveFhvControlRequestDisposition,
  type FhvControlRequestDisposition,
} from "@/lib/trader/observability/fhv-control-request-validator";
import {
  assertFhvRehearsalResumeIdentity,
  FhvResumeIdentityError,
} from "@/lib/trader/observability/fhv-resume-identity-validator";
import {
  assertIdentityFrontierMonotonicWrite,
  createFhvCampaignIdentityContext,
  runWithScopedRandomUuidFactory,
  type FhvCampaignIdentityContext,
  type FhvCampaignIdentityFrontierState,
} from "@/lib/trader/observability/fhv-campaign-identity";
import {
  assertFhvRehearsalEconomicFrontierQuiescent,
  FhvRehearsalEconomicFrontierError,
  measureFhvRehearsalEconomicState,
  validateFhvRehearsalEconomicFrontierBinding,
  type FhvRehearsalEconomicFrontierV1,
} from "@/lib/trader/observability/fhv-rehearsal-economic-frontier";
import { writeFhvResumeRuntimeProof } from "@/lib/trader/observability/fhv-resume-runtime-proof";
import {
  ensureFhvT4CampaignRuntimeStarted,
  finalizeFhvT4CampaignRuntimeProof,
  readFhvT4CampaignRuntimeStart,
  resolveFhvT4SharedMonotonicDeadline,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import { readFhvT4HostMonotonicSample } from "@/lib/trader/observability/fhv-t4-host-monotonic-clock";

import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";
import {
  isFhvT4DeterministicPauseManifest,
  shouldFhvT4PauseAtCycle,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
export { FHV_REHEARSAL_CHECKPOINT_CYCLE };
export const FHV_REHEARSAL_LATE_PAUSE_MIN_CYCLES = 45;
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

export type FhvT4HostMonotonicDeadline = Readonly<{
  kind: "t4-host-monotonic";
  hostBootId: string;
  startedMonotonicNs: string;
  deadlineMonotonicNs: string;
  maximumRuntimeMs: number;
  releaseSha: string;
  runId: string;
  organizationId: string;
  fixtureId: "HTR_WP03_BENCHMARK";
  repoRoot: string;
}>;

export type FhvRehearsalWallClockDeadline = Readonly<{
  kind?: "wall-clock";
  deadlineMs: number;
}>;

export type FhvRehearsalMonotonicDeadline =
  | FhvRehearsalWallClockDeadline
  | FhvT4HostMonotonicDeadline;

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
): FhvRehearsalWallClockDeadline {
  return { kind: "wall-clock", deadlineMs: startedAtMs + maxRuntimeMs };
}

function resolveCampaignRepoRoot(): string {
  return process.env.FHV_REPO_ROOT?.trim() || process.cwd();
}

function buildT4HostMonotonicDeadlineFromStart(input: {
  runRoot: string;
  start: NonNullable<ReturnType<typeof readFhvT4CampaignRuntimeStart>>;
  repoRoot: string;
  maxRuntimeMs: number;
}): FhvT4HostMonotonicDeadline {
  const resolved = resolveFhvT4SharedMonotonicDeadline(
    input.runRoot,
    input.repoRoot,
    input.maxRuntimeMs,
  );
  if (
    resolved.hostBootId !== input.start.hostBootId ||
    resolved.startedMonotonicNs.toString() !== input.start.startedMonotonicNs
  ) {
    throw new FhvRehearsalCampaignError(
      "FHV_T4_CAMPAIGN_RUNTIME_START_IDENTITY_MISMATCH",
      "Shared monotonic deadline diverged from start marker.",
    );
  }
  return {
    kind: "t4-host-monotonic",
    hostBootId: input.start.hostBootId,
    startedMonotonicNs: input.start.startedMonotonicNs,
    deadlineMonotonicNs: resolved.deadlineMonotonicNs.toString(),
    maximumRuntimeMs: input.maxRuntimeMs,
    releaseSha: input.start.targetSha,
    runId: input.start.runId,
    organizationId: input.start.organizationId,
    fixtureId: "HTR_WP03_BENCHMARK",
    repoRoot: input.repoRoot,
  };
}

/** Resolves the immutable T4A host-monotonic deadline for initial and resumed paths. */
export function prepareT4DeterministicRuntimeDeadline(input: {
  runRoot: string;
  manifest: FhvRehearsalLaunchConfigV1;
  runId: string;
  organizationId: string;
  targetSha: string;
  repoRoot?: string;
  monotonicDeadline?: FhvRehearsalMonotonicDeadline;
}): FhvRehearsalMonotonicDeadline {
  const repoRoot = input.repoRoot ?? resolveCampaignRepoRoot();
  if (!isFhvT4DeterministicPauseManifest(input.manifest)) {
    return (
      input.monotonicDeadline ?? createFhvRehearsalMonotonicDeadline(input.manifest.maxRuntimeMs)
    );
  }
  if (input.monotonicDeadline && input.monotonicDeadline.kind === "t4-host-monotonic") {
    return input.monotonicDeadline;
  }

  const existing = readFhvT4CampaignRuntimeStart(input.runRoot);
  const resuming = isFhvResumeFromCheckpointRequested(input.runRoot);
  if (resuming) {
    if (!existing) {
      throw new FhvRehearsalCampaignError(
        "FHV_T4_CAMPAIGN_RUNTIME_START_MISSING_ON_RESUME",
        "Resumed T4A campaign requires the original host-monotonic start marker.",
      );
    }
    const { contentDigest, ...withoutDigest } = existing;
    if (computePayloadDigest(withoutDigest) !== contentDigest) {
      throw new FhvRehearsalCampaignError(
        "FHV_T4_CAMPAIGN_RUNTIME_START_DIGEST_MISMATCH",
        "Campaign runtime start digest mismatch on resume.",
      );
    }
    if (
      existing.runId !== input.runId ||
      existing.organizationId !== input.organizationId ||
      existing.targetSha !== input.targetSha
    ) {
      throw new FhvRehearsalCampaignError(
        "FHV_T4_CAMPAIGN_RUNTIME_START_IDENTITY_MISMATCH",
        "Campaign runtime start identity mismatch on resume.",
      );
    }
    return buildT4HostMonotonicDeadlineFromStart({
      runRoot: input.runRoot,
      start: existing,
      repoRoot,
      maxRuntimeMs: input.manifest.maxRuntimeMs,
    });
  }

  if (existing) {
    const { contentDigest, ...withoutDigest } = existing;
    if (computePayloadDigest(withoutDigest) !== contentDigest) {
      throw new FhvRehearsalCampaignError(
        "FHV_T4_CAMPAIGN_RUNTIME_START_DIGEST_MISMATCH",
        "Campaign runtime start digest mismatch.",
      );
    }
    return buildT4HostMonotonicDeadlineFromStart({
      runRoot: input.runRoot,
      start: existing,
      repoRoot,
      maxRuntimeMs: input.manifest.maxRuntimeMs,
    });
  }

  const sample = readFhvT4HostMonotonicSample(repoRoot);
  const start = ensureFhvT4CampaignRuntimeStarted(input.runRoot, {
    runId: input.runId,
    organizationId: input.organizationId,
    targetSha: input.targetSha,
    fixtureId: "HTR_WP03_BENCHMARK",
    hostBootId: sample.bootId,
    startedMonotonicNs: sample.monotonicNs,
    repoRoot,
  });
  return buildT4HostMonotonicDeadlineFromStart({
    runRoot: input.runRoot,
    start,
    repoRoot,
    maxRuntimeMs: input.manifest.maxRuntimeMs,
  });
}

function finalizeT4DeterministicRuntimeIfNeeded(
  runRoot: string,
  manifest: FhvRehearsalLaunchConfigV1,
  classification: FhvRehearsalCampaignResult["classification"],
  repoRoot?: string,
): void {
  if (isFhvT4DeterministicPauseManifest(manifest) && classification === "REHEARSAL_OK") {
    finalizeFhvT4CampaignRuntimeProof(runRoot, {
      repoRoot: repoRoot ?? resolveCampaignRepoRoot(),
    });
  }
}

export function assertFhvRehearsalWithinDeadline(deadline: FhvRehearsalMonotonicDeadline): void {
  if (deadline.kind === "t4-host-monotonic") {
    const sample = readFhvT4HostMonotonicSample(deadline.repoRoot);
    if (sample.bootId !== deadline.hostBootId) {
      throw new FhvRehearsalCampaignError(
        "FHV_T4_HOST_MONOTONIC_BOOT_ID_CHANGED",
        "Host boot ID changed; T4A campaign budget is invalid across reboot.",
      );
    }
    if (BigInt(sample.monotonicNs) > BigInt(deadline.deadlineMonotonicNs)) {
      throw new FhvRehearsalCampaignError(
        "REHEARSAL_DEADLINE_EXCEEDED",
        "Campaign exceeded the configured host-monotonic rehearsal runtime deadline.",
      );
    }
    return;
  }
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

function controlRequestContext(runRoot: string): {
  runId: string;
  organizationId: string;
} | null {
  const progress = readFhvRehearsalCampaignProgress(runRoot);
  if (!progress) {
    return null;
  }
  const manifestPath = join(runRoot, "fhv-rehearsal-manifest.v1.json");
  if (!existsSync(manifestPath)) {
    return { runId: progress.runId, organizationId: "" };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    runId?: string;
    organizationId?: string;
  };
  return {
    runId: manifest.runId ?? progress.runId,
    organizationId: manifest.organizationId ?? "",
  };
}

function isPendingControlRequest(input: {
  runRoot: string;
  action: "PAUSE_AT_CHECKPOINT" | "RESUME_FROM_CHECKPOINT";
  runId: string;
  organizationId: string;
}): boolean {
  try {
    return readFhvCampaignControlRequest(input) !== null;
  } catch (error) {
    if (error instanceof FhvControlRequestError && error.code === "CONTROL_REQUEST_CONSUMED") {
      return false;
    }
    throw error;
  }
}

export function isFhvPauseAtCheckpointRequested(runRoot: string): boolean {
  const context = controlRequestContext(runRoot);
  if (!context?.organizationId) {
    const path = join(runRoot, "control", "pause_at_checkpoint-request.v1.json");
    return existsSync(path) && readControlFileContent(path).length > 0;
  }
  return isPendingControlRequest({
    runRoot,
    action: "PAUSE_AT_CHECKPOINT",
    runId: context.runId,
    organizationId: context.organizationId,
  });
}

export function isFhvResumeFromCheckpointRequested(runRoot: string): boolean {
  const context = controlRequestContext(runRoot);
  if (!context?.organizationId) {
    const path = join(runRoot, "control", "resume_from_checkpoint-request.v1.json");
    return existsSync(path) && readControlFileContent(path).length > 0;
  }
  return isPendingControlRequest({
    runRoot,
    action: "RESUME_FROM_CHECKPOINT",
    runId: context.runId,
    organizationId: context.organizationId,
  });
}

export function consumeFhvCampaignControlMarker(
  runRoot: string,
  action: string,
  identity?: { runId: string; organizationId: string },
): void {
  const operatorAction =
    action === "PAUSE_AT_CHECKPOINT" || action === "RESUME_FROM_CHECKPOINT"
      ? action
      : (action.toUpperCase() as "PAUSE_AT_CHECKPOINT" | "RESUME_FROM_CHECKPOINT");
  const context = identity ?? controlRequestContext(runRoot);
  if (!context?.organizationId) {
    const path = join(runRoot, "control", `${action.toLowerCase()}-request.v1.json`);
    if (existsSync(path)) {
      writeFileAtomic(path, "");
    }
    return;
  }
  const request = readFhvCampaignControlRequest({
    runRoot,
    action: operatorAction,
    runId: context.runId,
    organizationId: context.organizationId,
  });
  if (request) {
    consumeFhvCampaignControlRequest(runRoot, request);
  }
}

async function runWp03Segment(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  maxCycles?: number;
  checkpointRunRoot?: string;
  resumeCycleStartIndex?: number;
  initialCanvasState?: Awaited<ReturnType<typeof runBacktest>>["canvasState"];
  initialBars1mPrefix?: readonly Bar[];
  evidenceSealMode?: "complete" | "partial";
  evidenceDir?: string;
  deadline?: FhvRehearsalMonotonicDeadline;
  onCycleComplete?: (cyclesProcessed: number) => void;
  shouldPauseAfterCycle?: (cyclesProcessed: number) => boolean;
  identityContext: FhvCampaignIdentityContext;
}): Promise<{
  cycleCount: number;
  evidenceDigest: string;
  semanticReproDigest: string;
  canvasState: Awaited<ReturnType<typeof runBacktest>>["canvasState"];
  stoppedEarly: boolean;
  economicSnapshot: FhvRehearsalEconomicFrontierV1;
}> {
  const identityContext = input.identityContext;
  const newId = identityContext.createNewIdFactory();
  const randomUuid = identityContext.createRandomUuidFactory();
  return runWithScopedRandomUuidFactory(randomUuid, async () => {
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
    let economicSnapshot: FhvRehearsalEconomicFrontierV1;
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
        newId,
        substrateMode: "incremental",
        retentionMode: "STREAM_ONLY",
        // Allow waitForFhvRehearsalCycles + pause-request writers to interleave.
        enableCooperativeYield: true,
        evidenceSink,
        maxCycles: input.maxCycles,
        checkpointRunRoot: input.checkpointRunRoot,
        resumeCycleStartIndex: input.resumeCycleStartIndex,
        initialCanvasState: input.initialCanvasState,
        initialBars1mPrefix: input.initialBars1mPrefix,
        evidenceSealMode: input.evidenceSealMode ?? "complete",
        onCycleBoundary: ({ cycleCount }) => {
          if (input.deadline) {
            assertFhvRehearsalWithinDeadline(input.deadline);
          }
          input.onCycleComplete?.(cycleCount);
          if (input.shouldPauseAfterCycle?.(cycleCount)) {
            stoppedEarly = true;
            return { action: "stop", evidenceSeal: "partial" as const };
          }
          return "continue";
        },
      });
      const safeResumeThroughCycleIndex =
        input.resumeCycleStartIndex !== undefined
          ? input.resumeCycleStartIndex - 1
          : backtest.cycleCount - (stoppedEarly ? 1 : 0);
      economicSnapshot = await measureFhvRehearsalEconomicState({
        context,
        orderRepository: session.orderRepository,
        organizationId: input.organizationId,
        runId: input.runId,
        safeResumeThroughCycleIndex,
        window,
        runtimeFlags: {
          htrAccountingActive: backtest.accountingState !== undefined,
          historicalExecutionActive: false,
          portfolioAccountingActive: false,
          wp21RuntimeActive: backtest.wp21CheckpointState !== undefined,
        },
      });
      return {
        cycleCount: backtest.cycleCount,
        evidenceDigest: backtest.evidenceDigest,
        semanticReproDigest: computeReplayReproContentDigest(backtest.exportDocument),
        canvasState: backtest.canvasState,
        stoppedEarly,
        economicSnapshot,
      };
    } finally {
      session.cleanup();
    }
  });
}

function writePausedCheckpoint(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  partial: Awaited<ReturnType<typeof runWp03Segment>>;
  actualPauseCycle: number;
  identityFrontier: FhvCampaignIdentityFrontierState;
}): void {
  const fixture = loadApprovedBenchmarkFixture();
  const evidenceDir = resolveFhvRehearsalEvidenceDir(input.runRoot);
  const evidence = resolveEvidenceFrontier(evidenceDir);
  const safeResumeThroughCycleIndex = input.actualPauseCycle - 1;

  try {
    validateFhvRehearsalEconomicFrontierBinding({
      frontier: input.partial.economicSnapshot,
      runId: input.runId,
      organizationId: input.organizationId,
      safeResumeThroughCycleIndex,
    });
    assertFhvRehearsalEconomicFrontierQuiescent(input.partial.economicSnapshot);
  } catch (error) {
    if (error instanceof FhvRehearsalEconomicFrontierError) {
      throw new FhvRehearsalCampaignError(error.code, error.message);
    }
    throw error;
  }

  assertIdentityFrontierMonotonicWrite({
    runRoot: input.runRoot,
    frontier: input.identityFrontier,
  });

  if (input.partial.cycleCount !== input.actualPauseCycle) {
    throw new FhvRehearsalCampaignError(
      "FHV_PAUSE_CYCLE_MISMATCH",
      `Pause cycle ${input.actualPauseCycle} does not match segment cycle count ${input.partial.cycleCount}.`,
    );
  }
  if (evidence.evidenceDurableThroughCycleIndex !== safeResumeThroughCycleIndex) {
    throw new FhvRehearsalCampaignError(
      "FHV_EVIDENCE_FRONTIER_MISMATCH",
      `Evidence durable index ${evidence.evidenceDurableThroughCycleIndex} != ${safeResumeThroughCycleIndex}.`,
    );
  }
  if (evidence.evidenceTerminalState !== "STREAMING_EVIDENCE_SEALED_PARTIAL") {
    throw new FhvRehearsalCampaignError(
      "FHV_EVIDENCE_TERMINAL_MISMATCH",
      `Expected partial evidence seal, got ${evidence.evidenceTerminalState}.`,
    );
  }

  writeCanvasSidecarBeforeCheckpoint({
    runRootDir: input.runRoot,
    canvasState: input.partial.canvasState,
    checkpoint: {
      schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
      backtestRunId: input.runId,
      datasetContentDigest: computeBarSetDigest(fixture.bars),
      datasetId: "fhv-rehearsal-wp03",
      codeSha: input.targetSha,
      activePhase: "validation",
      dbDurableThroughPhase: "none",
      evidenceDurableThroughCycleIndex: evidence.evidenceDurableThroughCycleIndex,
      safeResumeThroughCycleIndex,
      evidenceRunDir: evidenceDir,
      evidenceChainDigest: evidence.evidenceChainDigest,
      evidenceTerminalState: evidence.evidenceTerminalState,
      dbConnectionMode: "harness",
      replayTerminalState: "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
      fixtureSha256: HTR_WP03_BENCHMARK_FIXTURE_SHA256,
      campaignIdentityFrontierState: input.identityFrontier,
      rehearsalEconomicFrontierState: input.partial.economicSnapshot,
    },
  });
}

async function finalizePauseAtCheckpoint(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  partial: Awaited<ReturnType<typeof runWp03Segment>>;
  actualPauseCycle: number;
  identityContext: FhvCampaignIdentityContext;
}): Promise<FhvRehearsalCampaignResult> {
  const identityFrontier = input.identityContext.captureFrontier(input.actualPauseCycle - 1);
  writePausedCheckpoint({ ...input, identityFrontier });
  const partialDir = resolveFhvRehearsalEvidenceDir(input.runRoot);
  const partialReconstruction = reconstructStreamingEvidence(partialDir);
  writeReplayRunChainManifest(
    input.runRoot,
    buildReplayRunChainManifest({
      backtestRunId: input.runId,
      activePhase: "validation",
      segments: [
        {
          runDir: partialDir,
          chainDigest: partialReconstruction.chainDigest ?? "",
          role: "authoritative",
          terminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
          sealedThroughCycleIndex: partialReconstruction.sealedThroughCycleIndex,
        },
      ],
    }),
  );
  writeFhvRehearsalCampaignProgress(input.runRoot, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: input.runId,
    cyclesProcessed: input.actualPauseCycle,
    expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    phase: "paused_at_checkpoint",
    updatedAtUtc: new Date().toISOString(),
  });
  const manifest = readFhvRehearsalManifest(input.runRoot);
  const checkpoint = readReplayCheckpoint(input.runRoot);
  writeFhvOperatorStatusAtomic(
    input.runRoot,
    buildFhvOperatorStatusV1({
      runId: input.runId,
      organizationId: input.organizationId,
      phase: "paused_at_checkpoint",
      codeSha: input.targetSha,
      artifactDigest: input.partial.evidenceDigest,
      datasetSeal: checkpoint?.datasetContentDigest ?? input.partial.evidenceDigest,
      datasetDigest: checkpoint?.datasetContentDigest ?? input.partial.evidenceDigest,
      configurationDigest: checkpoint?.codeSha ?? input.targetSha,
      alertPolicyDigest: manifest.alertPolicyDigest,
      terminalState: "REHEARSAL_PAUSED",
      checkpoint,
    }),
  );
  consumeFhvCampaignControlMarker(input.runRoot, "PAUSE_AT_CHECKPOINT");
  writeFileAtomic(
    join(input.runRoot, "fhv-rehearsal-terminal.v1.json"),
    `${JSON.stringify({ classification: "REHEARSAL_PAUSED", cyclesProcessed: input.actualPauseCycle, actualPauseCycle: input.actualPauseCycle }, null, 2)}\n`,
  );
  return {
    terminalState: "REHEARSAL_PAUSED",
    cyclesProcessed: input.actualPauseCycle,
    evidenceDigest: input.partial.evidenceDigest,
    semanticReproDigest: input.partial.semanticReproDigest,
    classification: "REHEARSAL_PAUSED",
  };
}

async function runCampaignWithPauseSupport(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  manifest: FhvRehearsalLaunchConfigV1;
  targetSha: string;
  monotonicDeadline?: FhvRehearsalMonotonicDeadline;
  /** Parity-harness only: records the pause request on the observed cycle boundary. */
  parityPauseAfterCycles?: number;
}): Promise<FhvRehearsalCampaignResult> {
  const deadline = prepareT4DeterministicRuntimeDeadline({
    runRoot: input.runRoot,
    manifest: input.manifest,
    runId: input.runId,
    organizationId: input.organizationId,
    targetSha: input.targetSha,
    monotonicDeadline: input.monotonicDeadline,
  });

  const identityContext = createFhvCampaignIdentityContext({
    runId: input.runId,
    organizationId: input.organizationId,
  });
  const segment = await runWp03Segment({
    runRoot: input.runRoot,
    runId: input.runId,
    organizationId: input.organizationId,
    identityContext,
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
      if (cyclesProcessed === input.parityPauseAfterCycles) {
        writeFhvCampaignControlPauseRequest(input.runRoot, input.runId, input.organizationId);
      }
      maybeHoldFhvCrossProcessPauseTestBarrier({
        runRoot: input.runRoot,
        cyclesProcessed,
      });
    },
    shouldPauseAfterCycle: (cyclesProcessed) =>
      shouldFhvT4PauseAtCycle({
        runRoot: input.runRoot,
        manifest: input.manifest,
        cyclesProcessed,
        pauseRequested: isFhvPauseAtCheckpointRequested(input.runRoot),
      }),
  });

  if (segment.stoppedEarly) {
    const actualPauseCycle = segment.cycleCount;
    return finalizePauseAtCheckpoint({
      runRoot: input.runRoot,
      runId: input.runId,
      organizationId: input.organizationId,
      targetSha: input.manifest.targetSha,
      partial: segment,
      actualPauseCycle,
      identityContext,
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
  finalizeT4DeterministicRuntimeIfNeeded(input.runRoot, input.manifest, "REHEARSAL_OK");
  return {
    terminalState: "REPLAY_RUN_OK",
    cyclesProcessed: segment.cycleCount,
    evidenceDigest: segment.evidenceDigest,
    semanticReproDigest: segment.semanticReproDigest,
    classification: "REHEARSAL_OK",
  };
}

async function assertFreshResumeRepositoryQuiescent(input: {
  runId: string;
  organizationId: string;
  safeResumeThroughCycleIndex: number;
}): Promise<void> {
  const fixture = loadApprovedBenchmarkFixture();
  const { session, context } = await seedBenchmarkSession();
  try {
    const window = {
      start: new Date(fixture.bars[0]!.barOpenTime),
      end: new Date(fixture.bars.at(-1)!.barCloseTime),
    };
    const frontier = await measureFhvRehearsalEconomicState({
      context,
      orderRepository: session.orderRepository,
      organizationId: input.organizationId,
      runId: input.runId,
      safeResumeThroughCycleIndex: input.safeResumeThroughCycleIndex,
      window,
      runtimeFlags: {
        htrAccountingActive: false,
        historicalExecutionActive: false,
        portfolioAccountingActive: false,
        wp21RuntimeActive: false,
      },
    });
    validateFhvRehearsalEconomicFrontierBinding({
      frontier,
      runId: input.runId,
      organizationId: input.organizationId,
      safeResumeThroughCycleIndex: input.safeResumeThroughCycleIndex,
    });
    assertFhvRehearsalEconomicFrontierQuiescent(frontier);
  } catch (error) {
    if (error instanceof FhvRehearsalEconomicFrontierError) {
      throw new FhvRehearsalCampaignError(error.code, error.message);
    }
    throw error;
  } finally {
    session.cleanup();
  }
}

async function runResumeFromCheckpoint(input: {
  runRoot: string;
  runId: string;
  targetSha: string;
  manifest: FhvRehearsalLaunchConfigV1;
  monotonicDeadline?: FhvRehearsalMonotonicDeadline;
}): Promise<FhvRehearsalCampaignResult> {
  const organizationId = input.manifest.organizationId;
  let checkpoint;
  try {
    checkpoint = assertFhvRehearsalResumeIdentity({
      runRoot: input.runRoot,
      manifest: input.manifest,
      targetSha: input.targetSha,
    });
  } catch (error) {
    if (error instanceof FhvResumeIdentityError) {
      throw new FhvRehearsalCampaignError(error.code, error.message);
    }
    throw error;
  }

  const restored = restoreCanvasFromCheckpoint(input.runRoot, checkpoint);
  if (!restored) {
    throw new FhvRehearsalCampaignError(
      "FHV_REHEARSAL_CANVAS_RESTORE_FAILED",
      "Canvas restore failed.",
    );
  }

  const pausedProgress = readFhvRehearsalCampaignProgress(input.runRoot);
  const resumeFromCycle = checkpoint.safeResumeThroughCycleIndex + 1;
  if (checkpoint.safeResumeThroughCycleIndex !== checkpoint.evidenceDurableThroughCycleIndex) {
    throw new FhvRehearsalCampaignError(
      "FHV_RESUME_FRONTIER_MISMATCH",
      "Safe resume frontier does not match evidence durable frontier.",
    );
  }
  if (pausedProgress && pausedProgress.cyclesProcessed !== resumeFromCycle) {
    throw new FhvRehearsalCampaignError(
      "FHV_RESUME_PROGRESS_FRONTIER_MISMATCH",
      `Progress cyclesProcessed ${pausedProgress.cyclesProcessed} != resumeFromCycle ${resumeFromCycle}.`,
    );
  }

  const prefixBars = loadApprovedBenchmarkFixture().bars.slice(
    0,
    barsThroughCycleCount(resumeFromCycle),
  );

  await assertFreshResumeRepositoryQuiescent({
    runId: input.runId,
    organizationId,
    safeResumeThroughCycleIndex: checkpoint.safeResumeThroughCycleIndex,
  });

  const identityContext = createFhvCampaignIdentityContext({
    runId: input.runId,
    organizationId,
    restoredFrontier: checkpoint.campaignIdentityFrontierState,
  });
  const deadline = prepareT4DeterministicRuntimeDeadline({
    runRoot: input.runRoot,
    manifest: input.manifest,
    runId: input.runId,
    organizationId,
    targetSha: input.targetSha,
    monotonicDeadline: input.monotonicDeadline,
  });
  let lastProgress = pausedProgress?.cyclesProcessed ?? 0;
  resetFullHistoryRescanCount();
  const rescanBefore = getFullHistoryRescanCount();
  let firstExecutedCycleIndex: number | null = null;
  let lastExecutedCycleIndex: number | null = null;

  const resumed = await runWp03Segment({
    runRoot: input.runRoot,
    runId: input.runId,
    organizationId,
    identityContext,
    resumeCycleStartIndex: resumeFromCycle,
    initialCanvasState: restored,
    initialBars1mPrefix: prefixBars,
    evidenceSealMode: "complete",
    evidenceDir: join(input.runRoot, "streaming-evidence-resume"),
    deadline,
    onCycleComplete: (cyclesProcessed) => {
      if (cyclesProcessed <= lastProgress) {
        throw new FhvRehearsalCampaignError(
          "FHV_RESUME_PROGRESS_REGRESSION",
          `Progress regressed from ${lastProgress} to ${cyclesProcessed}.`,
        );
      }
      if (firstExecutedCycleIndex === null) {
        firstExecutedCycleIndex = cyclesProcessed;
      }
      lastExecutedCycleIndex = cyclesProcessed;
      lastProgress = cyclesProcessed;
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

  const rescanAfter = getFullHistoryRescanCount();
  if (rescanAfter !== rescanBefore) {
    throw new FhvRehearsalCampaignError(
      "FHV_REHEARSAL_RESUME_FULL_HISTORY_RESCAN",
      "Resume triggered full-history rescan.",
    );
  }

  writeFhvResumeRuntimeProof(input.runRoot, {
    schemaVersion: "fhv-resume-runtime-proof/v1",
    runId: input.runId,
    organizationId,
    processPid: process.pid,
    resumeCycleStartIndex: resumeFromCycle,
    firstExecutedCycleIndex: resumeFromCycle,
    lastExecutedCycleIndex: lastExecutedCycleIndex ?? resumed.cycleCount,
    fullHistoryRescanCountBefore: rescanBefore,
    fullHistoryRescanCountAfter: rescanAfter,
    fullHistoryRescanDelta: rescanAfter - rescanBefore,
  });

  const partialDir = resolveFhvRehearsalEvidenceDir(input.runRoot);
  const continuationDir = join(input.runRoot, "streaming-evidence-resume");
  const partialReconstruction = reconstructStreamingEvidence(partialDir);
  const continuationReconstruction = reconstructStreamingEvidence(continuationDir);
  writeReplayRunChainManifest(
    input.runRoot,
    buildReplayRunChainManifest({
      backtestRunId: input.runId,
      activePhase: "validation",
      segments: [
        {
          runDir: partialDir,
          chainDigest: partialReconstruction.chainDigest ?? "",
          role: "authoritative",
          terminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
          sealedThroughCycleIndex: partialReconstruction.sealedThroughCycleIndex,
        },
        {
          runDir: continuationDir,
          chainDigest: continuationReconstruction.chainDigest ?? "",
          role: "authoritative",
          continuesFromRunDir: partialDir,
          continuesFromChainDigest: partialReconstruction.chainDigest ?? undefined,
          terminalState: "STREAMING_EVIDENCE_OK",
          sealedThroughCycleIndex: continuationReconstruction.sealedThroughCycleIndex,
        },
      ],
    }),
  );
  consumeFhvCampaignControlMarker(input.runRoot, "RESUME_FROM_CHECKPOINT");
  writeFhvRehearsalCampaignProgress(input.runRoot, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: input.runId,
    cyclesProcessed: resumed.cycleCount,
    expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    phase: "completed",
    updatedAtUtc: new Date().toISOString(),
  });
  const completedManifest = readFhvRehearsalManifest(input.runRoot);
  const completedCheckpoint = readReplayCheckpoint(input.runRoot);
  writeFhvOperatorStatusAtomic(
    input.runRoot,
    buildFhvOperatorStatusV1({
      runId: input.runId,
      organizationId,
      phase: "completed",
      codeSha: input.targetSha,
      artifactDigest: resumed.evidenceDigest,
      datasetSeal: completedCheckpoint?.datasetContentDigest ?? resumed.evidenceDigest,
      datasetDigest: completedCheckpoint?.datasetContentDigest ?? resumed.evidenceDigest,
      configurationDigest: completedCheckpoint?.codeSha ?? input.targetSha,
      alertPolicyDigest: completedManifest.alertPolicyDigest,
      terminalState: "REHEARSAL_OK",
      checkpoint: completedCheckpoint,
    }),
  );
  writeFileAtomic(
    join(input.runRoot, "fhv-rehearsal-terminal.v1.json"),
    `${JSON.stringify({ classification: "REHEARSAL_OK", ...resumed }, null, 2)}\n`,
  );
  finalizeT4DeterministicRuntimeIfNeeded(input.runRoot, input.manifest, "REHEARSAL_OK");
  return {
    terminalState: "REPLAY_RUN_OK",
    cyclesProcessed: resumed.cycleCount,
    evidenceDigest: resumed.evidenceDigest,
    semanticReproDigest: resumed.semanticReproDigest,
    classification: "REHEARSAL_OK",
  };
}

export function readFhvRehearsalTerminalClassification(runRoot: string): string | null {
  const path = join(runRoot, "fhv-rehearsal-terminal.v1.json");
  if (!existsSync(path)) {
    return null;
  }
  return (
    (JSON.parse(readFileSync(path, "utf8")) as { classification?: string }).classification ?? null
  );
}

export function readFhvRehearsalEvidenceTerminalState(runRoot: string): string | null {
  const evidenceDir = resolveFhvRehearsalEvidenceDir(runRoot);
  const reconstruction = reconstructStreamingEvidence(evidenceDir);
  return reconstruction.terminalState;
}

export function readFhvRehearsalActualPauseCycle(runRoot: string): number | null {
  const path = join(runRoot, "fhv-rehearsal-terminal.v1.json");
  if (!existsSync(path)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    actualPauseCycle?: number;
    cyclesProcessed?: number;
  };
  return parsed.actualPauseCycle ?? parsed.cyclesProcessed ?? null;
}

function writeFhvRehearsalTimeoutEvidence(input: {
  runRoot: string;
  runId: string;
  source: "initial_replay" | "resumed_replay";
  consumeResumeMarker: boolean;
}): FhvRehearsalCampaignResult {
  const cyclesProcessed = readFhvRehearsalCampaignProgress(input.runRoot)?.cyclesProcessed ?? 0;
  if (input.consumeResumeMarker) {
    consumeFhvCampaignControlMarker(input.runRoot, "RESUME_FROM_CHECKPOINT");
  }
  writeFhvRehearsalCampaignProgress(input.runRoot, {
    schemaVersion: "fhv-rehearsal-campaign-progress/v1",
    runId: input.runId,
    cyclesProcessed,
    expectedCycles: HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
    phase: "timeout",
    updatedAtUtc: new Date().toISOString(),
  });
  writeFileAtomic(
    join(input.runRoot, "fhv-rehearsal-terminal.v1.json"),
    `${JSON.stringify(
      {
        classification: "REHEARSAL_TIMEOUT",
        source: input.source,
        cyclesProcessed,
      },
      null,
      2,
    )}\n`,
  );
  return {
    terminalState: "REHEARSAL_TIMEOUT",
    cyclesProcessed,
    evidenceDigest: "",
    semanticReproDigest: "",
    classification: "REHEARSAL_TIMEOUT",
  };
}

function resolveFhvCanonicalCompletionResult(input: {
  runRoot: string;
  existingProgress: ReturnType<typeof readFhvRehearsalCampaignProgress>;
  terminalClassification: string | null;
}): FhvRehearsalCampaignResult | null {
  const runChain = readReplayRunChainManifest(input.runRoot);
  if (!runChain) {
    if (input.terminalClassification === "REHEARSAL_OK") {
      return {
        terminalState: "REPLAY_RUN_OK",
        cyclesProcessed: input.existingProgress?.cyclesProcessed ?? 0,
        evidenceDigest: "",
        semanticReproDigest: "",
        classification: "REHEARSAL_OK",
      };
    }
    return null;
  }

  const canonical = validateFhvCanonicalRunChainCompletion(input.runRoot);
  if (canonical.ok) {
    return {
      terminalState: "REPLAY_RUN_OK",
      cyclesProcessed: canonical.read.authoritativeCycleCount,
      evidenceDigest: "",
      semanticReproDigest: "",
      classification: "REHEARSAL_OK",
    };
  }

  if (
    input.terminalClassification === "REHEARSAL_PAUSED" &&
    input.existingProgress?.phase === "paused_at_checkpoint"
  ) {
    return null;
  }

  if (input.terminalClassification === "REHEARSAL_OK") {
    throw new FhvRehearsalCampaignError(
      canonical.code,
      `Stale terminal REHEARSAL_OK contradicted by run-chain: ${canonical.reason}`,
    );
  }

  return {
    terminalState: "REPLAY_RUN_FAILED_NONRESUMABLE",
    cyclesProcessed: input.existingProgress?.cyclesProcessed ?? 0,
    evidenceDigest: "",
    semanticReproDigest: "",
    classification: "REHEARSAL_FAILED",
  };
}
export async function runFhvRehearsalCampaign(input: {
  runRoot: string;
  targetSha: string;
  runId: string;
  organizationId: string;
  /** Hermetic tests may inject a monotonic deadline override. */
  monotonicDeadline?: FhvRehearsalMonotonicDeadline;
}): Promise<FhvRehearsalCampaignResult> {
  const manifest = assertFhvCampaignRuntimeIdentity(input);
  mkdirSync(resolveFhvRehearsalEvidenceDir(input.runRoot), { recursive: true });

  const terminalClassification = readFhvRehearsalTerminalClassification(input.runRoot);
  const existingProgress = readFhvRehearsalCampaignProgress(input.runRoot);
  const runChain = readReplayRunChainManifest(input.runRoot);

  if (terminalClassification === "REHEARSAL_TIMEOUT") {
    return {
      terminalState: "REHEARSAL_TIMEOUT",
      cyclesProcessed: existingProgress?.cyclesProcessed ?? 0,
      evidenceDigest: "",
      semanticReproDigest: "",
      classification: "REHEARSAL_TIMEOUT",
    };
  }

  if (terminalClassification === "REHEARSAL_FAILED") {
    return {
      terminalState: "REPLAY_RUN_FAILED_NONRESUMABLE",
      cyclesProcessed: existingProgress?.cyclesProcessed ?? 0,
      evidenceDigest: "",
      semanticReproDigest: "",
      classification: "REHEARSAL_FAILED",
    };
  }

  const failedViaRunChain = runChain?.segments.some(
    (segment) => segment.terminalState === "STREAMING_EVIDENCE_FAILED",
  );
  if (failedViaRunChain) {
    return {
      terminalState: "REPLAY_RUN_FAILED_NONRESUMABLE",
      cyclesProcessed: existingProgress?.cyclesProcessed ?? 0,
      evidenceDigest: "",
      semanticReproDigest: "",
      classification: "REHEARSAL_FAILED",
    };
  }

  if (runChain) {
    const canonicalCompletion = resolveFhvCanonicalCompletionResult({
      runRoot: input.runRoot,
      existingProgress,
      terminalClassification,
    });
    if (canonicalCompletion) {
      return canonicalCompletion;
    }
  } else if (terminalClassification === "REHEARSAL_OK") {
    return {
      terminalState: "REPLAY_RUN_OK",
      cyclesProcessed: existingProgress?.cyclesProcessed ?? 0,
      evidenceDigest: "",
      semanticReproDigest: "",
      classification: "REHEARSAL_OK",
    };
  }

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

  const resuming = isFhvResumeFromCheckpointRequested(input.runRoot);

  try {
    if (resuming) {
      return await runResumeFromCheckpoint({
        runRoot: input.runRoot,
        runId: input.runId,
        targetSha: input.targetSha,
        manifest,
        monotonicDeadline: input.monotonicDeadline,
      });
    }

    return await runCampaignWithPauseSupport({
      runRoot: input.runRoot,
      runId: input.runId,
      organizationId: input.organizationId,
      manifest,
      targetSha: input.targetSha,
      monotonicDeadline: input.monotonicDeadline,
    });
  } catch (error) {
    if (
      error instanceof FhvRehearsalCampaignError &&
      error.code === "REHEARSAL_DEADLINE_EXCEEDED"
    ) {
      return writeFhvRehearsalTimeoutEvidence({
        runRoot: input.runRoot,
        runId: input.runId,
        source: resuming ? "resumed_replay" : "initial_replay",
        consumeResumeMarker: resuming,
      });
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
  pauseAfterCycles?: number;
}): Promise<{
  uninterruptedDigest: string;
  resumedDigest: string;
  match: boolean;
  actualPauseCycle: number;
}> {
  const pauseAfterCycles = input.pauseAfterCycles ?? FHV_REHEARSAL_CHECKPOINT_CYCLE;
  const uninterrupted = await runFhvRehearsalCampaign({
    runRoot: input.runRootUninterrupted,
    runId: input.runId,
    targetSha: input.targetSha,
    organizationId: input.organizationId,
  });
  expectUninterruptedEvidenceComplete(input.runRootUninterrupted);

  const pauseManifest = assertFhvCampaignRuntimeIdentity({
    runRoot: input.runRootPauseResume,
    runId: input.runId,
    targetSha: input.targetSha,
    organizationId: input.organizationId,
  });
  mkdirSync(resolveFhvRehearsalEvidenceDir(input.runRootPauseResume), { recursive: true });
  const paused = await runCampaignWithPauseSupport({
    runRoot: input.runRootPauseResume,
    runId: input.runId,
    organizationId: input.organizationId,
    manifest: pauseManifest,
    targetSha: input.targetSha,
    parityPauseAfterCycles: pauseAfterCycles,
  });
  if (paused.classification !== "REHEARSAL_PAUSED") {
    throw new Error("Expected paused rehearsal classification.");
  }
  writeFhvCampaignControlResumeRequest(input.runRootPauseResume, input.runId, input.organizationId);
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
    actualPauseCycle: paused.cyclesProcessed,
  };
}

function expectUninterruptedEvidenceComplete(runRoot: string): void {
  const terminalState = readFhvRehearsalEvidenceTerminalState(runRoot);
  if (terminalState !== "STREAMING_EVIDENCE_OK") {
    throw new FhvRehearsalCampaignError(
      "FHV_UNINTERRUPTED_EVIDENCE_NOT_COMPLETE",
      `Expected STREAMING_EVIDENCE_OK, got ${terminalState ?? "null"}.`,
    );
  }
}

export async function waitForFhvRehearsalCycles(
  runRoot: string,
  minCycles: number,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<number> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 25;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const cyclesProcessed = readFhvRehearsalCampaignProgress(runRoot)?.cyclesProcessed ?? 0;
    if (cyclesProcessed >= minCycles) {
      return cyclesProcessed;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new FhvRehearsalCampaignError(
    "FHV_REHEARSAL_WAIT_TIMEOUT",
    `Timed out waiting for ${minCycles} cycles.`,
  );
}

export function writeFhvCampaignControlPauseRequest(
  runRoot: string,
  runId: string,
  organizationId: string,
): void {
  writeFhvCampaignControlRequest(runRoot, {
    schemaVersion: "fhv-campaign-control-request/v1",
    action: "PAUSE_AT_CHECKPOINT",
    runId,
    organizationId,
    operatorId: "fhv-rehearsal-runner",
    reason: "checkpoint pause",
    requestedAtUtc: new Date().toISOString(),
  });
}

export function writeFhvCampaignControlResumeRequest(
  runRoot: string,
  runId: string,
  organizationId: string,
): void {
  writeFhvCampaignControlRequest(runRoot, {
    schemaVersion: "fhv-campaign-control-request/v1",
    action: "RESUME_FROM_CHECKPOINT",
    runId,
    organizationId,
    operatorId: "fhv-rehearsal-runner",
    reason: "checkpoint resume",
    requestedAtUtc: new Date().toISOString(),
  });
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
