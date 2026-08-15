import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash, randomBytes } from "node:crypto";
import { closeSync, copyFileSync, fsyncSync, openSync, rmSync, statSync } from "node:fs";

import {
  FHV_CHECKPOINT_BUDGET_MS_PER_10K,
  FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES,
  type FhvCheckpointCostSampleV1,
} from "@/lib/trader/observability/fhv-checkpoint-cost-model";

/**
 * Target-host requirement calculation for the WP-3B split gate (ADR-0025 AD-6).
 *
 * The 1-GiB / 400 ms contract is host-class dependent: measured evidence on run 31098325969 showed
 * `macos-15` at 735-781 ms and `macos-15-intel` at 2743-3007 ms while this repository's reference
 * workstation reached 392-396 ms, with the entire spread attributable to single-stream SHA-256
 * throughput rather than to the checkpoint algorithm. Absolute wall clock therefore cannot decide
 * software correctness on a shared CI runner.
 *
 * This module separates the two questions. It derives what a host must deliver to satisfy the
 * unchanged 400 ms contract, and it measures the algorithm in units of the host's own hashing
 * speed so that a structural regression — a reintroduced second full pass, for instance — fails
 * everywhere, while a merely slow runner does not.
 */

const CALIBRATION_BYTES = 64 << 20;

/**
 * Cost of a clone-based GATE 1 capture expressed as multiples of structurally necessary work.
 *
 * A clone is O(1) and must not hash the destination on the blocking path. Reintroducing dest SHA
 * into GATE 1 is a structural regression (`digestPasses > 0`). GATE 2 still requires destination
 * SHA-256 before authority.
 */
export const FHV_CLONE_HOST_MAX_HASH_EQUIVALENT_PASSES = 1.45;

/**
 * Fallback ceiling, expressed against a same-host raw-copy plus hash baseline.
 *
 * The fallback also writes a full gigabyte, so normalizing it against hash speed alone conflates
 * CPU with storage bandwidth: it measured 1.55 hash-equivalent passes on fast local NVMe and 4.91
 * on a storage-bound GitHub runner, which is why a hash-only ceiling was wrong there. The
 * structurally necessary work on any host is one source read, one destination write and one
 * streamed digest, so the baseline is a raw durable copy plus one hash measured on that same host
 * and filesystem. A copy-then-rehash regression adds a further full read and exceeds it.
 */
export const FHV_FALLBACK_HOST_MAX_NECESSARY_WORK_RATIO = 1.35;

export type FhvTargetHostRequirementV1 = Readonly<{
  /** Sustained single-stream SHA-256 a host must deliver to meet the contract at 1 GiB. */
  requiredSingleStreamSha256BytesPerSecond: number;
  /** Budget left for clone, fsync, directory durability, manifest and publish. */
  maximumAllowedNonHashMilliseconds: number;
  requiredNativeCloneCapability: "NATIVE_CLONE_REQUIRED";
  requiredFilesystemSemantics: readonly string[];
  requiredCompleteCheckpointMilliseconds: typeof FHV_CHECKPOINT_BUDGET_MS_PER_10K;
  qualificationDepthBytes: typeof FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES;
}>;

/**
 * Measure this host's sustained single-stream SHA-256 throughput.
 *
 * Hashes an in-memory buffer so the result reflects CPU capability rather than storage, which is
 * what the requirement calculation needs to stay comparable across hosts.
 */
export function calibrateSingleStreamSha256BytesPerSecond(): number {
  const chunk = randomBytes(1 << 20);
  const hash = createHash("sha256");
  const startedAt = performance.now();
  for (let written = 0; written < CALIBRATION_BYTES; written += chunk.byteLength) {
    hash.update(chunk);
  }
  hash.digest();
  const elapsedMs = performance.now() - startedAt;
  return elapsedMs > 0 ? Number((CALIBRATION_BYTES / (elapsedMs / 1000)).toFixed(0)) : 0;
}

/**
 * Derive the host capability the unchanged 400 ms contract implies.
 *
 * Non-hash cost is taken from the measured samples rather than assumed, so a regression that adds
 * fixed overhead raises the required throughput and is caught by {@link FhvSoftwareGateResultV1}.
 */
export function computeFhvTargetHostRequirement(
  samples: readonly FhvCheckpointCostSampleV1[],
): FhvTargetHostRequirementV1 {
  const cloneSamples = samples.filter((sample) => sample.ficloneSucceeded);
  const basis = cloneSamples.length > 0 ? cloneSamples : samples;
  const worstNonHashMs = basis.reduce((worst, sample) => {
    const nonHashMs =
      (sample.digestFusedIntoSnapshot ? 0 : sample.snapshotDurationMs) +
      sample.fsyncDurationMs +
      sample.directoryDurabilityMs +
      sample.manifestAttestationMs +
      sample.publishDurationMs;
    return Math.max(worst, nonHashMs);
  }, 0);

  const hashBudgetMs = Math.max(1, FHV_CHECKPOINT_BUDGET_MS_PER_10K - worstNonHashMs);
  return {
    requiredSingleStreamSha256BytesPerSecond: Number(
      (FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES / (hashBudgetMs / 1000)).toFixed(0),
    ),
    maximumAllowedNonHashMilliseconds: Number(worstNonHashMs.toFixed(3)),
    requiredNativeCloneCapability: "NATIVE_CLONE_REQUIRED",
    requiredFilesystemSemantics: ["apfs", "xfs(reflink=1)", "btrfs", "zfs"],
    requiredCompleteCheckpointMilliseconds: FHV_CHECKPOINT_BUDGET_MS_PER_10K,
    qualificationDepthBytes: FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES,
  };
}

