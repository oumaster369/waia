/**
 * HTR-WP21 — human-approved epistemic scoring contract (D-18 consumed).
 * Values frozen at Macro-I approval; do not mutate without re-approval.
 */

export const EPISTEMIC_MIN_CALIBRATION_SAMPLES = 30 as const;

export const EPISTEMIC_LOG_LOSS_EPSILON = "0.000000000001" as const;

export const EPISTEMIC_CALIBRATION_WINDOW = "FULL_RUN_CUMULATIVE" as const;

export const EPISTEMIC_CONFIDENCE_UPDATE_CAP = "0.0500" as const;

export const EPISTEMIC_CONFIDENCE_DECAY_HALF_LIFE_BARS = 120 as const;

export const EPISTEMIC_CONFIDENCE_BOUNDS = {
  min: "0.0000",
  max: "1.0000",
} as const;

export const EPISTEMIC_CALIBRATION_PARTITION_DIMENSIONS = [
  "forecast_model_version",
  "regime",
  "horizon",
] as const;

export type EpistemicCalibrationPartitionDimension =
  (typeof EPISTEMIC_CALIBRATION_PARTITION_DIMENSIONS)[number];

/** Same-run decision authority must not drive epistemic closure scoring. */
export const EPISTEMIC_SAME_RUN_DECISION_AUTHORITY_PROHIBITED = true as const;

export const EPISTEMIC_NUMERIC_PRECISION_DP = 4 as const;

export const EPISTEMIC_PROBABILITY_SOURCE = "forecast_confidence_json.confidence_value" as const;
