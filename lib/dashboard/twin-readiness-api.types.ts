/** Twin system maturity readiness (DEE-22) — deterministic scoring; no DB, no LLM. */

import type { TwinPredictionVerificationKind } from "@/lib/dashboard/twin-prediction-verification-api.types";

export const TWIN_READINESS_SCHEMA_VERSION = "twin-readiness-v1" as const;

export type TwinReadinessSchemaVersion = typeof TWIN_READINESS_SCHEMA_VERSION;

/** Aligned with DEE-24 base model questionnaire length (avoid importing server-only module here). */
export const TWIN_BASE_MODEL_QUESTION_COUNT = 10;

export type TwinReadinessScores = {
  baseModel: number;
  memory: number;
  patterns: number;
  contradictions: number;
  consistency: number;
  feedback: number;
};

export type TwinReadinessLevel = "low" | "medium" | "high";

export type TwinReadinessResult = {
  schemaVersion: "twin-readiness-v1";
  scores: TwinReadinessScores;
  overall: number;
  level: TwinReadinessLevel;
};

/**
 * Pure snapshot for maturity scoring. Callers derive fields from Twin modules (DEE-24/28/30/31/34).
 * No timestamps, no DB handles. Negative values are clamped in `computeTwinReadinessResult`.
 */
export type TwinReadinessInput = {
  /** Count of answered base-model questions (values 0…baseModelQuestionTotal). */
  baseModelAnsweredCount: number;
  /** Defaults to {@link TWIN_BASE_MODEL_QUESTION_COUNT} when omitted in compute. */
  baseModelQuestionTotal?: number;
  /** Fused memory item count (e.g. pattern layer / fusion). */
  memoryFusedItemCount: number;
  /** From pattern summary: `memoryItemsConsidered`. */
  patternMemoryItemsConsidered: number;
  /** Contradiction detector: number of findings. */
  contradictionFindingCount: number;
  /** Contradiction detector: `memoryItemsConsidered` for stable detection gate. */
  contradictionMemoryItemsConsidered: number;
  /** Sum of `occurrences` across repeatability aggregates (DEE-28). */
  repeatabilityTotalOccurrences: number;
  /** Length of `repeatedPatterns` (distinct pattern types); optional, default 0. */
  repeatabilityDistinctPatternTypes?: number;
  /** Count of prediction verifications per kind; missing keys = 0. */
  verificationCountByKind: Partial<Record<TwinPredictionVerificationKind, number>>;
};
