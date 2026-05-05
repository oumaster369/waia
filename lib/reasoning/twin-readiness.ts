import "server-only";

/**
 * DEE-22 Twin system maturity readiness — deterministic, no RNG, no timestamps.
 * Complements UI indicator readiness (`lib/readiness/`); not clinical/diagnostic.
 */

import type {
  TwinReadinessInput,
  TwinReadinessLevel,
  TwinReadinessResult,
  TwinReadinessScores,
} from "@/lib/dashboard/twin-readiness-api.types";
import {
  TWIN_BASE_MODEL_QUESTION_COUNT,
  TWIN_READINESS_SCHEMA_VERSION,
} from "@/lib/dashboard/twin-readiness-api.types";
import {
  TWIN_PREDICTION_VERIFICATION_KINDS,
  type TwinPredictionVerificationKind,
} from "@/lib/dashboard/twin-prediction-verification-api.types";

const ROUND_SCALE = 10 ** 4;

/** Aggregation weights — must sum to 1. */
export const TWIN_READINESS_WEIGHTS: Readonly<TwinReadinessScores> = {
  baseModel: 0.25,
  memory: 0.2,
  patterns: 0.15,
  contradictions: 0.1,
  consistency: 0.15,
  feedback: 0.15,
} as const;

export { TWIN_READINESS_SCHEMA_VERSION, TWIN_BASE_MODEL_QUESTION_COUNT };

const TWIN_READINESS_SCORING = {
  /** Memory log saturation: log1p(n) / log1p(N) → 1. */
  memorySaturationN: 56,
  /** Pattern layer requires at least this much fused memory coverage. */
  patternsMinMemoryFused: 4,
  /** Pattern subscore saturation from `patternMemoryItemsConsidered`. */
  patternsSaturationN: 40,
  /** Contradiction dimension when zero findings (neutral-low, not “high maturity”). */
  contradictionNeutralAbsence: 0.28,
  /** Ref scale for rising contradiction score when findings > 0. */
  contradictionFindingsRef: 8,
  /** Repeatability: penalty reference for total occurrences. */
  repeatabilityOccurrencesRef: 80,
  /** Strength of repeatability penalty (0–1). */
  repeatabilityPenaltyStrength: 0.88,
  /** Feedback: log saturation of total verification count. */
  verificationsSaturationN: 24,
  /**
   * Feedback diversity: weight for using all three kinds (1 kind → floor, 3 kinds → full).
   * `feedback = volume * (diversityFloor + diversitySpan * (activeKinds / 3))`.
   */
  feedbackDiversityFloor: 0.28,
  feedbackDiversitySpan: 0.72,
  /**
   * Anti-fake-progress: max overall when base model unanswered scales with base score.
   * `overall = min(weightedSum, baseCapFloor + baseCapSpan * baseModelScore)`.
   */
  baseProgressCapFloor: 0.65,
  baseProgressCapSpan: 0.35,
} as const;

function clampNonNeg(n: number): number {
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return n;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  return Math.max(0, Math.min(1, x));
}

function round4(x: number): number {
  return Math.round(x * ROUND_SCALE) / ROUND_SCALE;
}

function logCap(n: number, capN: number): number {
  const nn = clampNonNeg(n);
  const c = Math.max(1, capN);
  return clamp01(Math.log1p(nn) / Math.log1p(c));
}

export function twinReadinessBaseModelScore(answered: number, total: number): number {
  const t = Math.max(1, Math.floor(total));
  const a = Math.min(Math.max(0, Math.floor(answered)), t);
  return round4(a / t);
}

export function twinReadinessMemoryScore(memoryFusedItemCount: number): number {
  return round4(logCap(memoryFusedItemCount, TWIN_READINESS_SCORING.memorySaturationN));
}

export function twinReadinessPatternsScore(
  memoryFusedItemCount: number,
  patternMemoryItemsConsidered: number,
): number {
  if (clampNonNeg(memoryFusedItemCount) < TWIN_READINESS_SCORING.patternsMinMemoryFused) {
    return 0;
  }
  return round4(logCap(patternMemoryItemsConsidered, TWIN_READINESS_SCORING.patternsSaturationN));
}

export function twinReadinessContradictionsScore(input: {
  contradictionFindingCount: number;
  contradictionMemoryItemsConsidered: number;
}): number {
  const findings = Math.floor(clampNonNeg(input.contradictionFindingCount));
  const mem = clampNonNeg(input.contradictionMemoryItemsConsidered);

  if (findings <= 0) {
    return round4(TWIN_READINESS_SCORING.contradictionNeutralAbsence);
  }

  if (mem < 1) {
    return round4(0.32 + 0.28 * logCap(findings, TWIN_READINESS_SCORING.contradictionFindingsRef));
  }

  return round4(
    0.38 + 0.62 * logCap(findings, TWIN_READINESS_SCORING.contradictionFindingsRef),
  );
}

export function twinReadinessConsistencyScore(repeatabilityTotalOccurrences: number): number {
  const occ = clampNonNeg(repeatabilityTotalOccurrences);
  const ref = TWIN_READINESS_SCORING.repeatabilityOccurrencesRef;
  const load = clamp01(Math.log1p(occ) / Math.log1p(ref));
  const penalty = TWIN_READINESS_SCORING.repeatabilityPenaltyStrength * load;
  return round4(clamp01(1 - penalty));
}

