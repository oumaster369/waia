import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash, randomBytes } from "node:crypto";

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
 * Cost of the checkpoint expressed as multiples of one SHA-256 pass over the same bytes.
 *
 * A clone-based checkpoint hashes once and does O(1) work besides, so it sits near 1.0 on every
 * host. Reintroducing a full byte copy pushes it toward 2.0, and the pre-WP-3B clone-then-rehash
 * shape sat near 3.0. Because the unit is the host's own hash speed, the ceiling means the same
 * thing on a fast workstation and a slow hosted runner.
 */
export const FHV_CLONE_HOST_MAX_HASH_EQUIVALENT_PASSES = 1.45;

/** Fallback hosts fuse one read, one write and the hash into a single pass. */
export const FHV_FALLBACK_HOST_MAX_HASH_EQUIVALENT_PASSES = 3.2;

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
  /** Checkpoint cost in multiples of one SHA-256 pass over the same bytes. */
  hashEquivalentPasses: number;
  allowedHashEquivalentPasses: number;
  nativeCloneObserved: boolean;
  structurallySound: boolean;
  requirement: FhvTargetHostRequirementV1;
  /** Whether this particular host could also satisfy the absolute 400 ms contract. */
  hostLaunchQualified: boolean;
}>;

/**
 * Judge the checkpoint algorithm independently of how fast this host happens to be.
 *
 * `structurallySound` is the merge-blocking signal. `hostLaunchQualified` is evidence about the
 * runner and must never fail a pull request: the absolute timing contract belongs to the
 * Execution Server preflight.
 */
export function evaluateFhvCheckpointSoftwareGate(input: {
  samples: readonly FhvCheckpointCostSampleV1[];
  hostSha256BytesPerSecond: number;
}): FhvSoftwareGateResultV1 {
  const deepest = [...input.samples].sort((a, b) => b.sessionBytes - a.sessionBytes)[0];
  if (!deepest) {
    throw new Error("FHV_CHECKPOINT_SOFTWARE_GATE_REQUIRES_SAMPLES");
  }

  const expectedHashMs =
    input.hostSha256BytesPerSecond > 0
      ? (deepest.sessionBytes / input.hostSha256BytesPerSecond) * 1000
      : 0;
  const hashEquivalentPasses =
    expectedHashMs > 0 ? Number((deepest.totalDurationMs / expectedHashMs).toFixed(4)) : 0;
  const allowedHashEquivalentPasses = deepest.ficloneSucceeded
    ? FHV_CLONE_HOST_MAX_HASH_EQUIVALENT_PASSES
    : FHV_FALLBACK_HOST_MAX_HASH_EQUIVALENT_PASSES;

  const requirement = computeFhvTargetHostRequirement(input.samples);
  return {
    hostSha256BytesPerSecond: input.hostSha256BytesPerSecond,
    hashEquivalentPasses,
    allowedHashEquivalentPasses,
    nativeCloneObserved: deepest.ficloneSucceeded,
    structurallySound:
      hashEquivalentPasses > 0 && hashEquivalentPasses <= allowedHashEquivalentPasses,
    requirement,
    hostLaunchQualified:
      deepest.ficloneSucceeded &&
      input.hostSha256BytesPerSecond >= requirement.requiredSingleStreamSha256BytesPerSecond,
  };
}
