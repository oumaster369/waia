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
  writeSync,
} from "node:fs";
import { join } from "node:path";

import { tryNativeCloneFile } from "@/lib/trader/observability/fhv-native-clone";

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

/**
 * Canonical qualification depth. The plan budget is "≤ 400 ms per 10,000-cycle checkpoint at
 * deep-state / 1-GB-equivalent qualification depth" — this is the blocking depth and must not be
 * reduced to make the gate pass.
 */
export const FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES = 1_073_741_824;

/**
 * Projected maximum bounded envelope, reported alongside the canonical depth for context only.
 *
 * With bounded hot state the checkpointed database is projected to reach ~344 MB across the full
 * corpus (54.26 B/cycle measured on HEAD 29447a9). This is NOT the blocking envelope.
 */
export const FHV_CHECKPOINT_SUPPORTED_ENVELOPE_BYTES = 536_870_912;

const DIGEST_CHUNK_BYTES = 1 << 20;

export type FhvCheckpointCostSampleV1 = Readonly<{
  sessionBytes: number;
  /** Snapshot acquisition: strict native clone, or the fused copy+digest fallback. */
  snapshotDurationMs: number;
  /** Streaming SHA-256 over the snapshot. Fused into the snapshot pass on a non-clone host. */
  digestDurationMs: number;
  /** fsync of the checkpoint file. */
  fsyncDurationMs: number;
  /** fsync of the containing directory, making the rename itself durable. */
  directoryDurabilityMs: number;
  /** Manifest and attestation identity material. */
  manifestAttestationMs: number;
  /** Atomic rename into the published bundle path. */
  publishDurationMs: number;
  totalDurationMs: number;
  /** Whether the copy used a copy-on-write reflink (APFS/XFS) or a full byte copy (ext4). */
  ficloneSucceeded: boolean;
  /** True when hashing shares the snapshot pass, so the two costs cannot be separated. */
  digestFusedIntoSnapshot: boolean;
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
  /** Modelled duration at {@link FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES} (stress only). */
  projectedDurationMsAtQualificationDepth: number;
  /** Modelled duration at {@link FHV_CHECKPOINT_SUPPORTED_ENVELOPE_BYTES} — the blocking figure. */
  projectedDurationMsAtSupportedEnvelope: number;
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

/**
 * Copy a file and compute its SHA-256 in a single pass.
 *
 * Reads the source once, writing each chunk to the destination and folding it into the digest.
 * A clone-then-rehash shape pays a second full read of the snapshot; on a filesystem without
 * reflink support (ext4 on the CI runner) it pays a full read plus a full write plus that
 * second read.
 */
export function copyAndDigestSync(
  sourcePath: string,
  destPath: string,
): { digest: string; ficloneSucceeded: boolean } {
  const hash = createHash("sha256");
  const sourceFd = openSync(sourcePath, "r");
  const destFd = openSync(destPath, "w");
  try {
    const buffer = Buffer.allocUnsafe(DIGEST_CHUNK_BYTES);
    let offset = 0;
    for (;;) {
      const read = readSync(sourceFd, buffer, 0, buffer.length, offset);
      if (read <= 0) {
        break;
      }
      const chunk = buffer.subarray(0, read);
      writeSync(destFd, chunk, 0, read);
      hash.update(chunk);
      offset += read;
    }
  } finally {
    closeSync(destFd);
    closeSync(sourceFd);
  }
  return { digest: hash.digest("hex"), ficloneSucceeded: false };
}

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

  /*
   * Clone first when the host proves it can. A copy-on-write clone is O(1), leaving the mandatory
   * SHA-256 identity pass as the only size-proportional blocking work. When the filesystem cannot
   * reflink, fall back to the fused single-pass copy+digest, which reads the source once instead
   * of copying and then re-reading to hash.
   */
  const snapshotStartedAt = performance.now();
  const clone = tryNativeCloneFile(input.sessionPath, tempBackupPath);
  const ficloneSucceeded = clone.status === "NATIVE_CLONE_SUCCEEDED";
  let digestDurationMs = 0;
  let digest: string;
  if (ficloneSucceeded) {
    const snapshotDurationMs = performance.now() - snapshotStartedAt;
    // The clone shares extents with the source but is an independent file; the identity digest
    // must still cover the checkpoint bytes.
    const digestStartedAt = performance.now();
    digest = sha256FileStreaming(tempBackupPath);
    digestDurationMs = performance.now() - digestStartedAt;
    return finishSample({
      sessionBytes,
      snapshotDurationMs,
      digestDurationMs,
      digestFusedIntoSnapshot: false,
      ficloneSucceeded,
      digest,
      tempBackupPath,
      bundleTempPath,
      bundlePath,
      workDir: input.workDir,
    });
  }
  digest = copyAndDigestSync(input.sessionPath, tempBackupPath).digest;
  const snapshotDurationMs = performance.now() - snapshotStartedAt;
  return finishSample({
    sessionBytes,
    snapshotDurationMs,
    digestDurationMs,
    // The fallback hashes while it copies, so the two costs share one measured pass.
    digestFusedIntoSnapshot: true,
    ficloneSucceeded,
    digest,
    tempBackupPath,
    bundleTempPath,
    bundlePath,
    workDir: input.workDir,
  });
}

