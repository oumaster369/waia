/** PIT-valid DEVELOPMENT SOURCE anchor with resolved 13-D outcome vector. */
export type SourceAnchor = {
  venue: string;
  market: string;
  symbol: string;
  closedBarEpochMs: number;
  barContentDigest: string;
  realizedVol20m_1m: number;
  outcome13d: readonly number[];
};

export type PoolObservation = {
  resamplePositionOrdinal: number;
  anchor: SourceAnchor;
};

export const FEATURE_VERSION = "feature-engine/rv/v2" as const;
export const OUTCOME_VERSION = "exec-opp-outcome/v1" as const;
export const STATE_ASSIGNMENT_VERSION = "rv-state-tertile/v1" as const;
export const STATE_EDGES_VERSION = "type7-tertile/v1" as const;
export const POOL_SEM_VERSION = "pool-sem/v1" as const;
export const REPLICA_ARTIFACT_VERSION = "replica-artifact/v1" as const;
export const FIT_PARTITION_DEVELOPMENT = "development" as const;

export const MIN_STATE_POOL_COUNT = 30 as const;
export const FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT =
  "FORECAST_EPISTEMIC_STATE_POOL_INSUFFICIENT" as const;
export const FORECAST_EPISTEMIC_REPLICA_INVALID = "FORECAST_EPISTEMIC_REPLICA_INVALID" as const;
export const FORECAST_DISTRIBUTION_REPLAY_MISMATCH =
  "FORECAST_DISTRIBUTION_REPLAY_MISMATCH" as const;
export const FORECAST_POOL_REPLAY_MISMATCH = "FORECAST_POOL_REPLAY_MISMATCH" as const;
