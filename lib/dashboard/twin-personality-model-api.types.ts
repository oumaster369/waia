/** Twin personality model v1 — contract-first (DEE-35); inference is downstream. */

import type { TwinContradictionDetectorFindingDto } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import type { TwinPatternSummaryApiResponse } from "@/lib/dashboard/twin-pattern-summary-api.types";
import type { TwinPredictionVerificationItemDto } from "@/lib/dashboard/twin-prediction-verification-api.types";

export const TWIN_PERSONALITY_MODEL_SCHEMA_VERSION = "twin-personality-model-v1" as const;

export type TwinPersonalityModelSchemaVersion = typeof TWIN_PERSONALITY_MODEL_SCHEMA_VERSION;

export const PERSONALITY_MODEL_MAX_ITEMS_PER_FIELD = 8;

/** Upper bound for a single analytic label after normalization (pattern-summary lines can be long). */
export const MAX_PERSONALITY_LABEL_CHARS = 384;

export const PERSONALITY_CONFIDENCE_DECIMAL_PLACES = 4;

export type TwinPersonalityModelBlock = {
  dominantTraits: string[];
  behavioralPatterns: string[];
  emotionalBaseline: string[];
  decisionStyle: string[];
  relationshipStyle: string[];
  contradictionProfile: string[];
  growthEdges: string[];
  /** Deterministic model confidence in [0,1], rounded to four decimal places. */
  confidence: number;
};

export type TwinPersonalityModelSourceSignals = {
  memoryItemsConsidered: number;
  patternSummaryUsed: boolean;
  contradictionItemsConsidered: number;
  verificationItemsConsidered: number;
};

export type TwinPersonalityModelApiResponse = {
  schemaVersion: TwinPersonalityModelSchemaVersion;
  model: TwinPersonalityModelBlock;
  sourceSignals: TwinPersonalityModelSourceSignals;
};

/** Inputs for the deterministic v1 builder; callers pass DTO slices as available. */
export type TwinPersonalityModelSignalInput = {
  patternSummary: Pick<
    TwinPatternSummaryApiResponse,
    "repeatedBehaviors" | "emotionalPatterns" | "decisionTendencies" | "contradictions" | "dominantThemes"
  >;
  contradictions: TwinContradictionDetectorFindingDto[];
  verifications: Pick<TwinPredictionVerificationItemDto, "verification" | "correction">[];
  memoryItemsConsidered?: number;
};
