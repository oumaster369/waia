/** AI-Twin Engine orchestration (DEE-36): composite deterministic backend pipeline. */

import type { TwinContradictionDetectorApiResponse } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import type { TwinPatternSummaryApiResponse } from "@/lib/dashboard/twin-pattern-summary-api.types";
import type { TwinPersonalityModelApiResponse } from "@/lib/dashboard/twin-personality-model-api.types";
import type { TwinPredictionApiResponse } from "@/lib/dashboard/twin-prediction-api.types";
import type { TwinRepeatabilityApiResponse } from "@/lib/dashboard/twin-repeatability-api.types";

export const TWIN_ENGINE_SCHEMA_VERSION = "twin-engine-v1" as const;

export type TwinEngineSchemaVersion = typeof TWIN_ENGINE_SCHEMA_VERSION;

export type TwinEngineRunInput = {
  userId: string;
  scenario?: string | null;
  includePrediction?: boolean;
};

export type TwinEngineModuleId =
  | "pattern_summary"
  | "contradiction_detector"
  | "repeatability_analyzer"
  | "personality_model"
  | "prediction";

export type TwinEngineMeta = {
  scenarioUsed: boolean;
  predictionRequested: boolean;
  modulesRun: TwinEngineModuleId[];
  /** Reserved for future non-deterministic metadata; null preserves deterministic JSON tests. */
  generatedAt: null;
};

export type TwinEngineApiResponse = {
  schemaVersion: TwinEngineSchemaVersion;
  patternSummary: TwinPatternSummaryApiResponse;
  contradictions: TwinContradictionDetectorApiResponse;
  personalityModel: TwinPersonalityModelApiResponse;
  repeatability: TwinRepeatabilityApiResponse;
  prediction: TwinPredictionApiResponse | null;
  engineMeta: TwinEngineMeta;
};
