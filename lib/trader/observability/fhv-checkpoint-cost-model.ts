import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

/**
 * FHV checkpoint cost model (WP-3A instrumentation, WP-3B gate).
 *
 * Per-epoch checkpoint cost is Theta(session database size): WAL truncate, a full copy into an
 * exclusive temp file, a streaming SHA-256 over every byte, a second copy into the epoch bundle,
 * and an fsync. Because the session database grows monotonically (~321 bytes/cycle measured on
 * PR452 run 31011816726), cumulative checkpoint I/O is quadratic in run length: 32 ms at 3.4 MB
 * versus 7,647 ms at 1.17 GB.
 *
 * This module measures that curve directly so a regression fails a ten-minute gate instead of a
 * two-hour full-corpus job. It reproduces the production snapshot sequence in
 * `captureSessionDatabaseBackup` and `copyFileExclusiveFsync` without running the engine.
 */

export const FHV_CHECKPOINT_COST_MODEL_SCHEMA = "fhv-checkpoint-cost-model/v1" as const;
export const FHV_CHECKPOINT_COST_MODEL_FILENAME = "fhv-checkpoint-cost-model.v1.json";

/** Human-approved blocking budget at 1-GB-equivalent qualification depth (plan section A-3). */
export const FHV_CHECKPOINT_BUDGET_MS_PER_10K = 400;

/** Human-approved engineering target at the same depth (non-blocking). */
export const FHV_CHECKPOINT_TARGET_MS_PER_10K = 250;

/** Qualification depth at which the budget applies. */
export const FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES = 1_073_741_824;

const DIGEST_CHUNK_BYTES = 1 << 20;

export type FhvCheckpointCostSampleV1 = Readonly<{
  sessionBytes: number;
  /** Full copy of the live database into an exclusive temp file. */
  snapshotDurationMs: number;
  /** Streaming SHA-256 over the snapshot. */
  digestDurationMs: number;
  /** Second copy into the epoch bundle plus fsync and atomic rename. */
  publishDurationMs: number;
  totalDurationMs: number;
  /** Whether the copy used a copy-on-write reflink (APFS/XFS) or a full byte copy (ext4). */
  ficloneSucceeded: boolean;
  effectiveBytesPerSecond: number;
}>;

export type FhvCheckpointCostModelV1 = Readonly<{
  schemaVersion: typeof FHV_CHECKPOINT_COST_MODEL_SCHEMA;
  capturedAtUtc: string;
  platform: string;
  samples: readonly FhvCheckpointCostSampleV1[];
  /** Least-squares slope in milliseconds per gigabyte of session database. */
  slopeMsPerGigabyte: number;
  /** Fixed per-checkpoint cost independent of database size. */
  interceptMs: number;
  /**
   * Growth exponent of duration versus size on a log-log fit.
   * ~1.0 is linear in size; > 1.15 means cost grows faster than the data does.
   */
  growthExponent: number;
  /** Modelled duration at {@link FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES}. */
  projectedDurationMsAtQualificationDepth: number;
  budgetMs: number;
  targetMs: number;
  withinBudget: boolean;
  withinTarget: boolean;
  ficloneSucceeded: boolean;
  classification:
    | "FHV_CHECKPOINT_COST_WITHIN_TARGET"
    | "FHV_CHECKPOINT_COST_WITHIN_BUDGET"
    | "FHV_CHECKPOINT_COST_BUDGET_EXCEEDED";
}>;

function sha256FileStreaming(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(DIGEST_CHUNK_BYTES);
    let offset = 0;
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, offset);
      if (read <= 0) {
        break;
      }
      hash.update(buffer.subarray(0, read));
      offset += read;
    }
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

/**
 * Measure one checkpoint snapshot against a real database file, reproducing the production
 * sequence: exclusive temp copy, streaming digest, bundle publish with fsync and atomic rename.
 */
