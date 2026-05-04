/** Twin base model questionnaire (DEE-24) — deterministic profile signals; no DB, no LLM. */

export const TWIN_BASE_MODEL_SCHEMA_VERSION = "twin-base-model-v1" as const;

export type TwinBaseModelSchemaVersion = typeof TWIN_BASE_MODEL_SCHEMA_VERSION;

/** Lexicographically sorted dimension keys (stable JSON key order). */
export const TWIN_BASE_MODEL_DIMENSIONS = [
  "avoidance_vs_confrontation",
  "consistency_vs_impulsiveness",
  "decision_style",
  "emotional_regulation",
  "goal_orientation_vs_drift",
  "self_trust_vs_external_validation",
] as const;

export type TwinBaseModelDimension = (typeof TWIN_BASE_MODEL_DIMENSIONS)[number];

export type TwinBaseModelOption = {
  value: string;
  /** Integer 0–4 inclusive; aggregated then divided by 4 for [0, 1] scale. */
  score: number;
  label: string;
};

export type TwinBaseModelQuestion = {
  id: string;
  dimension: TwinBaseModelDimension;
  prompt: string;
  options: TwinBaseModelOption[];
};

export type TwinBaseModelScores = Record<TwinBaseModelDimension, number>;

/** Count of answered questionnaire items per dimension (used with scores so `0` scores are not mistaken for missing data). */
export type TwinBaseModelDimensionCounts = Record<TwinBaseModelDimension, number>;

/** Selected option `value` per question id. */
export type TwinBaseModelAnswers = Record<string, string>;

export type TwinBaseModelDerivedSignals = {
  dominantTraits: string[];
  riskPatterns: string[];
  strengths: string[];
};
