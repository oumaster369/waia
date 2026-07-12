import { existsSync } from "node:fs";

import {
  ReplayCheckpointError,
  readReplayRunChainManifest,
  segmentRole,
  type ReplayRunChainManifest,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";
import { StreamingEvidenceReader } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reader";
import type { ReplayCycleEvidenceProjection } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

export type ReplayRunChainReadResult = {
  manifest: ReplayRunChainManifest;
  /** Composed authoritative projection stream in ascending cycleIndex order (no dup, no gap). */
  projections: ReplayCycleEvidenceProjection[];
  /** Digest of the normalized authoritative projection stream (see computeSemanticParityDigest). */
  semanticParityDigest: string;
  authoritativeCycleCount: number;
  authoritativeDuplicateCount: number;
  authoritativeGapCount: number;
  /** runDirs of preserved-but-superseded audit segments (immutable interrupted attempts). */
  supersededSegmentRunDirs: string[];
};

/**
 * Canonical semantic-parity digest over a normalized, ascending-cycle projection stream.
 *
 * Included: only replay-semantic cycle fields. Excluded: segment path/role/sequence, PID, wall-clock
 * timestamps unrelated to replay semantics, temporary filenames, recovery reports, host/environment
 * metadata (none of which are projection fields). Identical inputs (uninterrupted vs resumed composed)
 * MUST yield an identical digest. This is the single source of truth used by BOTH the uninterrupted and
 * the resumed paths so the comparison is like-for-like.
 */
export function computeSemanticParityDigest(
  projections: readonly ReplayCycleEvidenceProjection[],
): string {
  return computePayloadDigest(
    projections.map((projection) => ({
      cycleIndex: projection.cycleIndex,
      evaluatedAtMs: projection.evaluatedAtMs,
      regime: projection.regime,
      skipReason: projection.skipReason,
      strategyExecutions: projection.strategyExecutions,
      guardian: projection.guardian,
      msv: projection.msv,
      m9Trace: projection.m9Trace,
    })),
  );
}

/** Reads a single segment's projections in on-disk order (no cross-segment composition). */
export function readSegmentProjections(runDir: string): ReplayCycleEvidenceProjection[] {
  if (!existsSync(runDir)) {
    throw new ReplayCheckpointError(
      "REPLAY_RUN_CHAIN_INVALID",
      `segment runDir missing: ${runDir}`,
    );
  }
  return [...new StreamingEvidenceReader(runDir).iterateProjections()];
}

function verifySegmentLink(
  segment: ReplayRunChainManifest["segments"][number],
  priorChainDigest: string | null,
): void {
  if (segment.continuesFromChainDigest !== undefined) {
    if (priorChainDigest !== null && segment.continuesFromChainDigest !== priorChainDigest) {
      throw new ReplayCheckpointError(
        "REPLAY_RUN_CHAIN_INVALID",
        `segment chain link mismatch at ${segment.runDir}`,
      );
    }
  }
  const reconstruction = reconstructStreamingEvidence(segment.runDir);
  if (reconstruction.chainDigest !== segment.chainDigest) {
    throw new ReplayCheckpointError(
      "REPLAY_RUN_CHAIN_INVALID",
      `segment chain digest mismatch at ${segment.runDir}`,
    );
  }
}

export function readReplayRunChainProjections(runRootDir: string): ReplayRunChainReadResult {
  const manifest = readReplayRunChainManifest(runRootDir);
  if (!manifest) {
    throw new ReplayCheckpointError("REPLAY_RUN_CHAIN_INVALID", "missing run-chain manifest");
  }

  // Superseded audit segments: verified immutable + preserved, then EXCLUDED from composition.
  const supersededSegmentRunDirs: string[] = [];
  for (const segment of manifest.segments) {
    if (segmentRole(segment) !== "superseded") {
      continue;
    }
    if (!existsSync(segment.runDir)) {
      throw new ReplayCheckpointError(
        "REPLAY_RUN_CHAIN_INVALID",
        `superseded segment runDir missing: ${segment.runDir}`,
      );
    }
    const reconstruction = reconstructStreamingEvidence(segment.runDir);
    if (reconstruction.chainDigest !== segment.chainDigest) {
      throw new ReplayCheckpointError(
        "REPLAY_RUN_CHAIN_INVALID",
        `superseded segment mutated (chain digest mismatch) at ${segment.runDir}`,
      );
    }
    supersededSegmentRunDirs.push(segment.runDir);
  }

  // Authoritative stream: exactly one projection per expected cycle, ascending, no dup, no gap,
  // no overlap between two authoritative segments.
  const projections: ReplayCycleEvidenceProjection[] = [];
  let priorChainDigest: string | null = null;
  let expectedCycleIndex = 0;
  let duplicateCount = 0;
  let gapCount = 0;
  const seenCycleIndexes = new Set<number>();

  for (const segment of manifest.segments) {
    if (segmentRole(segment) !== "authoritative") {
      continue;
    }
    if (!existsSync(segment.runDir)) {
      throw new ReplayCheckpointError(
        "REPLAY_RUN_CHAIN_INVALID",
        `segment runDir missing: ${segment.runDir}`,
      );
    }
    verifySegmentLink(segment, priorChainDigest);
    const reader = new StreamingEvidenceReader(segment.runDir);
    for (const projection of reader.iterateProjections()) {
      if (seenCycleIndexes.has(projection.cycleIndex)) {
        duplicateCount += 1;
      }
      if (projection.cycleIndex !== expectedCycleIndex) {
        if (projection.cycleIndex > expectedCycleIndex) {
          gapCount += 1;
        }
        throw new ReplayCheckpointError(
          "REPLAY_PHASE_CYCLE_GAP",
          `authoritative cycle gap/overlap at index ${projection.cycleIndex}, expected ${expectedCycleIndex}`,
        );
      }
      seenCycleIndexes.add(projection.cycleIndex);
      projections.push(projection);
      expectedCycleIndex += 1;
    }
    priorChainDigest = segment.chainDigest;
  }

  const semanticParityDigest = computeSemanticParityDigest(projections);

  const composedChainDigest = computePayloadDigest(
    manifest.segments.map((segment) => segment.chainDigest),
  );
  if (composedChainDigest !== manifest.composedChainDigest) {
    throw new ReplayCheckpointError("REPLAY_RUN_CHAIN_INVALID", "composed chain digest mismatch");
  }

  return {
    manifest,
    projections,
    semanticParityDigest,
    authoritativeCycleCount: projections.length,
    authoritativeDuplicateCount: duplicateCount,
    authoritativeGapCount: gapCount,
    supersededSegmentRunDirs,
  };
}

export const ReplayRunChainReader = {
  read: readReplayRunChainProjections,
};
