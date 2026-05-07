import "server-only";

/**
 * DEE-72.6: Postgres async Twin engine — same orchestration order as {@link runTwinEngine};
 * uses {@link PostgresTwinPersistence} + existing async reasoning APIs.
 * Production routes remain SQLite/sync; this path is additive for Postgres-capable callers.
 */

import type { TwinEngineApiResponse, TwinEngineModuleId, TwinEngineRunInput } from "@/lib/dashboard/twin-engine-api.types";
import { TWIN_ENGINE_SCHEMA_VERSION } from "@/lib/dashboard/twin-engine-api.types";
import type { PostgresTwinPersistence } from "@/lib/persistence/postgres/twin-persistence";
import { DEFAULT_VERIFICATION_LIST_LIMIT } from "@/lib/twin-persistence/twin-prediction-verifications";
import { runTwinContradictionDetectorForUserAsync } from "@/lib/reasoning/twin-contradiction-detector";
import {
  buildTwinEnginePersonalityInput,
  normalizeTwinEngineScenario,
} from "@/lib/reasoning/twin-engine";
import { getTwinPatternSummaryForUserAsync } from "@/lib/reasoning/twin-pattern-summary";
import { buildTwinPersonalityModelFromSignals } from "@/lib/reasoning/twin-personality-model-contract";
import { runTwinPredictionForUserAsync } from "@/lib/reasoning/twin-prediction";
import { analyzeRepeatabilityForUserAsync } from "@/lib/reasoning/twin-repeatability-analyzer";
import {
  createTwinMemorySearchPortPostgres,
  createTwinVerificationListPortPostgres,
} from "@/lib/reasoning/twin-reasoning-ports";

const BASE_MODULES: TwinEngineModuleId[] = [
  "pattern_summary",
  "contradiction_detector",
  "repeatability_analyzer",
  "personality_model",
];

/**
 * Mirrors {@link runTwinEngine} sequentially (no cross-step parallelization).
 * Does not claim SQLite/Postgres output parity — same contracts, independent storage.
 */
export async function runTwinEnginePostgresAsync(
  p: PostgresTwinPersistence,
  input: TwinEngineRunInput,
): Promise<TwinEngineApiResponse> {
  const normalized = normalizeTwinEngineScenario(input.scenario);
  const scenarioUsed = normalized !== null;
  const includePrediction = input.includePrediction === true;

  const memoryPort = createTwinMemorySearchPortPostgres(p);
  const verificationPort = createTwinVerificationListPortPostgres(p);

  const patternSummary = await getTwinPatternSummaryForUserAsync(memoryPort, input.userId);

  const contradictions = await runTwinContradictionDetectorForUserAsync(
    memoryPort,
    verificationPort,
    input.userId,
    normalized ? { scenarioForRulesAndRetrieval: normalized } : {},
  );

  const repeatability = await analyzeRepeatabilityForUserAsync(p.db, input.userId, {
    scenarioText: normalized ?? undefined,
  });

  const verificationDtos = await p.listTwinPredictionVerificationsForUser(
    input.userId,
    DEFAULT_VERIFICATION_LIST_LIMIT,
  );

  const personalityModel = buildTwinPersonalityModelFromSignals(
    buildTwinEnginePersonalityInput(patternSummary, contradictions, repeatability, verificationDtos),
  );

  let prediction = null;
  const modulesRun: TwinEngineModuleId[] = [...BASE_MODULES];
  if (includePrediction && normalized !== null) {
    prediction = await runTwinPredictionForUserAsync(memoryPort, input.userId, normalized);
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
