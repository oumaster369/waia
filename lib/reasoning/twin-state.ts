/**
 * DEE-45: Merge pattern summary, contradiction findings, personality, readiness, and memory counts
 * into a single deterministic TwinState snapshot — no DB, LLM, or wall clock here.
 */

import type { TwinContradictionDetectorFindingDto } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import type { TwinPatternSummaryApiResponse } from "@/lib/dashboard/twin-pattern-summary-api.types";
import type { TwinPersonalityModelApiResponse } from "@/lib/dashboard/twin-personality-model-api.types";
import type { TwinReadinessResult } from "@/lib/dashboard/twin-readiness-api.types";
import type { TwinState } from "@/lib/dashboard/twin-state-api.types";
import { TWIN_STATE_SCHEMA_VERSION } from "@/lib/dashboard/twin-state-api.types";

/** Max distinct labels per TwinState.identity field (deterministic merge cap). */
const IDENTITY_FIELD_CAP = 8;

/** Stable collation for repeatable ordering across runtimes. */
const SORT_LOCALE = "en";

export type TwinStateMemoryStatInput = {
  totalEntries: number;
  dialogueTurns: number;
  diaryEntries: number;
  scenarioAnswers: number;
};

export type BuildTwinStateFromSignalsInput = {
  patternSummary: TwinPatternSummaryApiResponse;
  contradictions: TwinContradictionDetectorFindingDto[];
  personality: TwinPersonalityModelApiResponse;
  readiness: TwinReadinessResult;
  memoryStats: TwinStateMemoryStatInput;
  evolution?: {
    lastUpdatedAt?: string | null;
    growthPhase?: string;
  };
};

/** NFKC, trim, collapsed whitespace — identity lines stay comparable to analytic labels upstream. */
function normalizeIdentityLine(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Dedupe via normalized key; output sorted unique normalized lines, capped. */
function uniqSortCap(strings: readonly string[], cap: number): string[] {
  const byKey = new Map<string, string>();
  for (const raw of strings) {
    const key = normalizeIdentityLine(raw);
    if (key.length === 0) {
      continue;
    }
    if (!byKey.has(key)) {
      byKey.set(key, key);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, SORT_LOCALE)).slice(0, cap);
}

function contradictionFindingLine(f: TwinContradictionDetectorFindingDto): string {
  const desc = normalizeIdentityLine(f.description);
  if (desc.length > 0) {
    return desc;
  }
  const typePart = normalizeIdentityLine(f.type);
  return typePart.length > 0 ? typePart : "finding";
}

function growthPhaseFromReadiness(readiness: TwinReadinessResult): string {
  switch (readiness.level) {
    case "low":
      return "forming";
    case "medium":
      return "balancing";
    case "high":
      return "integrated";
  }
}

function nonNegativeInt(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.floor(n));
}

export function buildTwinStateFromSignals(input: BuildTwinStateFromSignalsInput): TwinState {
  const { patternSummary, contradictions, personality, readiness } = input;
  const dominants = [...patternSummary.dominantThemes, ...personality.model.dominantTraits];
  const emotional = [...patternSummary.emotionalPatterns, ...personality.model.emotionalBaseline];
  const decisions = [...patternSummary.decisionTendencies, ...personality.model.decisionStyle];
  const contraStrings = [
    ...patternSummary.contradictions,
    ...personality.model.contradictionProfile,
    ...contradictions.map(contradictionFindingLine),
  ];

  const evolution = input.evolution ?? {};
  const lastUpdatedAt = evolution.lastUpdatedAt !== undefined ? evolution.lastUpdatedAt : null;
  const growthPhase =
    evolution.growthPhase !== undefined ? evolution.growthPhase : growthPhaseFromReadiness(readiness);

  return {
    version: TWIN_STATE_SCHEMA_VERSION,
    identity: {
      dominantTraits: uniqSortCap(dominants, IDENTITY_FIELD_CAP),
      emotionalPatterns: uniqSortCap(emotional, IDENTITY_FIELD_CAP),
      decisionStyle: uniqSortCap(decisions, IDENTITY_FIELD_CAP),
      contradictions: uniqSortCap(contraStrings, IDENTITY_FIELD_CAP),
    },
    readiness,
    memoryStats: {
      totalEntries: nonNegativeInt(input.memoryStats.totalEntries),
      dialogueTurns: nonNegativeInt(input.memoryStats.dialogueTurns),
      diaryEntries: nonNegativeInt(input.memoryStats.diaryEntries),
      scenarioAnswers: nonNegativeInt(input.memoryStats.scenarioAnswers),
    },
    evolution: {
      lastUpdatedAt,
      growthPhase,
    },
  };
}
