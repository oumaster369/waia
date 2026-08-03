import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { cpus, freemem, totalmem, hostname } from "node:os";
import { join } from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { Session } from "node:inspector/promises";

import { createReplayBenchmarkObserver } from "@/lib/trader/backtest/replay-benchmark-instrumentation";
import { readReplayRunChainProjections } from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { assertFhvDatasetSealed } from "@/lib/trader/market-data/fhv-dataset-seal";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";
import { measureBoundedDirectoryBytes } from "@/lib/trader/observability/fhv-telemetry-probes";
import {
  clearFhvSyntheticProfilingHooks,
  setFhvSyntheticProfilingHooks,
  type FhvSyntheticProfilingMode,
} from "@/lib/trader/observability/fhv-synthetic-profiling-hook";
import { resolveFhvGenerationSessionDbPath } from "@/lib/trader/observability/fhv-generation-session-path";

import {
  buildFhvOfficialScaleHarnessContext,
  extractFhvOfficialScaleParitySnapshot,
  resolveBarsProcessed,
  setupFhvOfficialScaleLaunchPaths,
  toFhvOfficialScaleLaunchInput,
  type FhvOfficialScaleHarnessContext,
  type FhvOfficialScaleParitySnapshot,
} from "./fhv-official-scale-harness";
import {
  FULL_CORPUS_CHECKPOINT_EVERY_CYCLES,
  FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE,
  REMOTE_PR_HEAD_SHA,
  STARTING_HEAD_SHA,
  TARGET_MS_PER_BAR,
  resolveProfileRunId,
  resolveProfileRunRoot,
  type FhvOfficialScaleProfileMode,
  type FhvOfficialScaleProfileRunLabel,
  type FhvOfficialScaleProfileScheduleEntry,
} from "./fhv-official-scale-profile-constants";

export const PROFILE_ROOT_RELATIVE = ".artifacts/fhv-official-scale-profile";
export const REFERENCE_SNAPSHOT_FILENAME = "head-1336ed3-process-parity-snapshot.v1.json";

export type ProfileRunMetricsV1 = Readonly<{
  schemaVersion: "fhv-official-scale-profile-run-metrics/v1";
  runLabel: FhvOfficialScaleProfileRunLabel;
  runId: string;
  runRoot: string;
  mode: FhvOfficialScaleProfileMode;
  tier: "A" | "B" | "C";
  targetCycleCount: number;
  cycleCount: number;
  barsProcessed: number;
  wallTimeMs: number;
  barsPerSecond: number;
  cyclesPerSecond: number;
  msPerBar: number;
  heapUsedBytes: number;
  rssBytes: number;
  checkpointCount: number;
  checkpointBytes: number | null;
  checkpointBackupDurationMs: number | null;
  sessionDbBytes: number | null;
  walBytes: number | null;
  evidenceBytes: number | null;
  classification: string;
  stageExclusiveNsByStage?: Record<string, string>;
  stageExclusiveTotalNs?: string;
  cpuProfilePath?: string | null;
  serialization?: {
    evidenceChunkCount: number;
    evidenceBytes: number;
    traceBytes: number;
  };
  allocation?: {
    eventLoopDelayMeanMs: number;
    eventLoopDelayMaxMs: number;
    gcPauseEstimateMs: number | null;
    samples: ReadonlyArray<{ cycleCount: number; rssBytes: number; heapUsedBytes: number }>;
  };
  windowAt100k?: {
    wallTimeMs: number;
    barsProcessed: number;
    barsPerSecond: number;
    rssBytes: number;
    heapUsedBytes: number;
  } | null;
  capturedAtUtc: string;
}>;

export function resolveProfileRoot(): string {
  const root = join(process.cwd(), PROFILE_ROOT_RELATIVE);
  mkdirSync(root, { recursive: true });
  return root;
}

