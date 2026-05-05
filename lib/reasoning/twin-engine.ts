import "server-only";

/**
 * DEE-36 AI-Twin Engine — orchestration only. Composes existing modules; does not own storage or rules.
 *
 * ## Layer boundaries (orchestration contract)
 *
 * 1. Memory Layer — persists user source data, embeddings, retrieval. Does not infer personality or predict.
 * 2. Pattern Layer — pattern summary, repeated behaviors, emotional patterns, decision tendencies. Does not store or mutate verification.
 * 3. Contradiction Layer — contradiction detection, rule-backed findings. Does not rewrite rules or call LLM.
 * 4. Personality Layer — personality model contract, safe normalized labels. No clinical labels; no raw evidence leak.
 * 5. Prediction Layer — scenario prediction. Runs only when explicitly requested with a non-empty scenario.
 * 6. Feedback / Repeatability Layer — verification records, repeatability analysis. Does not modify prediction results.
 */

import { MAX_SCENARIO_CHARS } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import type { TwinContradictionDetectorApiResponse } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import type { TwinPatternSummaryApiResponse } from "@/lib/dashboard/twin-pattern-summary-api.types";
import type { TwinPersonalityModelSignalInput } from "@/lib/dashboard/twin-personality-model-api.types";
import type { TwinRepeatabilityApiResponse } from "@/lib/dashboard/twin-repeatability-api.types";
import type {
  TwinEngineApiResponse,
  TwinEngineModuleId,
  TwinEngineRunInput,
} from "@/lib/dashboard/twin-engine-api.types";
import { TWIN_ENGINE_SCHEMA_VERSION } from "@/lib/dashboard/twin-engine-api.types";
import type { TwinPredictionVerificationItemDto } from "@/lib/dashboard/twin-prediction-verification-api.types";
import { runTwinContradictionDetectorForUser } from "@/lib/reasoning/twin-contradiction-detector";
import { getTwinPatternSummaryForUser } from "@/lib/reasoning/twin-pattern-summary";
import { buildTwinPersonalityModelFromSignals } from "@/lib/reasoning/twin-personality-model-contract";
import { runTwinPredictionForUser } from "@/lib/reasoning/twin-prediction";
import { analyzeRepeatability } from "@/lib/reasoning/twin-repeatability-analyzer";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";
import {
  DEFAULT_VERIFICATION_LIST_LIMIT,
  listTwinPredictionVerificationsForUser,
} from "@/lib/twin-persistence/twin-prediction-verifications";

/** Grep-friendly single export of layer responsibilities (see module comment). */
export const TWIN_ENGINE_LAYER_BOUNDARIES =
  "memory|pattern|contradiction|personality|prediction|feedback_repeatability";

const BASE_MODULES: TwinEngineModuleId[] = [
  "pattern_summary",
  "contradiction_detector",
  "repeatability_analyzer",
  "personality_model",
];

export class TwinEngineScenarioTooLongError extends Error {
  readonly code = "SCENARIO_TOO_LONG" as const;

  constructor(message: string) {
    super(message);
    this.name = "TwinEngineScenarioTooLongError";
  }
}

export function normalizeTwinEngineScenario(raw: string | null | undefined): string | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const t = raw.trim();
  if (t.length === 0) {
    return null;
  }
  if (t.length > MAX_SCENARIO_CHARS) {
    throw new TwinEngineScenarioTooLongError(
      `scenario must not exceed ${MAX_SCENARIO_CHARS} characters.`,
    );
  }
  return t;
}

function repeatabilityOccurrenceSum(repeatability: TwinRepeatabilityApiResponse): number {
  return repeatability.repeatedPatterns.reduce((sum, p) => sum + p.occurrences, 0);
}

export function buildTwinEnginePersonalityInput(
  patternSummary: TwinPatternSummaryApiResponse,
  contradictionsResponse: TwinContradictionDetectorApiResponse,
  repeatability: TwinRepeatabilityApiResponse,
  verificationDtos: TwinPredictionVerificationItemDto[],
): TwinPersonalityModelSignalInput {
  const memoryBoost = repeatabilityOccurrenceSum(repeatability);
  return {
    patternSummary: {
      repeatedBehaviors: patternSummary.repeatedBehaviors,
      emotionalPatterns: patternSummary.emotionalPatterns,
      decisionTendencies: patternSummary.decisionTendencies,
      contradictions: patternSummary.contradictions,
      dominantThemes: patternSummary.dominantThemes,
    },
    contradictions: contradictionsResponse.contradictions,
    verifications: verificationDtos.map((v) => ({
      verification: v.verification,
      correction: v.correction,
    })),
    memoryItemsConsidered: patternSummary.memoryItemsConsidered + memoryBoost,
  };
}

export function runTwinEngine(db: WaiaSqliteDb, input: TwinEngineRunInput): TwinEngineApiResponse {
  const normalized = normalizeTwinEngineScenario(input.scenario);
  const scenarioUsed = normalized !== null;
  const includePrediction = input.includePrediction === true;

  const patternSummary = getTwinPatternSummaryForUser(db, input.userId);

  const contradictions = runTwinContradictionDetectorForUser(
    db,
    input.userId,
    normalized ? { scenarioForRulesAndRetrieval: normalized } : {},
  );

  const repeatability = analyzeRepeatability(db, input.userId, {
    scenarioText: normalized ?? undefined,
  });

  const verificationDtos = listTwinPredictionVerificationsForUser(
    db,
    input.userId,
    DEFAULT_VERIFICATION_LIST_LIMIT,
  );

  const personalityModel = buildTwinPersonalityModelFromSignals(
    buildTwinEnginePersonalityInput(patternSummary, contradictions, repeatability, verificationDtos),
  );

  let prediction = null;
  const modulesRun: TwinEngineModuleId[] = [...BASE_MODULES];
  if (includePrediction && normalized !== null) {
    prediction = runTwinPredictionForUser(db, input.userId, normalized);
    modulesRun.push("prediction");
  }

  return {
    schemaVersion: TWIN_ENGINE_SCHEMA_VERSION,
    patternSummary,
    contradictions,
    personalityModel,
    repeatability,
    prediction,
    engineMeta: {
      scenarioUsed,
      predictionRequested: includePrediction && normalized !== null,
      modulesRun,
      generatedAt: null,
    },
  };
}
