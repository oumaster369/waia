import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import type { ReplayCycleEvidenceProjection } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";

/**
 * Canonical semantic-parity digest over a normalized, ascending-cycle projection stream.
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