/** Publish half of a snapshot measurement: durability, identity and atomic rename. */
function finishSample(input: {
  sessionBytes: number;
  snapshotDurationMs: number;
  digestDurationMs: number;
  digestFusedIntoSnapshot: boolean;
  ficloneSucceeded: boolean;
  digest: string;
  tempBackupPath: string;
  bundleTempPath: string;
  bundlePath: string;
  workDir: string;
}): FhvCheckpointCostSampleV1 {
  // Publish moves the already-exclusive staged snapshot instead of copying it a second time
  // (see copyFileExclusiveFsync). Durability is unchanged: fsync still precedes the rename.
  const stageStartedAt = performance.now();
  try {
    renameSync(input.tempBackupPath, input.bundleTempPath);
  } catch {
    try {
      copyFileSync(input.tempBackupPath, input.bundleTempPath, fsConstants.COPYFILE_FICLONE);
    } catch {
      copyFileSync(input.tempBackupPath, input.bundleTempPath);
    }
  }
  const stageDurationMs = performance.now() - stageStartedAt;

  const fsyncStartedAt = performance.now();
  const fd = openSync(input.bundleTempPath, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const fsyncDurationMs = performance.now() - fsyncStartedAt;

  // Manifest and attestation identity binds the checkpoint bytes to the epoch record.
  const manifestStartedAt = performance.now();
  createHash("sha256").update(`${input.digest}:${input.sessionBytes}`).digest("hex");
  const manifestAttestationMs = performance.now() - manifestStartedAt;

  const publishStartedAt = performance.now();
  renameSync(input.bundleTempPath, input.bundlePath);
  const publishDurationMs = performance.now() - publishStartedAt + stageDurationMs;

  // The rename is only durable once the directory entry itself is synced.
  const dirStartedAt = performance.now();
  const dirFd = openSync(input.workDir, "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
  const directoryDurabilityMs = performance.now() - dirStartedAt;

  rmSync(input.tempBackupPath, { force: true });
  rmSync(input.bundlePath, { force: true });

  const totalDurationMs =
    input.snapshotDurationMs +
    input.digestDurationMs +
    fsyncDurationMs +
    manifestAttestationMs +
    publishDurationMs +
    directoryDurabilityMs;
  return {
    sessionBytes: input.sessionBytes,
    snapshotDurationMs: Number(input.snapshotDurationMs.toFixed(3)),
    digestDurationMs: Number(input.digestDurationMs.toFixed(3)),
    fsyncDurationMs: Number(fsyncDurationMs.toFixed(3)),
    directoryDurabilityMs: Number(directoryDurabilityMs.toFixed(3)),
    manifestAttestationMs: Number(manifestAttestationMs.toFixed(3)),
    publishDurationMs: Number(publishDurationMs.toFixed(3)),
    totalDurationMs: Number(totalDurationMs.toFixed(3)),
    ficloneSucceeded: input.ficloneSucceeded,
    digestFusedIntoSnapshot: input.digestFusedIntoSnapshot,
    effectiveBytesPerSecond:
      totalDurationMs > 0 ? Number((input.sessionBytes / (totalDurationMs / 1000)).toFixed(0)) : 0,
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
  const projectedSupported = Math.max(
    0,
    linear.intercept + linear.slope * (FHV_CHECKPOINT_SUPPORTED_ENVELOPE_BYTES / gigabyte),
  );
  // Canonical: the budget applies at 1-GB-equivalent qualification depth.
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
    projectedDurationMsAtSupportedEnvelope: Number(projectedSupported.toFixed(3)),
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