export type FhvSoftwareGateResultV1 = Readonly<{
  hostSha256BytesPerSecond: number;
  /** Work that is structurally necessary on this host: hash for a clone, copy+hash otherwise. */
  necessaryWorkMs: number;
  observedMs: number;
  necessaryWorkRatio: number;
  allowedNecessaryWorkRatio: number;
  nativeCloneObserved: boolean;
  /** A correct checkpoint reads the source once, writes the destination once and digests once. */
  sourceTraversals: number;
  destTraversals: number;
  digestPasses: number;
  traversalsSound: boolean;
  timingSound: boolean;
  structurallySound: boolean;
  requirement: FhvTargetHostRequirementV1;
  /** Whether this particular host could also satisfy the absolute 400 ms contract. */
  hostLaunchQualified: boolean;
}>;

/** A correct checkpoint never moves more than one copy of the session in either direction. */
const MAX_TRAVERSALS = 1.05;

/**
 * Judge the checkpoint algorithm independently of how fast this host happens to be.
 *
 * Two independent proofs must hold. Traversal accounting shows each byte is moved once; timing
 * shows the run does not cost materially more than the work that is structurally necessary on
 * this specific host and filesystem.
 *
 * Timing alone was not sufficient. Normalizing the fallback against hash speed conflated CPU with
 * storage bandwidth — the same code measured 1.55 hash-equivalent passes on local NVMe and 4.91 on
 * a storage-bound GitHub runner — so the fallback baseline now includes a real raw durable copy
 * measured on the destination filesystem.
 *
 * `structurallySound` is the merge-blocking signal. `hostLaunchQualified` is evidence about the
 * runner and must never fail a pull request: the absolute timing contract belongs to the
 * Execution Server preflight.
 */
export function evaluateFhvCheckpointSoftwareGate(input: {
  samples: readonly FhvCheckpointCostSampleV1[];
  hostSha256BytesPerSecond: number;
  /** Same-host, same-filesystem raw durable copy throughput. Required for the fallback branch. */
  hostRawCopyBytesPerSecond?: number;
}): FhvSoftwareGateResultV1 {
  const deepest = [...input.samples].sort((a, b) => b.sessionBytes - a.sessionBytes)[0];
  if (!deepest) {
    throw new Error("FHV_CHECKPOINT_SOFTWARE_GATE_REQUIRES_SAMPLES");
  }

  const rawCopyMs =
    input.hostRawCopyBytesPerSecond && input.hostRawCopyBytesPerSecond > 0
      ? (deepest.sessionBytes / input.hostRawCopyBytesPerSecond) * 1000
      : 0;

  // A clone is O(1) on GATE 1; dest SHA is GATE 2. The fallback must still move the bytes.
  const necessaryWorkMs = deepest.ficloneSucceeded
    ? Math.max(
        deepest.snapshotDurationMs + deepest.fsyncDurationMs + deepest.directoryDurabilityMs,
        0.01,
      )
    : rawCopyMs;
  const allowedNecessaryWorkRatio = deepest.ficloneSucceeded
    ? FHV_CLONE_HOST_MAX_HASH_EQUIVALENT_PASSES
    : FHV_FALLBACK_HOST_MAX_NECESSARY_WORK_RATIO;
  const necessaryWorkRatio =
    necessaryWorkMs > 0 ? Number((deepest.totalDurationMs / necessaryWorkMs).toFixed(4)) : 0;

  const traversalsSound = deepest.ficloneSucceeded
    ? deepest.sourceTraversals <= MAX_TRAVERSALS &&
      deepest.destTraversals <= 0.001 &&
      deepest.digestPasses <= 0.001
    : deepest.sourceTraversals <= MAX_TRAVERSALS &&
      deepest.destTraversals <= MAX_TRAVERSALS &&
      deepest.destTraversals > 0;

  const timingSound = deepest.ficloneSucceeded
    ? deepest.digestPasses <= 0.001 && deepest.digestDurationMs === 0
    : necessaryWorkRatio > 0 && necessaryWorkRatio <= allowedNecessaryWorkRatio;

  const requirement = computeFhvTargetHostRequirement(input.samples);
  return {
    hostSha256BytesPerSecond: input.hostSha256BytesPerSecond,
    necessaryWorkMs: Number(necessaryWorkMs.toFixed(3)),
    observedMs: deepest.totalDurationMs,
    necessaryWorkRatio,
    allowedNecessaryWorkRatio,
    nativeCloneObserved: deepest.ficloneSucceeded,
    sourceTraversals: deepest.sourceTraversals,
    destTraversals: deepest.destTraversals,
    digestPasses: deepest.digestPasses,
    traversalsSound,
    timingSound,
    structurallySound: traversalsSound && timingSound,
    requirement,
    hostLaunchQualified:
      deepest.ficloneSucceeded &&
      input.hostSha256BytesPerSecond >= requirement.requiredSingleStreamSha256BytesPerSecond,
  };
}

/**
 * Measure a raw durable copy on the destination filesystem.
 *
 * This is the storage half of the fallback baseline, so it must touch the filesystem the
 * checkpoint actually uses rather than being inferred from a memory benchmark.
 */
export function calibrateRawDurableCopyBytesPerSecond(input: {
  sourcePath: string;
  destPath: string;
}): number {
  const bytes = statSync(input.sourcePath).size;
  const startedAt = performance.now();
  copyFileSync(input.sourcePath, input.destPath);
  const fd = openSync(input.destPath, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const elapsedMs = performance.now() - startedAt;
  rmSync(input.destPath, { force: true });
  return elapsedMs > 0 ? Number((bytes / (elapsedMs / 1000)).toFixed(0)) : 0;
}
