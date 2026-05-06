import "server-only";

/**
 * DEE-30: Orchestrates DEE-32 retrieval, DEE-31 pattern summary, DEE-34 verifications
 * into DEE-29 rule evaluation — deterministic, no LLM.
 */

import type { TwinContradictionDetectorApiResponse } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import { TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import type { TwinMemorySearchHit } from "@/lib/twin-persistence/twin-memory-retrieval";
import { searchTwinMemoriesByText } from "@/lib/twin-persistence/twin-memory-retrieval";
import type { WaiaSqliteDb } from "@/lib/twin-persistence/loader";
import { listTwinPredictionVerificationsForUser } from "@/lib/twin-persistence/twin-prediction-verifications";
import {
  evaluateTwinContradictionRules,
  type TwinContradictionPatternSummarySlice,
} from "@/lib/reasoning/twin-contradiction-rules";
import { fuseMemorySearchSlices } from "@/lib/reasoning/twin-memory-search-fusion";
import {
  getTwinPatternSummaryForUser,
  getTwinPatternSummaryForUserAsync,
} from "@/lib/reasoning/twin-pattern-summary";
import type {
  TwinMemorySearchPort,
  TwinVerificationListPort,
} from "@/lib/reasoning/twin-reasoning-ports";

export const CONTRADICTION_DETECTOR_SEED_QUERIES = [
  "conflict between intention and action",
  "stress avoidance delay decision",
  "values goals contradiction",
  "repeated failure pattern",
  "emotional contrast anxiety calm",
] as const;

const PER_SEED_TOP_N = 8;
const MAX_FUSED_ITEMS = 40;
const SCENARIO_TOP_N = 16;
const VERIFICATION_LIST_LIMIT = 50;

function fusedHitsFromSeedQueries(db: WaiaSqliteDb, userId: string): TwinMemorySearchHit[] {
  const slices = CONTRADICTION_DETECTOR_SEED_QUERIES.map((seed) =>
    searchTwinMemoriesByText(db, userId, seed, PER_SEED_TOP_N),
  );
  return fuseMemorySearchSlices(slices, MAX_FUSED_ITEMS);
}

async function fusedHitsFromSeedQueriesAsync(
  memoryPort: TwinMemorySearchPort,
  userId: string,
): Promise<TwinMemorySearchHit[]> {
  const slices = await Promise.all(
    CONTRADICTION_DETECTOR_SEED_QUERIES.map((seed) =>
      memoryPort.searchByText(userId, seed, PER_SEED_TOP_N),
    ),
  );
  return fuseMemorySearchSlices(slices, MAX_FUSED_ITEMS);
}

export type RunTwinContradictionDetectorOptions = {
  /**
   * Non-empty trimmed scenario text for retrieval + rule scenario slice.
   * When omitted / empty at route layer, callers use seed retrieval and pass `""` to rules.
   */
  scenarioForRulesAndRetrieval?: string;
};

/**
 * Loads pattern summary, memory hits (scenario-retrieval vs contradiction seeds),
 * recent verification rows, runs DEE-29 evaluator.
 */
export function runTwinContradictionDetectorForUser(
  db: WaiaSqliteDb,
  userId: string,
  options?: RunTwinContradictionDetectorOptions,
): TwinContradictionDetectorApiResponse {
  const trimmedScenario = options?.scenarioForRulesAndRetrieval ?? "";
  const scenarioUsed = trimmedScenario.length > 0;

  const memoryHits: TwinMemorySearchHit[] = scenarioUsed
    ? searchTwinMemoriesByText(db, userId, trimmedScenario, SCENARIO_TOP_N)
    : fusedHitsFromSeedQueries(db, userId);

  const seedQueryCount = scenarioUsed ? 1 : CONTRADICTION_DETECTOR_SEED_QUERIES.length;

  const fullSummary = getTwinPatternSummaryForUser(db, userId);
  const patternSummary: TwinContradictionPatternSummarySlice = {
    repeatedBehaviors: fullSummary.repeatedBehaviors,
    emotionalPatterns: fullSummary.emotionalPatterns,
    decisionTendencies: fullSummary.decisionTendencies,
    contradictions: fullSummary.contradictions,
    dominantThemes: fullSummary.dominantThemes,
  };

  const dtoRows = listTwinPredictionVerificationsForUser(db, userId, VERIFICATION_LIST_LIMIT);
  const verifications = dtoRows.map((r) => ({
    verification: r.verification,
    scenario: r.scenario,
    correction: r.correction,
  }));

  const ruled = evaluateTwinContradictionRules({
    scenarioText: scenarioUsed ? trimmedScenario : "",
    patternSummary,
    memoryHits,
    verifications,
  });

  return {
    schemaVersion: TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION,
    contradictions: ruled.contradictions.map((c) => ({
      type: c.type,
      description: c.description,
      evidence: c.evidence,
      severity: c.severity,
    })),
    memoryItemsConsidered: memoryHits.length,
    verificationItemsConsidered: dtoRows.length,
    seedQueryCount,
    scenarioUsed,
  };
}

export async function runTwinContradictionDetectorForUserAsync(
  memoryPort: TwinMemorySearchPort,
  verificationPort: TwinVerificationListPort,
  userId: string,
  options?: RunTwinContradictionDetectorOptions,
): Promise<TwinContradictionDetectorApiResponse> {
  const trimmedScenario = options?.scenarioForRulesAndRetrieval ?? "";
  const scenarioUsed = trimmedScenario.length > 0;

  const memoryHits: TwinMemorySearchHit[] = scenarioUsed
    ? await memoryPort.searchByText(userId, trimmedScenario, SCENARIO_TOP_N)
    : await fusedHitsFromSeedQueriesAsync(memoryPort, userId);

  const seedQueryCount = scenarioUsed ? 1 : CONTRADICTION_DETECTOR_SEED_QUERIES.length;

  const fullSummary = await getTwinPatternSummaryForUserAsync(memoryPort, userId);
  const patternSummary: TwinContradictionPatternSummarySlice = {
    repeatedBehaviors: fullSummary.repeatedBehaviors,
    emotionalPatterns: fullSummary.emotionalPatterns,
    decisionTendencies: fullSummary.decisionTendencies,
    contradictions: fullSummary.contradictions,
    dominantThemes: fullSummary.dominantThemes,
  };

  const dtoRows = await verificationPort.listPredictionVerifications(userId, VERIFICATION_LIST_LIMIT);
  const verifications = dtoRows.map((r) => ({
    verification: r.verification,
    scenario: r.scenario,
    correction: r.correction,
  }));

  const ruled = evaluateTwinContradictionRules({
    scenarioText: scenarioUsed ? trimmedScenario : "",
    patternSummary,
    memoryHits,
    verifications,
  });

  return {
    schemaVersion: TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION,
    contradictions: ruled.contradictions.map((c) => ({
      type: c.type,
      description: c.description,
      evidence: c.evidence,
      severity: c.severity,
    })),
    memoryItemsConsidered: memoryHits.length,
    verificationItemsConsidered: dtoRows.length,
    seedQueryCount,
    scenarioUsed,
  };
}