export function measureFhvCheckpointSnapshotCost(input: {
  sessionPath: string;
  workDir: string;
}): FhvCheckpointCostSampleV1 {
  mkdirSync(input.workDir, { recursive: true });
  const sessionBytes = statSync(input.sessionPath).size;
  const tempBackupPath = join(input.workDir, `fhv-cost-snapshot-${process.pid}-${Date.now()}`);
  const bundlePath = join(input.workDir, "session.sqlite");
  const bundleTempPath = `${bundlePath}.tmp-${process.pid}`;

  let ficloneSucceeded = false;
  const snapshotStartedAt = performance.now();
  try {
    copyFileSync(input.sessionPath, tempBackupPath, fsConstants.COPYFILE_FICLONE);
    ficloneSucceeded = true;
  } catch {
    copyFileSync(input.sessionPath, tempBackupPath);
  }
  const snapshotDurationMs = performance.now() - snapshotStartedAt;

  const digestStartedAt = performance.now();
  sha256FileStreaming(tempBackupPath);
  const digestDurationMs = performance.now() - digestStartedAt;

  const publishStartedAt = performance.now();
  try {
    copyFileSync(tempBackupPath, bundleTempPath, fsConstants.COPYFILE_FICLONE);
  } catch {
    copyFileSync(tempBackupPath, bundleTempPath);
  }
  const fd = openSync(bundleTempPath, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(bundleTempPath, bundlePath);
  const publishDurationMs = performance.now() - publishStartedAt;

  rmSync(tempBackupPath, { force: true });
  rmSync(bundlePath, { force: true });

  const totalDurationMs = snapshotDurationMs + digestDurationMs + publishDurationMs;
  return {
    sessionBytes,
    snapshotDurationMs: Number(snapshotDurationMs.toFixed(3)),
    digestDurationMs: Number(digestDurationMs.toFixed(3)),
    publishDurationMs: Number(publishDurationMs.toFixed(3)),
    totalDurationMs: Number(totalDurationMs.toFixed(3)),
    ficloneSucceeded,
    effectiveBytesPerSecond:
      totalDurationMs > 0 ? Number((sessionBytes / (totalDurationMs / 1000)).toFixed(0)) : 0,
  };
}

function leastSquares(points: readonly (readonly [number, number])[]): {
  slope: number;
  intercept: number;
} {
  const n = points.length;
  if (n < 2) {
    return { slope: 0, intercept: points[0]?.[1] ?? 0 };
  }
  const sumX = points.reduce((acc, [x]) => acc + x, 0);
  const sumY = points.reduce((acc, [, y]) => acc + y, 0);
  const sumXy = points.reduce((acc, [x, y]) => acc + x * y, 0);
  const sumXx = points.reduce((acc, [x]) => acc + x * x, 0);
  const denominator = n * sumXx - sumX * sumX;
  if (Math.abs(denominator) < Number.EPSILON) {
    return { slope: 0, intercept: sumY / n };
  }
  const slope = (n * sumXy - sumX * sumY) / denominator;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

export function buildFhvCheckpointCostModel(
  samples: readonly FhvCheckpointCostSampleV1[],
): FhvCheckpointCostModelV1 {
  if (samples.length === 0) {
    throw new Error("BLOCKED_BY_FHV_CHECKPOINT_COST_MODEL_NO_SAMPLES");
  }
  const gigabyte = 1_073_741_824;
  const linear = leastSquares(
    samples.map((sample) => [sample.sessionBytes / gigabyte, sample.totalDurationMs] as const),
  );

  // Log-log slope: exponent of duration versus size. Linear-in-size cost gives ~1.0.
  const logPoints = samples
    .filter((sample) => sample.sessionBytes > 0 && sample.totalDurationMs > 0)
    .map((sample) => [Math.log(sample.sessionBytes), Math.log(sample.totalDurationMs)] as const);
  const growthExponent = logPoints.length >= 2 ? leastSquares(logPoints).slope : 0;

  const projected = Math.max(
    0,
    linear.intercept + linear.slope * (FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES / gigabyte),
  );
  const withinBudget = projected <= FHV_CHECKPOINT_BUDGET_MS_PER_10K;
  const withinTarget = projected <= FHV_CHECKPOINT_TARGET_MS_PER_10K;

  return {
    schemaVersion: FHV_CHECKPOINT_COST_MODEL_SCHEMA,
    capturedAtUtc: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    samples,
    slopeMsPerGigabyte: Number(linear.slope.toFixed(3)),
    interceptMs: Number(linear.intercept.toFixed(3)),
    growthExponent: Number(growthExponent.toFixed(4)),
    projectedDurationMsAtQualificationDepth: Number(projected.toFixed(3)),
    budgetMs: FHV_CHECKPOINT_BUDGET_MS_PER_10K,
    targetMs: FHV_CHECKPOINT_TARGET_MS_PER_10K,
    withinBudget,
    withinTarget,
    ficloneSucceeded: samples.every((sample) => sample.ficloneSucceeded),
    classification: withinTarget
      ? "FHV_CHECKPOINT_COST_WITHIN_TARGET"
      : withinBudget
        ? "FHV_CHECKPOINT_COST_WITHIN_BUDGET"
        : "FHV_CHECKPOINT_COST_BUDGET_EXCEEDED",
  };
}

/** Modelled checkpoint duration at an arbitrary session-database size. */
export function projectFhvCheckpointDurationMs(
  model: Pick<FhvCheckpointCostModelV1, "slopeMsPerGigabyte" | "interceptMs">,
  sessionBytes: number,
): number {
  return Math.max(0, model.interceptMs + model.slopeMsPerGigabyte * (sessionBytes / 1_073_741_824));
}
