import { describe, expect, it } from "vitest";

import { TWIN_READINESS_SCHEMA_VERSION } from "@/lib/dashboard/twin-readiness-api.types";
import { TWIN_PERSONALITY_MODEL_SCHEMA_VERSION } from "@/lib/dashboard/twin-personality-model-api.types";
import {
  TWIN_PROFILE_SCHEMA_VERSION,
  type TwinProfile,
} from "@/lib/dashboard/twin-profile-api.types";
import { TWIN_STATE_SCHEMA_VERSION } from "@/lib/dashboard/twin-state-api.types";
import { buildTwinProfileFromState } from "@/lib/reasoning/twin-profile";

function emptyPersonality(): import("@/lib/dashboard/twin-personality-model-api.types").TwinPersonalityModelApiResponse {
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

function baseState(overrides?: Partial<import("@/lib/dashboard/twin-state-api.types").TwinState>) {
  const base = {
    version: TWIN_STATE_SCHEMA_VERSION,
    identity: {
      dominantTraits: [],
      emotionalPatterns: [],
      decisionStyle: [],
      contradictions: [],
    },
    readiness: {
      schemaVersion: TWIN_READINESS_SCHEMA_VERSION,
      scores: {
        baseModel: 0,
        memory: 0,
        patterns: 0,
        contradictions: 0,
        consistency: 0,
        feedback: 0,
      },
      overall: 0,
      level: "low" as const,
    },
    memoryStats: {
      totalEntries: 0,
      dialogueTurns: 0,
      diaryEntries: 0,
      scenarioAnswers: 0,
    },
    evolution: {
      lastUpdatedAt: null,
      growthPhase: "forming",
    },
  };
  return { ...base, ...overrides };
}

function assertNoEmptyStrings(profile: TwinProfile) {
  expect(profile.identity.title.trim().length).toBeGreaterThan(0);
  expect(profile.identity.shortDescription.trim().length).toBeGreaterThan(0);
  expect(profile.expression.tone.trim().length).toBeGreaterThan(0);
  for (const xs of [
    profile.identity.dominantTraits,
    profile.expression.communicationStyle,
    profile.behavior.decisionStyle,
    profile.behavior.relationshipStyle,
    profile.emotionalProfile.emotionalPatterns,
    profile.contradictions.contradictions,
  ]) {
    for (const s of xs) {
      expect(s.trim().length).toBeGreaterThan(0);
    }
  }
}

describe("buildTwinProfileFromState (DEE-46)", () => {
  it("minimal inputs: fallbacks, empty arrays, readiness level, not public", () => {
    const p = buildTwinProfileFromState({
      state: baseState({
        readiness: {
          schemaVersion: TWIN_READINESS_SCHEMA_VERSION,
          scores: {
            baseModel: 0,
            memory: 0,
            patterns: 0,
            contradictions: 0,
            consistency: 0,
            feedback: 0,
          },
          overall: 0.1,
          level: "high",
        },
      }),
      personality: emptyPersonality(),
    });
    expect(p.schemaVersion).toBe(TWIN_PROFILE_SCHEMA_VERSION);
    expect(p.identity.title).toBe("AI Twin profile");
    expect(p.expression.tone).toBe("balanced");
    expect(p.identity.shortDescription).toBe(
      "Profile forming: add more dialogue to deepen this twin.",
    );
    expect(p.identity.dominantTraits).toEqual([]);
    expect(p.readiness.level).toBe("high");
    expect(p.visibility.isPublic).toBe(false);
    assertNoEmptyStrings(p);
  });

  it("is deterministic for the same input", () => {
    const input = {
      state: baseState({
        identity: {
          dominantTraits: [],
          emotionalPatterns: ["anxious about work", "Grateful"],
          decisionStyle: ["fast decider", "fast decider"],
          contradictions: ["c1"],
        },
      }),
      personality: {
        ...emptyPersonality(),
        model: {
          ...emptyPersonality().model,
          dominantTraits: ["zebra", "alpha", "alpha"],
          behavioralPatterns: ["warm opener", "warm opener"],
          decisionStyle: ["analytic"],
          relationshipStyle: ["collaborative"],
        },
      },
    };
    const a = JSON.stringify(buildTwinProfileFromState(input));
    const b = JSON.stringify(buildTwinProfileFromState(input));
    expect(a).toBe(b);
  });

  it("maps personality vs state fields correctly", () => {
    const p = buildTwinProfileFromState({
      state: baseState({
        identity: {
          dominantTraits: ["state only trait"],
          emotionalPatterns: [],
          decisionStyle: ["from state"],
          contradictions: ["tension a"],
        },
      }),
      personality: {
        ...emptyPersonality(),
        model: {
          ...emptyPersonality().model,
          dominantTraits: ["from personality"],
          behavioralPatterns: ["brief"],
          decisionStyle: ["from personality"],
          relationshipStyle: ["supportive"],
        },
      },
    });
    expect(p.identity.dominantTraits).toEqual(["from personality"]);
    expect(p.expression.communicationStyle).toEqual(["brief"]);
    expect(p.behavior.relationshipStyle).toEqual(["supportive"]);
    expect(p.behavior.decisionStyle).toEqual(["from personality", "from state"]);
    expect(p.contradictions.contradictions).toEqual(["tension a"]);
  });

  it("sorts, dedupes, and caps arrays at eight", () => {
    const many = ["h", "g", "f", "e", "d", "c", "b", "a", "z"];
    const p = buildTwinProfileFromState({
      state: baseState({
        identity: {
          dominantTraits: [],
          emotionalPatterns: ["X", "x", "beta", "alpha"],
          decisionStyle: many,
          contradictions: [],
        },
      }),
      personality: {
        ...emptyPersonality(),
        model: {
          ...emptyPersonality().model,
          dominantTraits: many.map((x) => x.toUpperCase()),
        },
      },
    });
    expect(p.identity.dominantTraits).toHaveLength(8);
    expect(p.identity.dominantTraits).toEqual([...p.identity.dominantTraits].sort((x, y) => x.localeCompare(y, "en")));
    expect(p.emotionalProfile.emotionalPatterns).toEqual(["alpha", "beta", "x"]);
    expect(p.behavior.decisionStyle).toHaveLength(8);
    assertNoEmptyStrings(p);
  });

  it("derives tone from emotional patterns", () => {
    const pCalm = buildTwinProfileFromState({
      state: baseState({
        identity: {
          dominantTraits: [],
          emotionalPatterns: ["mostly calm energy"],
          decisionStyle: [],
          contradictions: [],
        },
      }),
      personality: {
        ...emptyPersonality(),
        model: {
          ...emptyPersonality().model,
          dominantTraits: ["one trait"],
        },
      },
    });
    expect(pCalm.expression.tone).toBe("calm");

    const p2 = buildTwinProfileFromState({
      state: baseState({
        identity: {
          dominantTraits: [],
          emotionalPatterns: ["mixed but no tone keywords"],
          decisionStyle: [],
          contradictions: [],
        },
      }),
      personality: emptyPersonality(),
    });
    expect(p2.expression.tone).toBe("balanced");
  });

  it("shortDescription uses template when signals exist", () => {
    const p = buildTwinProfileFromState({
      state: baseState({
        readiness: {
          schemaVersion: TWIN_READINESS_SCHEMA_VERSION,
          scores: {
            baseModel: 0,
            memory: 0,
            patterns: 0,
            contradictions: 0,
            consistency: 0,
            feedback: 0,
          },
          overall: 0.5,
          level: "medium",
        },
        identity: {
          dominantTraits: [],
          emotionalPatterns: ["happy"],
          decisionStyle: [],
          contradictions: [],
        },
      }),
      personality: {
        ...emptyPersonality(),
        model: {
          ...emptyPersonality().model,
          dominantTraits: ["t1", "t2"],
        },
      },
    });
    expect(p.identity.shortDescription).toBe(
      "Twin profile (medium readiness, 2 traits, 1 emotional patterns, warm tone).",
    );
  });
});
