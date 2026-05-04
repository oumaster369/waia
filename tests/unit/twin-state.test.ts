import { describe, expect, it } from "vitest";

import { TWIN_PERSONALITY_MODEL_SCHEMA_VERSION } from "@/lib/dashboard/twin-personality-model-api.types";
import { TWIN_PATTERN_SUMMARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-pattern-summary-api.types";
import { TWIN_READINESS_SCHEMA_VERSION } from "@/lib/dashboard/twin-readiness-api.types";
import { TWIN_STATE_SCHEMA_VERSION } from "@/lib/dashboard/twin-state-api.types";
import { buildTwinStateFromSignals } from "@/lib/reasoning/twin-state";

function baseReadiness() {
  return {
    schemaVersion: TWIN_READINESS_SCHEMA_VERSION,
    scores: {
      baseModel: 0.2,
      memory: 0.3,
      patterns: 0.4,
      contradictions: 0.5,
      consistency: 0.6,
      feedback: 0.7,
    },
    overall: 0.35,
    level: "medium" as const,
  };
}

function emptyPatternSummary() {
  return {
    schemaVersion: TWIN_PATTERN_SUMMARY_SCHEMA_VERSION,
    repeatedBehaviors: [],
    emotionalPatterns: [],
    decisionTendencies: [],
    contradictions: [],
    dominantThemes: [],
    memoryItemsConsidered: 0,
    seedQueryCount: 0,
  };
}

function emptyPersonality() {
  return {
    schemaVersion: TWIN_PERSONALITY_MODEL_SCHEMA_VERSION,
    model: {
      dominantTraits: [],
      behavioralPatterns: [],
      emotionalBaseline: [],
      decisionStyle: [],
      relationshipStyle: [],
      contradictionProfile: [],
      growthEdges: [],
      confidence: 0,
    },
    sourceSignals: {
      memoryItemsConsidered: 0,
      patternSummaryUsed: false,
      contradictionItemsConsidered: 0,
      verificationItemsConsidered: 0,
    },
  };
}

describe("buildTwinStateFromSignals (DEE-45)", () => {
  it("returns empty identity arrays and zero stats for empty-ish inputs", () => {
    const state = buildTwinStateFromSignals({
      patternSummary: emptyPatternSummary(),
      contradictions: [],
      personality: emptyPersonality(),
      readiness: { ...baseReadiness(), level: "low", overall: 0.05 },
      memoryStats: {
        totalEntries: 0,
        dialogueTurns: 0,
        diaryEntries: 0,
        scenarioAnswers: 0,
      },
    });
    expect(state.version).toBe(TWIN_STATE_SCHEMA_VERSION);
    expect(state.identity.dominantTraits).toEqual([]);
    expect(state.identity.emotionalPatterns).toEqual([]);
    expect(state.identity.decisionStyle).toEqual([]);
    expect(state.identity.contradictions).toEqual([]);
    expect(state.evolution.lastUpdatedAt).toBe(null);
    expect(state.evolution.growthPhase).toBe("forming");
    expect(state.memoryStats).toEqual({
      totalEntries: 0,
      dialogueTurns: 0,
      diaryEntries: 0,
      scenarioAnswers: 0,
    });
  });

  it("merges sources, sorts, dedupes by normalized casing, caps at eight", () => {
    const duplicates = ["Alpha", "alpha", "  alpha ", "Beta"];
    const many = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const state = buildTwinStateFromSignals({
      patternSummary: {
        ...emptyPatternSummary(),
        dominantThemes: [...duplicates, ...many.slice(0, 6)],
        emotionalPatterns: duplicates,
      },
      contradictions: [],
      personality: {
        ...emptyPersonality(),
        model: {
          ...emptyPersonality().model,
          dominantTraits: many,
        },
      },
      readiness: baseReadiness(),
      memoryStats: { totalEntries: 1, dialogueTurns: 2, diaryEntries: 3, scenarioAnswers: 4 },
    });
    expect(state.identity.dominantTraits).toHaveLength(8);
    expect(state.identity.dominantTraits).toEqual([...state.identity.dominantTraits].sort((a, b) => a.localeCompare(b, "en")));
    expect(state.identity.dominantTraits.filter((x) => x === "alpha")).toHaveLength(1);
    expect(state.identity.emotionalPatterns).toEqual(["alpha", "beta"]);
  });

  it("includes contradiction finding descriptions in identity.contradictions", () => {
    const state = buildTwinStateFromSignals({
      patternSummary: {
        ...emptyPatternSummary(),
        contradictions: ["Pattern says X"],
      },
      contradictions: [
        { type: "value_mismatch", description: "Stated A vs acted B", evidence: ["e1"], severity: "medium" },
        { type: "scope", description: "", evidence: [], severity: "low" },
      ],
      personality: {
        ...emptyPersonality(),
        model: {
          ...emptyPersonality().model,
          contradictionProfile: ["Model tension Z"],
        },
      },
      readiness: { ...baseReadiness(), level: "high", overall: 0.95 },
      memoryStats: { totalEntries: 9, dialogueTurns: 0, diaryEntries: 0, scenarioAnswers: 0 },
    });
    expect(state.identity.contradictions).toContain("pattern says x");
    expect(state.identity.contradictions).toContain("stated a vs acted b");
    expect(state.identity.contradictions).toContain("scope");
    expect(state.identity.contradictions).toContain("model tension z");
    expect(state.identity.contradictions.length).toBeLessThanOrEqual(8);
    expect(state.evolution.growthPhase).toBe("integrated");
  });

  it("is deterministic: identical input serializes to the same evolution and identity", () => {
    const input = {
      patternSummary: {
        ...emptyPatternSummary(),
        dominantThemes: ["Zeus", "alpha"],
        decisionTendencies: ["Prefer async"],
      },
      contradictions: [
        {
          type: "t",
          description: "D1",
          evidence: [],
          severity: "low" as const,
        },
      ],
      personality: {
        ...emptyPersonality(),
        model: {
          ...emptyPersonality().model,
          dominantTraits: ["alpha"],
          decisionStyle: ["prefer async"],
        },
      },
      readiness: baseReadiness(),
      memoryStats: { totalEntries: -2.7, dialogueTurns: 3.9, diaryEntries: 0, scenarioAnswers: 1.1 },
    };
    const a = JSON.stringify(buildTwinStateFromSignals(input));
    const b = JSON.stringify(buildTwinStateFromSignals(input));
    expect(a).toBe(b);
    expect(JSON.parse(a).memoryStats).toEqual({
      totalEntries: 0,
      dialogueTurns: 3,
      diaryEntries: 0,
      scenarioAnswers: 1,
    });
  });

  it("respects explicit evolution overrides", () => {
    const state = buildTwinStateFromSignals({
      patternSummary: emptyPatternSummary(),
      contradictions: [],
      personality: emptyPersonality(),
      readiness: baseReadiness(),
      memoryStats: { totalEntries: 0, dialogueTurns: 0, diaryEntries: 0, scenarioAnswers: 0 },
      evolution: { lastUpdatedAt: "2026-05-03T12:00:00.000Z", growthPhase: "custom" },
    });
    expect(state.evolution.lastUpdatedAt).toBe("2026-05-03T12:00:00.000Z");
    expect(state.evolution.growthPhase).toBe("custom");
  });
});
