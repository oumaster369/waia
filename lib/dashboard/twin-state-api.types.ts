/** Twin consolidated state snapshot (DEE-45) — logical schema; no persistence here. */

import type { TwinReadinessResult } from "@/lib/dashboard/twin-readiness-api.types";

export const TWIN_STATE_SCHEMA_VERSION = "twin-state-v1" as const;

export type TwinStateSchemaVersion = typeof TWIN_STATE_SCHEMA_VERSION;

export type TwinState = {
  version: TwinStateSchemaVersion;
  identity: {
    dominantTraits: string[];
    emotionalPatterns: string[];
    decisionStyle: string[];
    contradictions: string[];
  };
  readiness: TwinReadinessResult;
  memoryStats: {
    totalEntries: number;
    dialogueTurns: number;
    diaryEntries: number;
    scenarioAnswers: number;
  };
  evolution: {
    lastUpdatedAt: string | null;
    growthPhase: string;
  };
};
