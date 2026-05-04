import { describe, expect, it } from "vitest";

import type { TwinReadinessResult } from "@/lib/dashboard/twin-readiness-api.types";
import { TWIN_UNLOCK_FEATURES, type TwinUnlockInput } from "@/lib/dashboard/twin-unlock-api.types";
import {
  computeTwinUnlockState,
  isFeatureUnlocked,
  TWIN_UNLOCK_RULES,
} from "@/lib/reasoning/twin-unlock";
import { getTwinReadinessEventByType } from "@/lib/reasoning/twin-readiness-events";

function makeReadiness(
  partial: Partial<TwinReadinessResult> & { scores: TwinReadinessResult["scores"] },
): TwinReadinessResult {
  return {
    schemaVersion: "twin-readiness-v1",
    overall: partial.overall ?? 0,
    level: partial.level ?? "low",
    scores: partial.scores,
  };
}

function unlockInput(readiness: TwinReadinessResult, events: TwinUnlockInput["events"] = []): TwinUnlockInput {
  return { readiness, events };
}

describe("twin unlock (DEE-44)", () => {
  it("state keys follow stable TWIN_UNLOCK_FEATURES order", () => {
    const readiness = makeReadiness({
      scores: { baseModel: 0, memory: 0, patterns: 0, contradictions: 0, consistency: 0, feedback: 0 },
    });
    const state = computeTwinUnlockState(unlockInput(readiness));
    expect(Object.keys(state)).toEqual([...TWIN_UNLOCK_FEATURES]);
  });

  it("empty readiness keeps every feature locked", () => {
    const readiness = makeReadiness({
      scores: { baseModel: 0, memory: 0, patterns: 0, contradictions: 0, consistency: 0, feedback: 0 },
    });
    const state = computeTwinUnlockState(unlockInput(readiness));
    for (const f of TWIN_UNLOCK_FEATURES) {
      expect(state[f].unlocked).toBe(false);
    }
    expect(isFeatureUnlocked("diary", state)).toBe(false);
  });

  it("minimal base progress unlocks diary only", () => {
    const readiness = makeReadiness({
      overall: 0.1,
      scores: { baseModel: 0.35, memory: 0, patterns: 0, contradictions: 0, consistency: 0, feedback: 0 },
    });
    const state = computeTwinUnlockState(unlockInput(readiness));
    expect(state.diary.unlocked).toBe(true);
    expect(state.twin_chat.unlocked).toBe(false);
    expect(state.predictions.unlocked).toBe(false);
    expect(state.personality_insights.unlocked).toBe(false);
    expect(state.society.unlocked).toBe(false);
  });

  it("memory unlocks twin chat but not predictions when overall and feedback are low", () => {
    const readiness = makeReadiness({
      overall: 0.25,
      scores: {
        baseModel: 0.35,
        memory: 0.3,
        patterns: 0,
        contradictions: 0,
        consistency: 0,
        feedback: 0,
      },
    });
    const state = computeTwinUnlockState(unlockInput(readiness));
    expect(state.twin_chat.unlocked).toBe(true);
    expect(state.predictions.unlocked).toBe(false);
    expect(state.predictions.reason).toContain("Overall");
  });

  it("predictions require feedback even when overall is high enough", () => {
    const readiness = makeReadiness({
      overall: 0.5,
      scores: {
        baseModel: 0.5,
        memory: 0.4,
        patterns: 0.2,
        contradictions: 0.2,
        consistency: 0.3,
        feedback: 0.1,
      },
    });
    const state = computeTwinUnlockState(unlockInput(readiness));
    expect(state.predictions.unlocked).toBe(false);
    expect(state.predictions.reason.toLowerCase()).toContain("feedback");
  });

  it("society requires combined overall, consistency, and feedback", () => {
    const almost = makeReadiness({
      overall: 0.65,
      scores: {
        baseModel: 0.9,
        memory: 0.4,
        patterns: 0.5,
        contradictions: 0.35,
        consistency: 0.55,
        feedback: 0.35,
      },
    });
    const state = computeTwinUnlockState(unlockInput(almost));
    expect(state.society.unlocked).toBe(false);
    expect(state.society.reason.toLowerCase()).toContain("feedback");
  });

  it("determinism: identical input yields identical state", () => {
    const readiness = makeReadiness({
      overall: 0.42,
      scores: {
        baseModel: 0.55,
        memory: 0.4,
        patterns: 0.2,
        contradictions: 0.35,
        consistency: 0.5,
        feedback: 0.25,
      },
    });
    const input = unlockInput(readiness, []);
    expect(computeTwinUnlockState(input)).toEqual(computeTwinUnlockState({ ...input }));
  });

  it("high memory alone does not unlock everything", () => {
    const readiness = makeReadiness({
      overall: 0.1,
      scores: {
        baseModel: 0.35,
        memory: 0.95,
        patterns: 0,
        contradictions: 0,
        consistency: 0,
        feedback: 0,
      },
    });
    const state = computeTwinUnlockState(unlockInput(readiness));
    expect(state.twin_chat.unlocked).toBe(true);
    expect(state.predictions.unlocked).toBe(false);
    expect(state.personality_insights.unlocked).toBe(false);
    expect(state.society.unlocked).toBe(false);
    expect(
      Object.values(state).every((e) => typeof e.reason === "string" && !e.reason.includes("1970")),
    ).toBe(true);
  });

  it("memory spike anti-fake keeps advanced locked even when thresholds would hold", () => {
    const readiness = makeReadiness({
      overall: 0.55,
      scores: {
        baseModel: 0.34,
        memory: TWIN_UNLOCK_RULES.memorySpikeThreshold,
        patterns: 0.5,
        contradictions: 0.85,
        consistency: 0.7,
        feedback: 0.45,
      },
    });
    const state = computeTwinUnlockState(unlockInput(readiness));
    expect(state.predictions.unlocked).toBe(false);
    expect(state.personality_insights.unlocked).toBe(false);
    expect(state.personality_insights.reason).toBe(
      "Memory signal is high relative to base model progress; advanced features stay locked until the base model catches up.",
    );
    expect(state.twin_chat.unlocked).toBe(true);
    expect(state.diary.unlocked).toBe(true);
  });

  it("isFeatureUnlocked returns false for unknown feature ids", () => {
    const readiness = makeReadiness({
      scores: { baseModel: 1, memory: 1, patterns: 1, contradictions: 1, consistency: 1, feedback: 1 },
      overall: 0.95,
      level: "high",
    });
    const state = computeTwinUnlockState(unlockInput(readiness));
    expect(isFeatureUnlocked("not_a_feature", state)).toBe(false);
  });

  it("accepts events array without changing v1 scoring (fixture with catalog snippet)", () => {
    const ev = getTwinReadinessEventByType("prediction_verified");
    expect(ev).toBeDefined();
    const readiness = makeReadiness({
      overall: 0.25,
      scores: {
        baseModel: 0.35,
        memory: 0.3,
        patterns: 0,
        contradictions: 0,
        consistency: 0,
        feedback: 0,
      },
    });
    const withEv = unlockInput(readiness, ev ? [ev] : []);
    const empty = unlockInput(readiness, []);
    expect(computeTwinUnlockState(withEv)).toEqual(computeTwinUnlockState(empty));
  });
});