function normalizeVerificationCounts(
  raw: Partial<Record<TwinPredictionVerificationKind, number>>,
): Record<TwinPredictionVerificationKind, number> {
  const out = {
    accurate: 0,
    partially_accurate: 0,
    inaccurate: 0,
  } satisfies Record<TwinPredictionVerificationKind, number>;
  for (const k of TWIN_PREDICTION_VERIFICATION_KINDS) {
    out[k] = clampNonNeg(Math.floor(raw[k] ?? 0));
  }
  return out;
}

export function twinReadinessFeedbackScore(
  verificationCountByKind: Partial<Record<TwinPredictionVerificationKind, number>>,
): number {
  const byKind = normalizeVerificationCounts(verificationCountByKind);
  let total = 0;
  let activeKinds = 0;
  for (const k of TWIN_PREDICTION_VERIFICATION_KINDS) {
    const c = byKind[k];
    total += c;
    if (c > 0) {
      activeKinds += 1;
    }
  }
  const volume = logCap(total, TWIN_READINESS_SCORING.verificationsSaturationN);
  const diversity =
    TWIN_READINESS_SCORING.feedbackDiversityFloor +
    TWIN_READINESS_SCORING.feedbackDiversitySpan * (activeKinds / 3);
  return round4(clamp01(volume * diversity));
}

function weightedSum(scores: TwinReadinessScores): number {
  const w = TWIN_READINESS_WEIGHTS;
  return (
    w.baseModel * scores.baseModel +
    w.memory * scores.memory +
    w.patterns * scores.patterns +
    w.contradictions * scores.contradictions +
    w.consistency * scores.consistency +
    w.feedback * scores.feedback
  );
}

function baseProgressCap(baseModelScore: number): number {
  const s = clamp01(baseModelScore);
  return (
    TWIN_READINESS_SCORING.baseProgressCapFloor + TWIN_READINESS_SCORING.baseProgressCapSpan * s
  );
}

export function twinReadinessOverallScore(scores: TwinReadinessScores): number {
  const raw = weightedSum(scores);
  const capped = Math.min(raw, baseProgressCap(scores.baseModel));
  return round4(clamp01(capped));
}

export function twinReadinessLevel(overall: number): TwinReadinessLevel {
  const o = clamp01(overall);
  if (o < 0.4) {
    return "low";
  }
  if (o <= 0.7) {
    return "medium";
  }
  return "high";
}

function sanitizeInput(input: TwinReadinessInput): TwinReadinessInput {
  const total = input.baseModelQuestionTotal ?? TWIN_BASE_MODEL_QUESTION_COUNT;
  return {
    baseModelAnsweredCount: clampNonNeg(Math.floor(input.baseModelAnsweredCount)),
    baseModelQuestionTotal: Math.max(1, Math.floor(total)),
    memoryFusedItemCount: clampNonNeg(Math.floor(input.memoryFusedItemCount)),
    patternMemoryItemsConsidered: clampNonNeg(Math.floor(input.patternMemoryItemsConsidered)),
    contradictionFindingCount: clampNonNeg(Math.floor(input.contradictionFindingCount)),
    contradictionMemoryItemsConsidered: clampNonNeg(
      Math.floor(input.contradictionMemoryItemsConsidered),
    ),
    repeatabilityTotalOccurrences: clampNonNeg(Math.floor(input.repeatabilityTotalOccurrences)),
    repeatabilityDistinctPatternTypes: clampNonNeg(
      Math.floor(input.repeatabilityDistinctPatternTypes ?? 0),
    ),
    verificationCountByKind: { ...input.verificationCountByKind },
  };
}

/**
 * Full system maturity readiness from a numeric snapshot (upstream modules supply fields).
 */
export function computeTwinReadinessResult(raw: TwinReadinessInput): TwinReadinessResult {
  const input = sanitizeInput(raw);
  const totalQ = input.baseModelQuestionTotal ?? TWIN_BASE_MODEL_QUESTION_COUNT;

  const scores: TwinReadinessScores = {
    baseModel: twinReadinessBaseModelScore(input.baseModelAnsweredCount, totalQ),
    memory: twinReadinessMemoryScore(input.memoryFusedItemCount),
    patterns: twinReadinessPatternsScore(
      input.memoryFusedItemCount,
      input.patternMemoryItemsConsidered,
    ),
    contradictions: twinReadinessContradictionsScore({
      contradictionFindingCount: input.contradictionFindingCount,
      contradictionMemoryItemsConsidered: input.contradictionMemoryItemsConsidered,
    }),
    consistency: twinReadinessConsistencyScore(input.repeatabilityTotalOccurrences),
    feedback: twinReadinessFeedbackScore(input.verificationCountByKind),
  };

  const overall = twinReadinessOverallScore(scores);

  return {
    schemaVersion: TWIN_READINESS_SCHEMA_VERSION,
    scores,
    overall,
    level: twinReadinessLevel(overall),
  };
}
