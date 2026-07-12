import { existsSync } from "node:fs";

import {
  ReplayCheckpointError,
  readReplayRunChainManifest,
  type ReplayRunChainManifest,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";
import { StreamingEvidenceReader } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reader";
import type { ReplayCycleEvidenceProjection } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

export type ReplayRunChainReadResult = {
  manifest: ReplayRunChainManifest;
  projections: ReplayCycleEvidenceProjection[];
  semanticParityDigest: string;
};

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

  const projections: ReplayCycleEvidenceProjection[] = [];
  let priorChainDigest: string | null = null;
  let expectedCycleIndex = 0;

  for (const segment of manifest.segments) {
    if (!existsSync(segment.runDir)) {
      throw new ReplayCheckpointError(
        "REPLAY_RUN_CHAIN_INVALID",
        `segment runDir missing: ${segment.runDir}`,
      );
    }
    verifySegmentLink(segment, priorChainDigest);
    const reader = new StreamingEvidenceReader(segment.runDir);
    for (const projection of reader.iterateProjections()) {
      if (projection.cycleIndex !== expectedCycleIndex) {
        throw new ReplayCheckpointError(
          "REPLAY_PHASE_CYCLE_GAP",
          `cycle gap/overlap at index ${projection.cycleIndex}, expected ${expectedCycleIndex}`,
        );
      }
      projections.push(projection);
      expectedCycleIndex += 1;
    }
    priorChainDigest = segment.chainDigest;
  }

  const semanticParityDigest = computePayloadDigest(
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

  const composedChainDigest = computePayloadDigest(
    manifest.segments.map((segment) => segment.chainDigest),
  );
  if (composedChainDigest !== manifest.composedChainDigest) {
    throw new ReplayCheckpointError("REPLAY_RUN_CHAIN_INVALID", "composed chain digest mismatch");
  }

  return { manifest, projections, semanticParityDigest };
}

export const ReplayRunChainReader = {
  read: readReplayRunChainProjections,
};
