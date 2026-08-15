import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { getIdhpsSession } from "@/lib/trader/execution/idhps-session-registry";
import { getRawSqliteDatabase } from "@/db/client";
import { resolveFhvEpochCheckpointDir } from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";

export const FHV_FULL_HISTORICAL_PROGRESS_SCHEMA = "fhv-full-historical-progress/v1" as const;
export const FHV_FULL_HISTORICAL_PROGRESS_FILENAME = "fhv-full-historical-progress.v1.json";
/** Append-only time series. The snapshot file is overwritten; this survives SIGKILL. */
export const FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME = "fhv-full-historical-progress.v1.jsonl";

/** Default observational progress interval (wall clock). Not a semantic gate. */
export const FHV_FULL_HISTORICAL_PROGRESS_INTERVAL_MS = 30_000;

/** Samples retained for the rolling-rate window. */
export const FHV_FULL_HISTORICAL_PROGRESS_ROLLING_SAMPLES = 5;

/** Hot-path amortization: observational reports fire at most once per this many cycles. */
export const FHV_FULL_HISTORICAL_PROGRESS_CYCLE_AMORTIZATION = 256;

/**
 * Observational sampling interval override.
 *
 * Bounded diagnostic segments finish in seconds, so the 30s default yields too few windows to
 * assess decay. Reporting cadence only — it changes no engine semantics.
 */
export function resolveFhvFullHistoricalProgressIntervalMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.FHV_IDHPS_PROGRESS_INTERVAL_MS;
  if (raw == null || raw === "") {
    return FHV_FULL_HISTORICAL_PROGRESS_INTERVAL_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : FHV_FULL_HISTORICAL_PROGRESS_INTERVAL_MS;
}

export type FhvFullHistoricalProgressV1 = Readonly<{
  schemaVersion: typeof FHV_FULL_HISTORICAL_PROGRESS_SCHEMA;
  capturedAtUtc: string;
  elapsedSeconds: number;
  globalEventSequence: number;
  sourceProgressPct: number;
  currentEpochId: number;
  currentCycleCount: number;
  effectiveBarsPerSecond: number;
  lastCheckpointDurationMs: number | null;
  cumulativeCheckpointDurationMs: number;
  checkpointCount: number;
  evidenceBytesWritten: number | null;
  sqliteDatabaseBytes: number | null;
  rssBytes: number;
  heapUsedBytes: number;
  estimatedRemainingSeconds: number | null;
  targetCycleCount: number | null;

  /*
   * WP-1 additive fields.
   *
   * `effectiveBarsPerSecond` and the legacy ETA are lifetime averages. On a decaying run the
   * lifetime average over-reports throughput and under-reports remaining time (PR452: 3851 s
   * reported against ~5415 s implied by the terminal rate). Rolling and window rates are
   * reported alongside so the optimism is visible rather than hidden.
   */
  /** Rate over the last {@link FHV_FULL_HISTORICAL_PROGRESS_ROLLING_SAMPLES} samples. */
  rollingBarsPerSecond: number | null;
  /** Rate since the previous sample only. */
  windowBarsPerSecond: number | null;
  /** Lifetime rate with cumulative checkpoint time subtracted. */
  checkpointExcludedBarsPerSecond: number | null;
  /** Window rate with window checkpoint time subtracted. */
  windowCheckpointExcludedBarsPerSecond: number | null;
  /** Remaining time derived from the lifetime average (retained for comparison). */
  estimatedRemainingSecondsLifetimeAverage: number | null;
  /** Total runtime projected from the rolling rate. */
  projectedTotalRuntimeSecondsRolling: number | null;
  /** Bytes of the session database copied by the last checkpoint. */
  lastCheckpointBytes: number | null;
  /** Effective snapshot throughput of the last checkpoint. */
  checkpointBytesPerSecond: number | null;
  /** Growth law input: session database bytes added per cycle over the window. */
  sessionDatabaseGrowthBytesPerCycle: number | null;
  /** Whether the last session snapshot used a copy-on-write reflink (APFS/XFS) or a full copy. */
  ficloneSucceeded: boolean | null;
}>;

export type FhvFullHistoricalProgressReporter = {
  noteCheckpoint(durationMs: number): void;
  noteEvidenceBytes(deltaBytes: number): void;
  maybeReport(input: {
    cycleCount: number;
    epochId: number;
    globalEventSequence?: number;
  }): FhvFullHistoricalProgressV1 | null;
  forceReport(input: {
    cycleCount: number;
    epochId: number;
    globalEventSequence?: number;
  }): FhvFullHistoricalProgressV1;
  progressPath: string;
};