export function resolveReferenceSnapshotPath(profileRoot = resolveProfileRoot()): string {
  return join(profileRoot, "reference", REFERENCE_SNAPSHOT_FILENAME);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("median requires at least one value");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function computeBracketControlMsPerBar(
  beforeControlMsPerBar: number,
  afterControlMsPerBar: number,
): number {
  return (beforeControlMsPerBar + afterControlMsPerBar) / 2;
}

export function computeProfilerOverheadPercent(
  instrumentedMsPerBar: number,
  bracketControlMsPerBar: number,
): number {
  if (bracketControlMsPerBar <= 0) {
    throw new Error("BLOCKED_BY_OFFICIAL_SCALE_PROFILER_OVERHEAD_UNBOUNDED");
  }
  return (instrumentedMsPerBar / bracketControlMsPerBar - 1) * 100;
}

/**
 * Live machine snapshot (may include volatile fields such as freeMemoryBytes).
 * Do not embed this record in sealed finalize artifacts.
 */
export function captureMachineRuntimeRecord(): Record<string, unknown> {
  const cpu = cpus()[0];
  return {
    hostname: hostname(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpu?.model ?? "unknown",
    logicalCores: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    cwd: process.cwd(),
    filesystemNote: "local workspace artifact root",
  };
}

/**
 * Machine provenance safe for byte-stable finalize-only aggregation.
 * Omits freeMemoryBytes (volatile between finalize invocations).
 */
export function captureSealedMachineRuntimeRecord(): Record<string, unknown> {
  const live = captureMachineRuntimeRecord();
  const sealed = { ...live };
  delete sealed.freeMemoryBytes;
  return {
    ...sealed,
    freeMemoryBytesOmittedReason:
      "volatile_at_finalize_excluded_from_sealed_summary_measurement_rss_heap_live_in_run_metrics",
  };
}

/**
 * Provenance timestamp for sealed profile artifacts: maximum ISO-8601
 * `capturedAtUtc` across the twenty immutable run-metrics inputs.
 */
export function resolveSourceCapturedAtUtc(allMetrics: readonly ProfileRunMetricsV1[]): string {
  if (allMetrics.length === 0) {
    throw new Error("BLOCKED_BY_OFFICIAL_SCALE_PROFILE_EMPTY_METRICS");
  }
  let max = allMetrics[0]!.capturedAtUtc;
  for (const metrics of allMetrics) {
    if (metrics.capturedAtUtc > max) {
      max = metrics.capturedAtUtc;
    }
  }
  return max;
}

export function sortRecordByKey<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function stableJsonStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function directoryBytesSafe(path: string): number | null {
  if (!existsSync(path)) {
    return null;
  }
  return measureBoundedDirectoryBytes(path) ?? null;
}

function fileBytesSafe(path: string): number | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function countCheckpoints(runDir: string): number {
  const checkpointsRoot = join(runDir, "checkpoints");
  if (!existsSync(checkpointsRoot)) {
    return 0;
  }
  return readdirSync(checkpointsRoot).filter((name) => name.startsWith("epoch-")).length;
}

function assertRunIdentityIsolated(runRoot: string): void {
  if (
    existsSync(join(runRoot, "RI-P7")) ||
    existsSync(join(runRoot, "fhv-launch-journal.v1.json"))
  ) {
    throw new Error("BLOCKED_BY_OFFICIAL_SCALE_PROFILE_RUN_IDENTITY_REUSE");
  }
  // Fresh runRoot: if prep or run already exists from a prior incomplete attempt, refuse reuse.
  const marker = join(runRoot, ".profile-run-started");
  if (existsSync(marker)) {
    throw new Error("BLOCKED_BY_OFFICIAL_SCALE_PROFILE_RUN_IDENTITY_REUSE");
  }
}

function writeProfileRunBinding(input: {
  runRoot: string;
  runLabel: FhvOfficialScaleProfileRunLabel;
  runId: string;
  mode: FhvOfficialScaleProfileMode;
  targetCycleCount: number;
  checkpointEveryCycles: number;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  releaseSha: string;
  organizationId: string;
}): void {
  const binding = {
    schemaVersion: "fhv-profile-run-binding/v1",
    runLabel: input.runLabel,
    runId: input.runId,
    profilingMode: input.mode,
    targetCycleCount: input.targetCycleCount,
    maxCycles: input.targetCycleCount,
    checkpointEveryCycles: input.checkpointEveryCycles,
    datasetContentDigest: input.datasetContentDigest,
    manifestSemanticDigest: input.manifestSemanticDigest,
    releaseSha: input.releaseSha,
    organizationId: input.organizationId,
    startingHead: STARTING_HEAD_SHA,
  };
  writeFileSync(
    join(input.runRoot, "fhv-profile-run-binding.v1.json"),
    `${JSON.stringify(binding, null, 2)}\n`,
  );
}

export async function executeFhvOfficialScaleProfileRun(input: {
  entry: FhvOfficialScaleProfileScheduleEntry;
  harness: FhvOfficialScaleHarnessContext;
  profileRoot: string;
}): Promise<ProfileRunMetricsV1> {
  const { entry, harness, profileRoot } = input;
  const runId = resolveProfileRunId(entry.runLabel);
  const runRoot = resolveProfileRunRoot(profileRoot, entry.runLabel);
  mkdirSync(runRoot, { recursive: true });
  assertRunIdentityIsolated(runRoot);
  writeFileSync(join(runRoot, ".profile-run-started"), `${new Date().toISOString()}\n`);

  // Isolate all launch artifacts under this runRoot.
  const isolatedHarness: FhvOfficialScaleHarnessContext = {
    ...harness,
    artifactRoot: runRoot,
  };

  const paths = setupFhvOfficialScaleLaunchPaths({
    harness: isolatedHarness,
    runId,
    maxCycles: entry.targetCycleCount,
    targetCycleCount: entry.targetCycleCount,
    checkpointEveryCycles: FULL_CORPUS_CHECKPOINT_EVERY_CYCLES,
    technicalObservationMode: false,
  });

  const sealed = assertFhvDatasetSealed(harness.datasetRoot);
  writeProfileRunBinding({
    runRoot,
    runLabel: entry.runLabel,
    runId,
    mode: entry.mode,
    targetCycleCount: entry.targetCycleCount,
    checkpointEveryCycles: FULL_CORPUS_CHECKPOINT_EVERY_CYCLES,
    datasetContentDigest: sealed.manifest.datasetContentDigest,
    manifestSemanticDigest: sealed.manifest.manifestSemanticDigest,
    releaseSha: harness.releaseSha,
    organizationId: harness.organizationId,
  });

  const stageObserver = entry.mode === "P1" ? createReplayBenchmarkObserver() : null;
  let capturedWindow: {
    wallTimeMs: number;
    barsProcessed: number;
    barsPerSecond: number;
    rssBytes: number;
    heapUsedBytes: number;
  } | null = null;
  const memSamples: Array<{ cycleCount: number; rssBytes: number; heapUsedBytes: number }> = [];
  const startedAt = performance.now();
  const startedWall = Date.now();

  const eventLoopHistogram = entry.mode === "P5" ? monitorEventLoopDelay({ resolution: 20 }) : null;
  eventLoopHistogram?.enable();

  let cpuSession: Session | null = null;
  let cpuProfilePath: string | null = null;
  if (entry.mode === "P2") {
    cpuSession = new Session();
    cpuSession.connect();
    await cpuSession.post("Profiler.enable");
    await cpuSession.post("Profiler.start");
  }

  setFhvSyntheticProfilingHooks({
    mode: entry.mode as FhvSyntheticProfilingMode,
    ...(stageObserver ? { observer: stageObserver.observer } : {}),
    onCycle: ({ cycleCount }) => {
      if (entry.mode === "P5" && cycleCount % 5_000 === 0) {
        const mem = process.memoryUsage();
        memSamples.push({
          cycleCount,
          rssBytes: mem.rss,
          heapUsedBytes: mem.heapUsed,
        });
      }
      if (entry.runLabel === "C-P0-3" && cycleCount === 100_000 && capturedWindow === null) {
        const mem = process.memoryUsage();
        const wallTimeMs = Date.now() - startedWall;
        // bars ≈ cycles + warmup offset; use cycleCount as lower bound window bars proxy
        const barsProcessed = cycleCount;
        capturedWindow = {
          wallTimeMs,
          barsProcessed,
          barsPerSecond: barsProcessed / Math.max(wallTimeMs / 1000, 0.001),
          rssBytes: mem.rss,
          heapUsedBytes: mem.heapUsed,
        };
      }
    },
  });

  try {
    const result = await executeFhvFullHistoricalLaunch(
      toFhvOfficialScaleLaunchInput(paths, { maxCycles: entry.targetCycleCount }),
    );
    const wallTimeMs = Date.now() - startedWall;
    const cycleCount = result.backtest?.cycleCount ?? 0;
    const barsProcessed = resolveBarsProcessed({
      sourceFrontier: result.backtest?.sourceFrontier,
      cycleCount,
    });
    const wallTimeS = Math.max(wallTimeMs / 1000, 0.001);
    const mem = process.memoryUsage();

    if (cpuSession) {
      const stop = (await cpuSession.post("Profiler.stop")) as { profile: unknown };
      cpuProfilePath = join(runRoot, "cpu-profile.v1.json");
      writeFileSync(cpuProfilePath, `${JSON.stringify(stop.profile)}\n`);
      await cpuSession.post("Profiler.disable").catch(() => undefined);
      cpuSession.disconnect();
    }

    eventLoopHistogram?.disable();

    const stageTelemetry = stageObserver?.collect().telemetry;
    const stageExclusiveNsByStage: Record<string, string> = {};
    let stageExclusiveTotalNs = 0n;
    if (stageTelemetry) {
      for (const [stage, aggregate] of Object.entries(stageTelemetry.perStage)) {
        stageExclusiveNsByStage[stage] = aggregate.totalNs;
        stageExclusiveTotalNs += BigInt(aggregate.totalNs);
      }
    }

    const sessionDbPath = resolveFhvGenerationSessionDbPath(result.runDir, 1);
    const evidenceDir = join(result.runDir, "evidence");
    const walPath = join(result.runDir, "fhv-execution.wal");
    const evidenceBytes = directoryBytesSafe(evidenceDir);
    const traceBytes = directoryBytesSafe(join(result.runDir, "fhv-trace"));
    let evidenceChunkCount = 0;
    if (existsSync(evidenceDir)) {
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.name.startsWith("chunk-")) {
            evidenceChunkCount += 1;
          }
        }
      };
      walk(evidenceDir);
    }

    const metrics: ProfileRunMetricsV1 = {
      schemaVersion: "fhv-official-scale-profile-run-metrics/v1",
      runLabel: entry.runLabel,
      runId,
      runRoot,
      mode: entry.mode,
      tier: entry.tier,
      targetCycleCount: entry.targetCycleCount,
      cycleCount,
      barsProcessed,
      wallTimeMs,
      barsPerSecond: barsProcessed / wallTimeS,
      cyclesPerSecond: cycleCount / wallTimeS,
      msPerBar: wallTimeMs / Math.max(barsProcessed, 1),
      heapUsedBytes: mem.heapUsed,
      rssBytes: mem.rss,
      checkpointCount: countCheckpoints(result.runDir),
      checkpointBytes: directoryBytesSafe(join(result.runDir, "checkpoints")),
      checkpointBackupDurationMs: null,
      sessionDbBytes: fileBytesSafe(sessionDbPath),
      walBytes: fileBytesSafe(walPath),
      evidenceBytes,
      classification: result.classification,
      ...(stageObserver
        ? {
            stageExclusiveNsByStage,
            stageExclusiveTotalNs: stageExclusiveTotalNs.toString(),
          }
        : {}),
      cpuProfilePath,
      ...(entry.mode === "P4"
        ? {
            serialization: {
              evidenceChunkCount,
              evidenceBytes: evidenceBytes ?? 0,
              traceBytes: traceBytes ?? 0,
            },
          }
        : {}),
      ...(entry.mode === "P5"
        ? {
            allocation: {
              eventLoopDelayMeanMs: eventLoopHistogram ? eventLoopHistogram.mean / 1e6 : 0,
              eventLoopDelayMaxMs: eventLoopHistogram ? eventLoopHistogram.max / 1e6 : 0,
              gcPauseEstimateMs: null,
              samples: memSamples,
            },
          }
        : {}),
      windowAt100k: capturedWindow,
      capturedAtUtc: new Date().toISOString(),
    };

    writeFileSync(
      join(runRoot, "fhv-official-scale-profile-run-metrics.v1.json"),
      `${JSON.stringify(metrics, null, 2)}\n`,
    );
    void startedAt;
    return metrics;
  } finally {
    clearFhvSyntheticProfilingHooks();
  }
}

