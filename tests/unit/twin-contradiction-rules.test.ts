import { describe, expect, it } from "vitest";

import type { TwinMemorySearchHit } from "@/lib/twin-persistence/twin-memory-retrieval";
import {
  evaluateTwinContradictionRules,
  type TwinContradictionPatternSummarySlice,
  type TwinContradictionRuleEvalInput,
  type TwinContradictionVerificationInput,
  TWIN_CONTRADICTION_RULES,
  TWIN_CONTRADICTION_RULES_SCHEMA_VERSION,
} from "@/lib/reasoning/twin-contradiction-rules";

function hit(o: Omit<TwinMemorySearchHit, "score"> & { score?: number }): TwinMemorySearchHit {
  return {
    score: o.score ?? 0.41,
    source: o.source,
    id: o.id,
    previewText: o.previewText,
  };
}

function emptySummary(): TwinContradictionPatternSummarySlice {
  return {
    repeatedBehaviors: [],
    emotionalPatterns: [],
    decisionTendencies: [],
    contradictions: [],
    dominantThemes: [],
  };
}

describe("evaluateTwinContradictionRules", () => {
  it("reports schema version helper count matches rule catalog", () => {
    expect(TWIN_CONTRADICTION_RULES.length).toBe(5);
    expect(TWIN_CONTRADICTION_RULES_SCHEMA_VERSION).toBe("twin-contradiction-rules-v1");
  });

  it("fires stated_intention_vs_past_behavior when commitment language overlaps longitudinal memory cues", () => {
    const input: TwinContradictionRuleEvalInput = {
      scenarioText: "I will never procrastinate on coding anymore",
      patternSummary: emptySummary(),
      memoryHits: [hit({ source: "dialogue", id: "a", previewText: "user: nightly coding drills" })],
      verifications: [],
    };
    const { contradictions } = evaluateTwinContradictionRules(input);
    expect(contradictions.some((c) => c.type === "stated_intention_vs_past_behavior")).toBe(true);
  });

  it("fires emotional_inconsistency high when pattern summary contradictions exist", () => {
    const input: TwinContradictionRuleEvalInput = {
      scenarioText: "Planning my week calmly",
      patternSummary: {
        ...emptySummary(),
        contradictions: ['Contrast between memories: "anxious" vs "calm"'],
      },
      memoryHits: [],
      verifications: [],
    };
    const { contradictions } = evaluateTwinContradictionRules(input);
    const emo = contradictions.find((c) => c.type === "emotional_inconsistency");
    expect(emo?.severity).toBe("high");
    expect(emo?.evidence.some((e) => e.startsWith("[pattern_summary]"))).toBe(true);
  });

  it("fires emotional_inconsistency medium when scenario affect opposes summarized memories", () => {
    const input: TwinContradictionRuleEvalInput = {
      scenarioText: "I feel anxious about the rollout",
      patternSummary: {
        ...emptySummary(),
        emotionalPatterns: [],
      },
      memoryHits: [hit({ source: "diary", id: "b", previewText: "overall calm readiness before launch" })],
      verifications: [],
    };
    const { contradictions } = evaluateTwinContradictionRules(input);
    const emo = contradictions.find((c) => c.type === "emotional_inconsistency");
    expect(emo?.severity).toBe("medium");
  });

  it("fires decision_inconsistency when always/never flips vs memory previews", () => {
    const input: TwinContradictionRuleEvalInput = {
      scenarioText: "I always ship features without debating tradeoffs anymore",
      patternSummary: emptySummary(),
      memoryHits: [hit({ source: "diary", id: "c", previewText: "I never ship unless tests pass" })],
      verifications: [],
    };
    const { contradictions } = evaluateTwinContradictionRules(input);
    expect(contradictions.some((c) => c.type === "decision_inconsistency")).toBe(true);
  });

  it("fires value_conflict when opposing poles bridge scenario versus memory/themes", () => {
    const input: TwinContradictionRuleEvalInput = {
      scenarioText: "I need autonomy to pick priorities freely",
      patternSummary: {
        ...emptySummary(),
        dominantThemes: ["Theme (mentions=2): security"],
      },
      memoryHits: [hit({ source: "scenario", id: "d", previewText: "safety checklist before release" })],
      verifications: [],
    };
    const { contradictions } = evaluateTwinContradictionRules(input);
    expect(contradictions.some((c) => c.type === "value_conflict")).toBe(true);
  });

  it("fires repeated_failure_patterns when verification loop shows stacked inaccurate judgments", () => {
    const verifs: TwinContradictionVerificationInput[] = [
      {
        verification: "inaccurate",
        scenario: "alpha path",
        correction: "missed blocker",
      },
      {
        verification: "inaccurate",
        scenario: "beta path",
        correction: "",
      },
    ];
    const input: TwinContradictionRuleEvalInput = {
      scenarioText: "",
      patternSummary: emptySummary(),
      memoryHits: [],
      verifications: verifs,
    };
    const { contradictions } = evaluateTwinContradictionRules(input);
    expect(contradictions.some((c) => c.type === "repeated_failure_patterns")).toBe(true);
  });

  it("fires repeated_failure_patterns via prefixed scenario bundle with corrections", () => {
    const scenario = "shared scenario text for grouping".slice(0, 49);
    const verifs: TwinContradictionVerificationInput[] = [
      { verification: "inaccurate", scenario, correction: "fix axis" },
      { verification: "partially_accurate", scenario, correction: "" },
    ];
    const input: TwinContradictionRuleEvalInput = {
      scenarioText: "",
      patternSummary: emptySummary(),
      memoryHits: [],
      verifications: verifs,
    };
    const { contradictions } = evaluateTwinContradictionRules(input);
    expect(contradictions.some((c) => c.type === "repeated_failure_patterns")).toBe(true);
  });

  it("returns no contradictions for aligned neutral bundle", () => {
    const input: TwinContradictionRuleEvalInput = {
      scenarioText: "Taking a short walk after lunch",
      patternSummary: {
        ...emptySummary(),
        emotionalPatterns: ["Emotional pattern: calm or steadiness"],
        dominantThemes: ["Theme (mentions=1): walking"],
      },
      memoryHits: [hit({ source: "diary", id: "z", previewText: "gentle afternoon stroll in the park" })],
      verifications: [
        { verification: "accurate", scenario: "evening review", correction: null },
      ],
    };
    expect(evaluateTwinContradictionRules(input).contradictions).toEqual([]);
  });

  it("is deterministic for identical inputs", () => {
    const input: TwinContradictionRuleEvalInput = {
      scenarioText: "I always move fast on releases",
      patternSummary: emptySummary(),
      memoryHits: [hit({ source: "dialogue", id: "q", previewText: "never skip the deployment checklist" })],
      verifications: [],
    };
    const a = evaluateTwinContradictionRules(input);
    const b = evaluateTwinContradictionRules({
      ...input,
      memoryHits: [input.memoryHits[0]!],
    });
    expect(a).toEqual(b);
  });

  it("isolates bundles per call (no cross-user leakage between evaluations)", () => {
    const userA: TwinContradictionRuleEvalInput = {
      scenarioText: "I always ignore documentation",
      patternSummary: emptySummary(),
      memoryHits: [hit({ source: "diary", id: "1", previewText: "never ignore documentation" })],
      verifications: [],
    };
    const userB: TwinContradictionRuleEvalInput = {
      scenarioText: "Watering plants",
      patternSummary: emptySummary(),
      memoryHits: [hit({ source: "diary", id: "2", previewText: "weekly garden care" })],
      verifications: [],
    };
    const ra = evaluateTwinContradictionRules(userA);
    const rb = evaluateTwinContradictionRules(userB);
    expect(ra.contradictions.length).toBeGreaterThan(0);
    expect(rb.contradictions).toEqual([]);
    expect(ra.contradictions.some((c) => c.type === "decision_inconsistency")).toBe(true);
  });

  it("sorts findings by severity then type", () => {
    const input: TwinContradictionRuleEvalInput = {
      scenarioText: "I need autonomy and transparent tradeoffs",
      patternSummary: {
        ...emptySummary(),
        contradictions: ['Contrast between memories: "happy" vs "sad"'],
        dominantThemes: ["Theme (mentions=1): security"],
      },
      memoryHits: [hit({ source: "diary", id: "s", previewText: "safety review before launch" })],
      verifications: [
        { verification: "inaccurate", scenario: "x", correction: "a" },
        { verification: "inaccurate", scenario: "y", correction: "b" },
        { verification: "inaccurate", scenario: "z", correction: "c" },
      ],
    };
    const { contradictions } = evaluateTwinContradictionRules(input);
    const severities = contradictions.map((c) => c.severity);
    const rank = (s: string) => (s === "high" ? 0 : s === "medium" ? 1 : 2);
    for (let i = 1; i < contradictions.length; i++) {
      const prev = rank(severities[i - 1]!);
      const cur = rank(severities[i]!);
      expect(cur >= prev).toBe(true);
    }
  });
});