function directoryBytesShallow(dir: string): number {
  if (!existsSync(dir)) {
    return 0;
  }
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    try {
      total += statSync(join(dir, entry.name)).size;
    } catch {
      // Observational only — race with retention/rotation is acceptable.
    }
  }
  return total;
}

function resolveSqliteBytes(): number | null {
  try {
    const sqlite = getRawSqliteDatabase();
    if (!sqlite?.name || !existsSync(sqlite.name)) {
      return null;
    }
    return statSync(sqlite.name).size;
  } catch {
    return null;
  }
}

function resolveRetainedCheckpointBytes(runDir: string, epochId: number): number {
  let total = 0;
  for (const id of [epochId, epochId - 1]) {
    if (id < 0) continue;
    const dir = resolveFhvEpochCheckpointDir(runDir, id);
    if (!existsSync(dir)) continue;
    total += directoryBytesShallow(dir);
  }
  return total;
}

/** Atomic replace via temp+rename (observational; never throws into hot path). */
export function writeFhvFullHistoricalProgressAtomic(
  progressPath: string,
  progress: FhvFullHistoricalProgressV1,
): void {
  const directory = dirname(progressPath);
  mkdirSync(directory, { recursive: true });
  const tempPath = join(
    directory,
    `.${FHV_FULL_HISTORICAL_PROGRESS_FILENAME}.tmp-${process.pid}-${Date.now()}`,
  );
  const payload = `${JSON.stringify(progress, null, 2)}\n`;
  writeFileSync(tempPath, payload, "utf8");
  renameSync(tempPath, progressPath);
}

/**
 * Append one durable time-series record.
 *
 * `O_APPEND` + `fsync` so the series survives a SIGKILL at the CI step timeout — the failure
 * mode that left run 31011816726 with a single snapshot and no decay curve.
 */
export function appendFhvFullHistoricalProgressJsonl(
  jsonlPath: string,
  progress: FhvFullHistoricalProgressV1,
): void {
  mkdirSync(dirname(jsonlPath), { recursive: true });
  const fd = openSync(jsonlPath, "a");
  try {
    writeSync(fd, `${JSON.stringify(progress)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Progress path lives at runDir root (outside checkpoints/ and evidence/epoch-* rotation).
 * A second copy is written under artifactRoot when provided (immutable CI staging source).
 */
export function resolveFhvFullHistoricalProgressPath(runDir: string): string {
  return join(runDir, FHV_FULL_HISTORICAL_PROGRESS_FILENAME);
}

export function resolveFhvFullHistoricalProgressJsonlPath(runDir: string): string {
  return join(runDir, FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME);
}

export function createFhvFullHistoricalProgressReporter(input: {
  runDir: string;
  artifactRoot?: string;
  targetCycleCount?: number | null;
  intervalMs?: number;
}): FhvFullHistoricalProgressReporter {
  const startedAt = performance.now();
  const intervalMs = input.intervalMs ?? resolveFhvFullHistoricalProgressIntervalMs();
  const progressPath = resolveFhvFullHistoricalProgressPath(input.runDir);
  const jsonlPath = resolveFhvFullHistoricalProgressJsonlPath(input.runDir);
  const artifactProgressPath = input.artifactRoot
    ? join(input.artifactRoot, FHV_FULL_HISTORICAL_PROGRESS_FILENAME)
    : null;
  const artifactJsonlPath = input.artifactRoot
    ? join(input.artifactRoot, FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME)
    : null;

  let lastReportAt = 0;
  let checkpointCount = 0;
  let cumulativeCheckpointDurationMs = 0;
  let lastCheckpointDurationMs: number | null = null;
  let evidenceBytesWritten = 0;

  type RateSample = {
    elapsedSeconds: number;
    globalEventSequence: number;
    cumulativeCheckpointSeconds: number;
    sqliteDatabaseBytes: number | null;
  };
  const rateSamples: RateSample[] = [];

  const positiveOrNull = (value: number): number | null =>
    Number.isFinite(value) && value > 0 ? Number(value.toFixed(3)) : null;

  const build = (sample: {
    cycleCount: number;
    epochId: number;
    globalEventSequence?: number;
  }): FhvFullHistoricalProgressV1 => {
    const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
    const globalEventSequence = sample.globalEventSequence ?? sample.cycleCount;
    const target = input.targetCycleCount ?? null;
    const sourceProgressPct =
      target != null && target > 0 ? Math.min(100, (globalEventSequence / target) * 100) : 0;
    const effectiveBarsPerSecond = globalEventSequence / elapsedSeconds;
    const estimatedRemainingSecondsLifetimeAverage =
      target != null && target > globalEventSequence && effectiveBarsPerSecond > 0
        ? (target - globalEventSequence) / effectiveBarsPerSecond
        : target != null && globalEventSequence >= target
          ? 0
          : null;
    const memory = process.memoryUsage();
    const idhps = getIdhpsSession();
    const lastFromSession = idhps?.checkpointBackupDurationMs ?? lastCheckpointDurationMs;
    const sqliteDatabaseBytes = resolveSqliteBytes();

    const cumulativeCheckpointSeconds = cumulativeCheckpointDurationMs / 1000;
    const previous = rateSamples.length > 0 ? rateSamples[rateSamples.length - 1] : null;
    const oldest = rateSamples.length > 0 ? rateSamples[0] : null;

    let rollingBarsPerSecond: number | null = null;
    if (oldest) {
      const deltaSeconds = elapsedSeconds - oldest.elapsedSeconds;
      const deltaSeq = globalEventSequence - oldest.globalEventSequence;
      rollingBarsPerSecond = deltaSeconds > 0 ? positiveOrNull(deltaSeq / deltaSeconds) : null;
    }

    let windowBarsPerSecond: number | null = null;
    let windowCheckpointExcludedBarsPerSecond: number | null = null;
    let sessionDatabaseGrowthBytesPerCycle: number | null = null;
    if (previous) {
      const deltaSeconds = elapsedSeconds - previous.elapsedSeconds;
      const deltaSeq = globalEventSequence - previous.globalEventSequence;
      if (deltaSeconds > 0) {
        windowBarsPerSecond = positiveOrNull(deltaSeq / deltaSeconds);
      }
      const deltaCheckpointSeconds =
        cumulativeCheckpointSeconds - previous.cumulativeCheckpointSeconds;
      const deltaHotSeconds = deltaSeconds - deltaCheckpointSeconds;
      if (deltaHotSeconds > 0) {
        windowCheckpointExcludedBarsPerSecond = positiveOrNull(deltaSeq / deltaHotSeconds);
      }
      if (
        sqliteDatabaseBytes != null &&
        previous.sqliteDatabaseBytes != null &&
        deltaSeq > 0 &&
        sqliteDatabaseBytes >= previous.sqliteDatabaseBytes
      ) {
        sessionDatabaseGrowthBytesPerCycle = Number(
          ((sqliteDatabaseBytes - previous.sqliteDatabaseBytes) / deltaSeq).toFixed(3),
        );
      }
    }

    const hotSeconds = elapsedSeconds - cumulativeCheckpointSeconds;
    const checkpointExcludedBarsPerSecond =
      hotSeconds > 0 ? positiveOrNull(globalEventSequence / hotSeconds) : null;

    // Prefer the rolling rate: a lifetime average hides decay.
    const projectionCps = rollingBarsPerSecond ?? effectiveBarsPerSecond;
    const estimatedRemainingSeconds =
      target != null && target > globalEventSequence && projectionCps > 0
        ? (target - globalEventSequence) / projectionCps
        : target != null && globalEventSequence >= target
          ? 0
          : null;
    const projectedTotalRuntimeSecondsRolling =
      estimatedRemainingSeconds == null ? null : elapsedSeconds + estimatedRemainingSeconds;

    const lastCheckpointBytes = idhps?.checkpointSessionBytes ?? null;
    const checkpointBytesPerSecond =
      lastCheckpointBytes != null && lastFromSession != null && lastFromSession > 0
        ? Number((lastCheckpointBytes / (lastFromSession / 1000)).toFixed(3))
        : null;

    rateSamples.push({
      elapsedSeconds,
      globalEventSequence,
      cumulativeCheckpointSeconds,
      sqliteDatabaseBytes,
    });
    if (rateSamples.length > FHV_FULL_HISTORICAL_PROGRESS_ROLLING_SAMPLES) {
      rateSamples.shift();
    }

    // Cheap shallow sizes only — never walk the full evidence tree.
    const currentEvidenceDir = join(
      input.runDir,
      "evidence",
      `epoch-${sample.epochId}`,
      "generation-1",
      "chunks",
    );
    const evidenceSampleBytes =
      evidenceBytesWritten > 0
        ? evidenceBytesWritten
        : directoryBytesShallow(currentEvidenceDir) +
          resolveRetainedCheckpointBytes(input.runDir, sample.epochId);

    return {
      schemaVersion: FHV_FULL_HISTORICAL_PROGRESS_SCHEMA,
      capturedAtUtc: new Date().toISOString(),
      elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
      globalEventSequence,
      sourceProgressPct: Number(sourceProgressPct.toFixed(3)),
      currentEpochId: sample.epochId,
      currentCycleCount: sample.cycleCount,
      effectiveBarsPerSecond: Number(effectiveBarsPerSecond.toFixed(3)),
      lastCheckpointDurationMs: lastFromSession,
      cumulativeCheckpointDurationMs: Number(cumulativeCheckpointDurationMs.toFixed(3)),
      checkpointCount,
      evidenceBytesWritten: evidenceSampleBytes > 0 ? evidenceSampleBytes : null,
      sqliteDatabaseBytes,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      estimatedRemainingSeconds:
        estimatedRemainingSeconds == null ? null : Number(estimatedRemainingSeconds.toFixed(1)),
      targetCycleCount: target,
      rollingBarsPerSecond,
      windowBarsPerSecond,
      checkpointExcludedBarsPerSecond,
      windowCheckpointExcludedBarsPerSecond,
      estimatedRemainingSecondsLifetimeAverage:
        estimatedRemainingSecondsLifetimeAverage == null
          ? null
          : Number(estimatedRemainingSecondsLifetimeAverage.toFixed(1)),
      projectedTotalRuntimeSecondsRolling:
        projectedTotalRuntimeSecondsRolling == null
          ? null
          : Number(projectedTotalRuntimeSecondsRolling.toFixed(1)),
      lastCheckpointBytes,
      checkpointBytesPerSecond,
      sessionDatabaseGrowthBytesPerCycle,
      ficloneSucceeded: idhps?.checkpointFicloneSucceeded ?? null,
    };
  };

  const persist = (progress: FhvFullHistoricalProgressV1): void => {
    try {
      writeFhvFullHistoricalProgressAtomic(progressPath, progress);
      appendFhvFullHistoricalProgressJsonl(jsonlPath, progress);
      if (artifactProgressPath) {
        writeFhvFullHistoricalProgressAtomic(artifactProgressPath, progress);
      }
      if (artifactJsonlPath) {
        appendFhvFullHistoricalProgressJsonl(artifactJsonlPath, progress);
      }
      // Direct stderr write: Vitest intercepts and defers console.*, so a SIGKILLed step
      // (PR452 run 31011816726) produced a completely silent 125-minute job log.
      process.stderr.write(
        `[fhv-full-historical-progress] elapsed_s=${progress.elapsedSeconds} seq=${progress.globalEventSequence} pct=${progress.sourceProgressPct} epoch=${progress.currentEpochId} cps=${progress.effectiveBarsPerSecond} roll_cps=${progress.rollingBarsPerSecond ?? "n/a"} hot_cps=${progress.checkpointExcludedBarsPerSecond ?? "n/a"} last_ckpt_ms=${progress.lastCheckpointDurationMs ?? "n/a"} ckpt_b=${progress.lastCheckpointBytes ?? "n/a"} ficlone=${progress.ficloneSucceeded ?? "n/a"} cum_ckpt_ms=${progress.cumulativeCheckpointDurationMs} ckpt_n=${progress.checkpointCount} sqlite_b=${progress.sqliteDatabaseBytes ?? "n/a"} rss_b=${progress.rssBytes} eta_s=${progress.estimatedRemainingSeconds ?? "n/a"} eta_lifetime_s=${progress.estimatedRemainingSecondsLifetimeAverage ?? "n/a"} proj_total_s=${progress.projectedTotalRuntimeSecondsRolling ?? "n/a"}\n`,
      );
    } catch {
      // Observational only — never fail the engine.
    }
  };

  return {
    progressPath,
    noteCheckpoint(durationMs: number) {
      checkpointCount += 1;
      cumulativeCheckpointDurationMs += durationMs;
      lastCheckpointDurationMs = durationMs;
    },
    noteEvidenceBytes(deltaBytes: number) {
      if (Number.isFinite(deltaBytes) && deltaBytes > 0) {
        evidenceBytesWritten += deltaBytes;
      }
    },
    maybeReport(sample) {
      // Amortize clock checks: only sample every 256 cycles on the hot path.
      if (
        sample.cycleCount > 0 &&
        sample.cycleCount % FHV_FULL_HISTORICAL_PROGRESS_CYCLE_AMORTIZATION !== 0
      ) {
        return null;
      }
      const now = performance.now();
      if (lastReportAt > 0 && now - lastReportAt < intervalMs) {
        return null;
      }
      lastReportAt = now;
      const progress = build(sample);
      persist(progress);
      return progress;
    },
    forceReport(sample) {
      lastReportAt = performance.now();
      const progress = build(sample);
      persist(progress);
      return progress;
    },
  };
}
