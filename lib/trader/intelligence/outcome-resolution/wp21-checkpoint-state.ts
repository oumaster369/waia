import type { ReplayCheckpointRecord } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import type { CalibrationPartitionKey } from "@/lib/trader/intelligence/calibration/calibration.types";

export const WP21_CHECKPOINT_SCHEMA_EXTENSION = "htr-wp21-checkpoint/v1" as const;

export type Wp21CalibrationPartitionAccumulator = Readonly<{
  partition: CalibrationPartitionKey;
  sampleCount: number;
  scoringSampleCount: number;
  brierSum: string;
  logLossSum: string;
}>;

export type Wp21CheckpointState = Readonly<{
  schemaExtension: typeof WP21_CHECKPOINT_SCHEMA_EXTENSION;
  resolvedForecastOutcomeIds: readonly string[];
  resolvedHypothesisOutcomeIds: readonly string[];
  processedAbstentionDecisionIds: readonly string[];
  calibrationPartitionAccumulators: readonly Wp21CalibrationPartitionAccumulator[];
  confidenceUpdateIds: readonly string[];
  decayFrontier: Readonly<Record<string, number>>;
  lastEligibleResolutionTime: string | null;
  wp21SemanticDigests: Readonly<Record<string, string>>;
}>;

export type ReplayCheckpointRecordWithWp21 = ReplayCheckpointRecord & {
  wp21CheckpointState?: Wp21CheckpointState;
};

export function createEmptyWp21CheckpointState(): Wp21CheckpointState {
  return {
    schemaExtension: WP21_CHECKPOINT_SCHEMA_EXTENSION,
    resolvedForecastOutcomeIds: [],
    resolvedHypothesisOutcomeIds: [],
    processedAbstentionDecisionIds: [],
    calibrationPartitionAccumulators: [],
    confidenceUpdateIds: [],
    decayFrontier: {},
    lastEligibleResolutionTime: null,
    wp21SemanticDigests: {},
  };
}

export function mergeWp21CheckpointState(
  prior: Wp21CheckpointState | undefined,
  patch: Partial<Wp21CheckpointState>,
): Wp21CheckpointState {
  const base = prior ?? createEmptyWp21CheckpointState();
  return {
    ...base,
    ...patch,
    resolvedForecastOutcomeIds: patch.resolvedForecastOutcomeIds ?? base.resolvedForecastOutcomeIds,
    resolvedHypothesisOutcomeIds:
      patch.resolvedHypothesisOutcomeIds ?? base.resolvedHypothesisOutcomeIds,
    processedAbstentionDecisionIds:
      patch.processedAbstentionDecisionIds ?? base.processedAbstentionDecisionIds,
    calibrationPartitionAccumulators:
      patch.calibrationPartitionAccumulators ?? base.calibrationPartitionAccumulators,
    confidenceUpdateIds: patch.confidenceUpdateIds ?? base.confidenceUpdateIds,
    decayFrontier: { ...base.decayFrontier, ...(patch.decayFrontier ?? {}) },
    wp21SemanticDigests: { ...base.wp21SemanticDigests, ...(patch.wp21SemanticDigests ?? {}) },
  };
}