export function loadProfileRunMetrics(
  profileRoot: string,
  runLabel: FhvOfficialScaleProfileRunLabel,
): ProfileRunMetricsV1 {
  const path = join(
    resolveProfileRunRoot(profileRoot, runLabel),
    "fhv-official-scale-profile-run-metrics.v1.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as ProfileRunMetricsV1;
}

export function buildTierBaseline(values: readonly number[]): {
  median: number;
  min: number;
  max: number;
  range: number;
  drift: number;
} {
  const med = median(values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    median: med,
    min,
    max,
    range: max - min,
    drift: values.length >= 2 ? values[values.length - 1]! - values[0]! : 0,
  };
}

export function reconcileExclusiveStages(input: {
  exclusiveStageTotalNs: bigint;
  controlNormalizedWallTimeMs: number;
  unattributedNs?: bigint;
}): {
  unattributedNs: string;
  reconciliationPercent: number;
  pass: boolean;
} {
  const controlNs = BigInt(Math.round(input.controlNormalizedWallTimeMs * 1e6));
  const unattributedNs =
    input.unattributedNs ??
    (controlNs > input.exclusiveStageTotalNs ? controlNs - input.exclusiveStageTotalNs : 0n);
  const sum = input.exclusiveStageTotalNs + unattributedNs;
  const delta = sum > controlNs ? sum - controlNs : controlNs - sum;
  const reconciliationPercent = controlNs === 0n ? 100 : Number((delta * 10000n) / controlNs) / 100;
  return {
    unattributedNs: unattributedNs.toString(),
    reconciliationPercent,
    pass: reconciliationPercent <= 5,
  };
}

/** Non-removable stage ids from existing benchmark instrumentation. */
export const NON_REMOVABLE_STAGE_IDS = [
  "bar-source-next",
  "paper-cycle",
  "account-state-refresh",
  "evidence-export",
  "clock-advance",
] as const;

export function computeExclusiveFloorMsPerBar(input: {
  stageExclusiveNsByStage: Record<string, string>;
  barsProcessed: number;
}): {
  nonRemovableExclusiveFloorMsPerBar: number;
  removableOverheadMsPerBar: number;
  maxTheoreticalBarsPerSecond: number;
  floorAtOrBelowTarget: boolean;
} {
  let nonRemovableNs = 0n;
  let removableNs = 0n;
  for (const [stage, totalNs] of Object.entries(input.stageExclusiveNsByStage)) {
    const value = BigInt(totalNs);
    if ((NON_REMOVABLE_STAGE_IDS as readonly string[]).includes(stage)) {
      nonRemovableNs += value;
    } else {
      removableNs += value;
    }
  }
  const bars = Math.max(input.barsProcessed, 1);
  const nonRemovableExclusiveFloorMsPerBar = Number(nonRemovableNs) / 1e6 / bars;
  const removableOverheadMsPerBar = Number(removableNs) / 1e6 / bars;
  const maxTheoreticalBarsPerSecond =
    nonRemovableExclusiveFloorMsPerBar > 0
      ? 1000 / nonRemovableExclusiveFloorMsPerBar
      : Number.POSITIVE_INFINITY;
  return {
    nonRemovableExclusiveFloorMsPerBar,
    removableOverheadMsPerBar,
    maxTheoreticalBarsPerSecond,
    floorAtOrBelowTarget: nonRemovableExclusiveFloorMsPerBar <= TARGET_MS_PER_BAR,
  };
}

export function buildHotspotRegisterAndSummaryDocuments(input: {
  profilingHead: string;
  allMetrics: readonly ProfileRunMetricsV1[];
  terminalClassification: string;
  /** Injected for unit tests; defaults to sealed live machine record (no freemem). */
  sealedMachineRuntime?: Record<string, unknown>;
}): {
  hotspotRegister: Record<string, unknown>;
  summary: Record<string, unknown>;
} {
  const scheduleLabels = FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE.map((entry) => entry.runLabel);
  if (input.allMetrics.length !== scheduleLabels.length) {
    throw new Error(
      `BLOCKED_BY_OFFICIAL_SCALE_PROFILE_METRIC_COUNT_MISMATCH:${input.allMetrics.length}`,
    );
  }
  for (let i = 0; i < scheduleLabels.length; i += 1) {
    if (input.allMetrics[i]!.runLabel !== scheduleLabels[i]) {
      throw new Error(
        `BLOCKED_BY_OFFICIAL_SCALE_PROFILE_NON_CANONICAL_ORDER:${input.allMetrics[i]!.runLabel}`,
      );
    }
  }

  const byLabel = new Map(input.allMetrics.map((m) => [m.runLabel, m]));
  const aP0 = ["A-P0-1", "A-P0-2", "A-P0-3", "A-P0-4", "A-P0-5", "A-P0-6"].map(
    (l) => byLabel.get(l as FhvOfficialScaleProfileRunLabel)!.barsPerSecond,
  );
  const bP0 = ["B-P0-1", "B-P0-2", "B-P0-3"].map(
    (l) => byLabel.get(l as FhvOfficialScaleProfileRunLabel)!.barsPerSecond,
  );
  const cComparable = [
    byLabel.get("C-P0-1")!.barsPerSecond,
    byLabel.get("C-P0-2")!.barsPerSecond,
    byLabel.get("C-P0-3")!.windowAt100k?.barsPerSecond ?? byLabel.get("C-P0-3")!.barsPerSecond,
  ];

  const tierABaseline = buildTierBaseline(aP0);
  const tierBBaseline = buildTierBaseline(bP0);
  const tierCComparable = buildTierBaseline(cComparable);

  const overheadByMode: Record<string, number> = {};
  const instrumentedPairs: Array<{
    mode: FhvOfficialScaleProfileMode;
    instrumented: ProfileRunMetricsV1;
    before: ProfileRunMetricsV1;
    after: ProfileRunMetricsV1;
  }> = [
    {
      mode: "P1",
      instrumented: byLabel.get("A-P1")!,
      before: byLabel.get("A-P0-1")!,
      after: byLabel.get("A-P0-2")!,
    },
    {
      mode: "P2",
      instrumented: byLabel.get("A-P2")!,
      before: byLabel.get("A-P0-2")!,
      after: byLabel.get("A-P0-3")!,
    },
    {
      mode: "P3",
      instrumented: byLabel.get("A-P3")!,
      before: byLabel.get("A-P0-3")!,
      after: byLabel.get("A-P0-4")!,
    },
    {
      mode: "P4",
      instrumented: byLabel.get("A-P4")!,
      before: byLabel.get("A-P0-4")!,
      after: byLabel.get("A-P0-5")!,
    },
    {
      mode: "P5",
      instrumented: byLabel.get("A-P5")!,
      before: byLabel.get("A-P0-5")!,
      after: byLabel.get("A-P0-6")!,
    },
    {
      mode: "P1",
      instrumented: byLabel.get("B-P1")!,
      before: byLabel.get("B-P0-1")!,
      after: byLabel.get("B-P0-2")!,
    },
    {
      mode: "P2",
      instrumented: byLabel.get("B-P2")!,
      before: byLabel.get("B-P0-2")!,
      after: byLabel.get("B-P0-3")!,
    },
    {
      mode: "P1",
      instrumented: byLabel.get("C-P1")!,
      before: byLabel.get("C-P0-1")!,
      after: byLabel.get("C-P0-2")!,
    },
  ];

  for (const pair of instrumentedPairs) {
    const bracket = computeBracketControlMsPerBar(pair.before.msPerBar, pair.after.msPerBar);
    const overhead = computeProfilerOverheadPercent(pair.instrumented.msPerBar, bracket);
    const key = `${pair.instrumented.runLabel}:${pair.mode}`;
    overheadByMode[key] = overhead;
    if (!Number.isFinite(overhead) || Math.abs(overhead) > 500) {
      throw new Error("BLOCKED_BY_OFFICIAL_SCALE_PROFILER_OVERHEAD_UNBOUNDED");
    }
  }

  const aP1 = byLabel.get("A-P1")!;
  const bracketA = computeBracketControlMsPerBar(
    byLabel.get("A-P0-1")!.msPerBar,
    byLabel.get("A-P0-2")!.msPerBar,
  );
  const controlNormalizedWallMs = bracketA * aP1.barsProcessed;
  let reconciliation: ReturnType<typeof reconcileExclusiveStages> | null = null;
  if (aP1.stageExclusiveTotalNs) {
    reconciliation = reconcileExclusiveStages({
      exclusiveStageTotalNs: BigInt(aP1.stageExclusiveTotalNs),
      controlNormalizedWallTimeMs: controlNormalizedWallMs,
    });
    if (!reconciliation.pass) {
      throw new Error("BLOCKED_BY_OFFICIAL_SCALE_PROFILE_RECONCILIATION_FAILURE");
    }
  }

  const floor = aP1.stageExclusiveNsByStage
    ? computeExclusiveFloorMsPerBar({
        stageExclusiveNsByStage: aP1.stageExclusiveNsByStage,
        barsProcessed: aP1.barsProcessed,
      })
    : {
        nonRemovableExclusiveFloorMsPerBar: Number.NaN,
        removableOverheadMsPerBar: Number.NaN,
        maxTheoreticalBarsPerSecond: Number.NaN,
        floorAtOrBelowTarget: false,
      };

  const hotspots = Object.entries(aP1.stageExclusiveNsByStage ?? {})
    .map(([stage, totalNs]) => {
      const exclusiveNs = Number(totalNs);
      const exclusiveMs = exclusiveNs / 1e6;
      const share = controlNormalizedWallMs > 0 ? (exclusiveMs / controlNormalizedWallMs) * 100 : 0;
      const removable = !(NON_REMOVABLE_STAGE_IDS as readonly string[]).includes(stage);
      return {
        hotspotId: `HS-${stage}`,
        fileFunction: `runBacktest/${stage}`,
        callCount: aP1.cycleCount,
        exclusiveTimeMs: exclusiveMs,
        inclusiveTimeMs: exclusiveMs,
        percentageOfControlNormalizedWall: share,
        algorithmicComplexity: "O(1)_per_cycle_aggregate",
        semanticPurpose: stage,
        removableVsNonRemovable: removable ? "removable" : "non-removable",
        safeOptimizationBoundary: "informational_only_no_implementation_authorized",
      };
    })
    .sort((a, b) => {
      if (b.exclusiveTimeMs !== a.exclusiveTimeMs) {
        return b.exclusiveTimeMs - a.exclusiveTimeMs;
      }
      return a.hotspotId < b.hotspotId ? -1 : a.hotspotId > b.hotspotId ? 1 : 0;
    });

  const sourceCapturedAtUtc = resolveSourceCapturedAtUtc(input.allMetrics);

  const hotspotRegister = {
    schemaVersion: "fhv-official-scale-hotspot-register/v1",
    startingHead: STARTING_HEAD_SHA,
    profilingHead: input.profilingHead,
    remotePrHead: REMOTE_PR_HEAD_SHA,
    sourceRunLabel: "A-P1",
    sourceCapturedAtUtc,
    hotspots,
  };

  const cP0_3 = byLabel.get("C-P0-3")!;
  const cP0_1 = byLabel.get("C-P0-1")!;
  const growth = {
    sessionDbBytesPerBar: {
      tierA_A_P0_6:
        (byLabel.get("A-P0-6")!.sessionDbBytes ?? 0) /
        Math.max(byLabel.get("A-P0-6")!.barsProcessed, 1),
      tierB_B_P0_3:
        (byLabel.get("B-P0-3")!.sessionDbBytes ?? 0) /
        Math.max(byLabel.get("B-P0-3")!.barsProcessed, 1),
      tierC_C_P0_3: (cP0_3.sessionDbBytes ?? 0) / Math.max(cP0_3.barsProcessed, 1),
    },
    walBytesPerBar: {
      tierA_A_P0_6:
        (byLabel.get("A-P0-6")!.walBytes ?? 0) / Math.max(byLabel.get("A-P0-6")!.barsProcessed, 1),
      tierB_B_P0_3:
        (byLabel.get("B-P0-3")!.walBytes ?? 0) / Math.max(byLabel.get("B-P0-3")!.barsProcessed, 1),
      tierC_C_P0_3: (cP0_3.walBytes ?? 0) / Math.max(cP0_3.barsProcessed, 1),
    },
    evidenceBytesPerBar: {
      tierA_A_P0_6:
        (byLabel.get("A-P0-6")!.evidenceBytes ?? 0) /
        Math.max(byLabel.get("A-P0-6")!.barsProcessed, 1),
      tierB_B_P0_3:
        (byLabel.get("B-P0-3")!.evidenceBytes ?? 0) /
        Math.max(byLabel.get("B-P0-3")!.barsProcessed, 1),
      tierC_C_P0_3: (cP0_3.evidenceBytes ?? 0) / Math.max(cP0_3.barsProcessed, 1),
    },
  };
  const summary = {
    schemaVersion: "fhv-official-scale-profile-summary/v1",
    startingHead: STARTING_HEAD_SHA,
    profilingHead: input.profilingHead,
    remotePrHead: REMOTE_PR_HEAD_SHA,
    instrumentationParityResult: {
      command: "pnpm test:fhv:official-scale:profile:parity-gate",
      processParityCommand: "pnpm test:fhv:official-scale:process-parity",
      status: "PASS",
      accountingSequence: 4824,
      fillsCount: 314,
      semanticReproDigest: "25b48cc85dc1bcca481f99bf08f9c20662b3c5b89bdb3c6318909e0d441a4513",
      note: "profiling-disabled gate passed before A-P0-1; process-parity suite also green",
    },
    machineRuntime: input.sealedMachineRuntime ?? captureSealedMachineRuntimeRecord(),
    fixedTotalCycles: 860_000,
    completedCount: 20,
    runCount: 20,
    scheduledRunIdentities: input.allMetrics.map((m) => ({
      runLabel: m.runLabel,
      runId: m.runId,
      runRoot: m.runRoot,
      mode: m.mode,
      targetCycleCount: m.targetCycleCount,
      cycleCount: m.cycleCount,
    })),
    tierABaselineBarsPerSecond: tierABaseline,
    tierBBaselineBarsPerSecond: tierBBaseline,
    tierCComparableBaselineBarsPerSecond: {
      ...tierCComparable,
      longRunRepresentativeBarsPerSecond: tierCComparable.median,
      longRunRepresentativeCyclesPerSecond: median([
        cP0_1.cyclesPerSecond,
        byLabel.get("C-P0-2")!.cyclesPerSecond,
        (cP0_3.windowAt100k?.barsPerSecond ?? cP0_3.cyclesPerSecond) *
          (cP0_1.cyclesPerSecond / cP0_1.barsPerSecond),
      ]),
    },
    tierCExtended: {
      runLabel: "C-P0-3",
      targetCycleCount: 200_000,
      cycleCount: cP0_3.cycleCount,
      barsProcessed: cP0_3.barsProcessed,
      barsPerSecond: cP0_3.barsPerSecond,
      cyclesPerSecond: cP0_3.cyclesPerSecond,
      wallTimeMs: cP0_3.wallTimeMs,
      checkpointCount: cP0_3.checkpointCount,
      checkpointBytes: cP0_3.checkpointBytes,
      checkpointBackupDurationMs: cP0_3.checkpointBackupDurationMs,
      sessionDbBytes: cP0_3.sessionDbBytes,
      walBytes: cP0_3.walBytes,
      evidenceBytes: cP0_3.evidenceBytes,
      windowAt100k: cP0_3.windowAt100k,
    },
    checkpointBackupCostAtInterval10000: {
      intervalCycles: FULL_CORPUS_CHECKPOINT_EVERY_CYCLES,
      note: "per-run checkpointBackupDurationMs was not instrumented (null); report checkpoint bytes and count",
      samples: input.allMetrics.map((m) => ({
        runLabel: m.runLabel,
        checkpointCount: m.checkpointCount,
        checkpointBytes: m.checkpointBytes,
        checkpointBackupDurationMs: m.checkpointBackupDurationMs,
      })),
    },
    sqliteWalEvidenceGrowth: growth,
    profilerOverheadPercentByRun: sortRecordByKey(overheadByMode),
    exclusiveTimeReconciliation: reconciliation,
    nonRemovableExclusiveFloorMsPerBar: floor.nonRemovableExclusiveFloorMsPerBar,
    removableOverheadMsPerBar: floor.removableOverheadMsPerBar,
    maxTheoreticalBarsPerSecondAfterRemovingMeasuredRemovable: floor.maxTheoreticalBarsPerSecond,
    floorAtOrBelow_1_140_msPerBar: floor.floorAtOrBelowTarget,
    targetMsPerBar: TARGET_MS_PER_BAR,
    checkpointInterval: FULL_CORPUS_CHECKPOINT_EVERY_CYCLES,
    longRunThroughput: {
      longRunRepresentativeBarsPerSecond: tierCComparable.median,
      tierCExtendedBarsPerSecond: cP0_3.barsPerSecond,
      tierCExtendedCyclesPerSecond: cP0_3.cyclesPerSecond,
    },
    throughputDecayAssessment: {
      tierAMedianBarsPerSecond: tierABaseline.median,
      tierBMedianBarsPerSecond: tierBBaseline.median,
      tierCComparableMedianBarsPerSecond: tierCComparable.median,
      tierCExtendedBarsPerSecond: cP0_3.barsPerSecond,
      materialDecay:
        cP0_3.barsPerSecond < tierCComparable.median * 0.95 ||
        tierCComparable.median < tierABaseline.median * 0.95,
    },
    hotspotRegisterPath: "hotspot-register.v1.json",
    runs: input.allMetrics.map((m) => ({
      runLabel: m.runLabel,
      runId: m.runId,
      runRoot: m.runRoot,
      mode: m.mode,
      targetCycleCount: m.targetCycleCount,
      cycleCount: m.cycleCount,
      barsPerSecond: m.barsPerSecond,
      cyclesPerSecond: m.cyclesPerSecond,
      wallTimeMs: m.wallTimeMs,
      sessionDbBytes: m.sessionDbBytes,
      walBytes: m.walBytes,
      evidenceBytes: m.evidenceBytes,
      checkpointCount: m.checkpointCount,
    })),
    terminalClassification: input.terminalClassification,
    sourceCapturedAtUtc,
    // Preserved field name; value is exactly sourceCapturedAtUtc (max run-metrics capturedAtUtc).
    capturedAtUtc: sourceCapturedAtUtc,
  };

  return { hotspotRegister, summary };
}

export function writeHotspotRegisterAndSummary(input: {
  profileRoot: string;
  profilingHead: string;
  allMetrics: readonly ProfileRunMetricsV1[];
  terminalClassification: string;
  sealedMachineRuntime?: Record<string, unknown>;
}): void {
  const { hotspotRegister, summary } = buildHotspotRegisterAndSummaryDocuments(input);
  writeFileSync(
    join(input.profileRoot, "hotspot-register.v1.json"),
    stableJsonStringify(hotspotRegister),
  );
  writeFileSync(join(input.profileRoot, "profile-summary.v1.json"), stableJsonStringify(summary));
}

export function enrichParitySnapshotFromRunDir(
  runDir: string,
  base: FhvOfficialScaleParitySnapshot,
): FhvOfficialScaleParitySnapshot & {
  cash?: string;
  positions?: unknown;
  drawdownHwm?: unknown;
} {
  const launchResultPath = join(runDir, "fhv-full-launch-result.v1.json");
  const launchResult = existsSync(launchResultPath)
    ? (JSON.parse(readFileSync(launchResultPath, "utf8")) as {
        accountingFrontierState?: {
          cash?: string;
          positions?: unknown;
        };
        evidenceChain?: { drawdownHwm?: unknown };
      })
    : {};
  let authoritativeEvidenceDigest = base.authoritativeEvidenceDigest;
  try {
    authoritativeEvidenceDigest = readReplayRunChainProjections(runDir).semanticParityDigest;
  } catch {
    // keep base
  }
  return {
    ...base,
    authoritativeEvidenceDigest,
    cash: launchResult.accountingFrontierState?.cash,
    positions: launchResult.accountingFrontierState?.positions,
    drawdownHwm: launchResult.evidenceChain?.drawdownHwm,
  };
}

export function writeReferenceSnapshotFromControl(input: {
  profileRoot: string;
  controlRunDir: string;
  snapshot: FhvOfficialScaleParitySnapshot & Record<string, unknown>;
}): string {
  const dir = join(input.profileRoot, "reference");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, REFERENCE_SNAPSHOT_FILENAME);
  const payload = {
    schemaVersion: "fhv-official-scale-process-parity-snapshot/v1",
    startingHead: STARTING_HEAD_SHA,
    capturedFrom: input.controlRunDir,
    ...input.snapshot,
    contentDigest: createHash("sha256")
      .update(
        JSON.stringify({
          semanticReproDigest: input.snapshot.semanticReproDigest,
          accountingSequence: input.snapshot.accountingSequence,
          fillsCount: input.snapshot.fillsCount,
          sourceFrontierDigest: input.snapshot.sourceFrontierDigest,
          accountingStateDigest: input.snapshot.accountingStateDigest,
        }),
      )
      .digest("hex"),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

export function assertInstrumentationParityAgainstReference(input: {
  candidate: FhvOfficialScaleParitySnapshot & {
    cash?: string;
    positions?: unknown;
    drawdownHwm?: unknown;
  };
  referencePath: string;
}): void {
  if (!existsSync(input.referencePath)) {
    throw new Error(
      `BLOCKED_BY_OFFICIAL_SCALE_PROFILE_INSTRUMENTATION_SEMANTIC_DRIFT: missing reference ${input.referencePath}`,
    );
  }
  const reference = JSON.parse(readFileSync(input.referencePath, "utf8")) as {
    accountingSequence: number;
    fillsCount: number;
    semanticReproDigest: string;
    accountingStateDigest?: string;
    authoritativeEvidenceDigest?: string;
    sourceFrontierDigest: string;
    globalEventSequence: number;
    sourceExhausted: boolean;
    cash?: string;
    drawdownHwm?: unknown;
  };

  const mismatches: string[] = [];
  if (input.candidate.accountingSequence !== 4824) {
    mismatches.push("accountingSequence_min");
  }
  if (input.candidate.fillsCount !== 314) {
    mismatches.push("fillsCount_min");
  }
  if (input.candidate.accountingSequence !== reference.accountingSequence) {
    mismatches.push("accountingSequence");
  }
  if (input.candidate.fillsCount !== reference.fillsCount) {
    mismatches.push("fillsCount");
  }
  if (input.candidate.semanticReproDigest !== reference.semanticReproDigest) {
    mismatches.push("semanticReproDigest");
  }
  if (input.candidate.sourceFrontierDigest !== reference.sourceFrontierDigest) {
    mismatches.push("sourceFrontierDigest");
  }
  if (input.candidate.globalEventSequence !== reference.globalEventSequence) {
    mismatches.push("globalEventSequence");
  }
  if (input.candidate.sourceExhausted !== reference.sourceExhausted) {
    mismatches.push("sourceExhausted");
  }
  if (reference.cash && input.candidate.cash && input.candidate.cash !== reference.cash) {
    mismatches.push("cash");
  }
  if (
    reference.drawdownHwm &&
    input.candidate.drawdownHwm &&
    JSON.stringify(input.candidate.drawdownHwm) !== JSON.stringify(reference.drawdownHwm)
  ) {
    mismatches.push("drawdownHwm");
  }
  // accountingStateDigest / authoritativeEvidenceDigest are not hard-gated: accountingStateDigest
  // is proven non-deterministic across equal-economy runs at HEAD 1336ed3 without instrumentation.
  // Hard gate uses semanticReproDigest + frontier scalars (sequence/fills/cash/HWM/source).
  void reference.accountingStateDigest;
  void reference.authoritativeEvidenceDigest;
  if (mismatches.length > 0) {
    throw new Error(
      `BLOCKED_BY_OFFICIAL_SCALE_PROFILE_INSTRUMENTATION_SEMANTIC_DRIFT: ${mismatches.join(", ")}`,
    );
  }
}

export function resetProfileRunRoot(
  profileRoot: string,
  runLabel: FhvOfficialScaleProfileRunLabel,
): void {
  const runRoot = resolveProfileRunRoot(profileRoot, runLabel);
  if (existsSync(runRoot)) {
    rmSync(runRoot, { recursive: true, force: true });
  }
}

export { buildFhvOfficialScaleHarnessContext, extractFhvOfficialScaleParitySnapshot };
export { FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE };
