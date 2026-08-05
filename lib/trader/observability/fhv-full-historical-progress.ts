import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getIdhpsSession } from "@/lib/trader/execution/idhps-session-registry";
import { getRawSqliteDatabase } from "@/db/client";
import { resolveFhvEpochCheckpointDir } from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";

export const FHV_FULL_HISTORICAL_PROGRESS_SCHEMA = "fhv-full-historical-progress/v1" as const;
export const FHV_FULL_HISTORICAL_PROGRESS_FILENAME = "fhv-full-historical-progress.v1.json";

/** Default observational progress interval (wall clock). Not a semantic gate. */
export const FHV_FULL_HISTORICAL_PROGRESS_INTERVAL_MS = 30_000;

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
 * Progress path lives at runDir root (outside checkpoints/ and evidence/epoch-* rotation).
 * A second copy is written under artifactRoot when provided (immutable CI staging source).
 */
export function resolveFhvFullHistoricalProgressPath(runDir: string): string {
  return join(runDir, FHV_FULL_HISTORICAL_PROGRESS_FILENAME);
}

export function createFhvFullHistoricalProgressReporter(input: {
  runDir: string;
  artifactRoot?: string;
  targetCycleCount?: number | null;
  intervalMs?: number;
}): FhvFullHistoricalProgressReporter {
  const startedAt = performance.now();
  const intervalMs = input.intervalMs ?? FHV_FULL_HISTORICAL_PROGRESS_INTERVAL_MS;
  const progressPath = resolveFhvFullHistoricalProgressPath(input.runDir);
  const artifactProgressPath = input.artifactRoot
    ? join(input.artifactRoot, FHV_FULL_HISTORICAL_PROGRESS_FILENAME)
    : null;

  let lastReportAt = 0;
  let checkpointCount = 0;
  let cumulativeCheckpointDurationMs = 0;
  let lastCheckpointDurationMs: number | null = null;
  let evidenceBytesWritten = 0;

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
    const estimatedRemainingSeconds =
      target != null && target > globalEventSequence && effectiveBarsPerSecond > 0
        ? (target - globalEventSequence) / effectiveBarsPerSecond
        : target != null && globalEventSequence >= target
          ? 0
          : null;
    const memory = process.memoryUsage();
    const idhps = getIdhpsSession();
    const lastFromSession = idhps?.checkpointBackupDurationMs ?? lastCheckpointDurationMs;

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
      sqliteDatabaseBytes: resolveSqliteBytes(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      estimatedRemainingSeconds:
        estimatedRemainingSeconds == null ? null : Number(estimatedRemainingSeconds.toFixed(1)),
      targetCycleCount: target,
    };
  };

  const persist = (progress: FhvFullHistoricalProgressV1): void => {
    try {
      writeFhvFullHistoricalProgressAtomic(progressPath, progress);
      if (artifactProgressPath) {
        writeFhvFullHistoricalProgressAtomic(artifactProgressPath, progress);
      }
      console.error(
        `[fhv-full-historical-progress] elapsed_s=${progress.elapsedSeconds} seq=${progress.globalEventSequence} pct=${progress.sourceProgressPct} epoch=${progress.currentEpochId} cps=${progress.effectiveBarsPerSecond} last_ckpt_ms=${progress.lastCheckpointDurationMs ?? "n/a"} cum_ckpt_ms=${progress.cumulativeCheckpointDurationMs} ckpt_n=${progress.checkpointCount} sqlite_b=${progress.sqliteDatabaseBytes ?? "n/a"} rss_b=${progress.rssBytes} eta_s=${progress.estimatedRemainingSeconds ?? "n/a"}`,
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
