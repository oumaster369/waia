import { describe, expect, it } from "vitest";

import { TWIN_BASE_MODEL_DIMENSIONS } from "@/lib/dashboard/twin-base-model-api.types";
import type { TwinBaseModelDimensionCounts, TwinBaseModelScores } from "@/lib/dashboard/twin-base-model-api.types";
import {
  computeTwinBaseModelScores,
  countTwinBaseModelAnswersByDimension,
  deriveTwinBaseSignals,
  getTwinBaseModelQuestionById,
  TWIN_BASE_MODEL_QUESTIONNAIRE,
  TWIN_BASE_MODEL_QUESTIONNAIRE_REVISION,
} from "@/lib/reasoning/twin-base-model";

function fullAnswersAllD(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const q of TWIN_BASE_MODEL_QUESTIONNAIRE) {
    m[q.id] = "d";
  }
  return m;
}

/** Synthetic counts: every dimension has at least one answer (for threshold tests with hand-made scores). */
function countsAllOnes(): TwinBaseModelDimensionCounts {
  const o = {} as TwinBaseModelDimensionCounts;
  for (const d of TWIN_BASE_MODEL_DIMENSIONS) {
    o[d] = 1;
  }
  return o;
}

describe("twin base model (DEE-24)", () => {
  it("questionnaire structure: 10 questions, 4 options, valid dimensions", () => {
    expect(TWIN_BASE_MODEL_QUESTIONNAIRE.length).toBe(10);
    const setDim = new Set(TWIN_BASE_MODEL_DIMENSIONS);
    for (const q of TWIN_BASE_MODEL_QUESTIONNAIRE) {
      expect(q.options.length).toBe(4);
      for (const o of q.options) {
        expect(o.score).toBeGreaterThanOrEqual(0);
        expect(o.score).toBeLessThanOrEqual(4);
      }
      expect(setDim.has(q.dimension)).toBe(true);
    }
    expect(TWIN_BASE_MODEL_QUESTIONNAIRE_REVISION).toBe(1);
  });

  it("empty answers yields zero scores and empty derived signals", () => {
    const s = computeTwinBaseModelScores({});
    expect(Object.keys(s).sort()).toEqual([...TWIN_BASE_MODEL_DIMENSIONS]);
    for (const d of TWIN_BASE_MODEL_DIMENSIONS) {
      expect(s[d]).toBe(0);
    }
    const d = deriveTwinBaseSignals(s, countTwinBaseModelAnswersByDimension({}));
    expect(d.dominantTraits).toEqual([]);
    expect(d.riskPatterns).toEqual([]);
    expect(d.strengths).toEqual([]);
  });

  it("full answers yields normalized scores in (0, 1]", () => {
    const s = computeTwinBaseModelScores(fullAnswersAllD());
    for (const k of TWIN_BASE_MODEL_DIMENSIONS) {
      expect(s[k]).toBeGreaterThan(0);
      expect(s[k]).toBeLessThanOrEqual(1);
    }
    expect(s.decision_style).toBe(1);
    const sum = TWIN_BASE_MODEL_DIMENSIONS.reduce((acc, k) => acc + s[k], 0);
    expect(sum).toBeGreaterThan(0);
  });

  it("partial answers stable with zeros for untouched dimensions", () => {
    const s = computeTwinBaseModelScores({
      base_model_q01: "b",
      base_model_q03: "c",
      base_model_q09: "a",
    });
    expect(Number.isNaN(s.decision_style)).toBe(false);
    expect(s.goal_orientation_vs_drift).toBe(0);
    expect(s.avoidance_vs_confrontation).toBe(0);
  });

  it("determinism: same answers produce identical scores and derived", () => {
    const a = fullAnswersAllD();
    const s1 = computeTwinBaseModelScores(a);
    const s2 = computeTwinBaseModelScores({ ...a });
    expect(s1).toEqual(s2);
    const c = countTwinBaseModelAnswersByDimension(a);
    expect(deriveTwinBaseSignals(s1, c)).toEqual(deriveTwinBaseSignals(s2, c));
  });

  it("unknown option values are ignored", () => {
    const s = computeTwinBaseModelScores({
      base_model_q01: "zzzzz",
    });
    expect(s.decision_style).toBe(0);
  });

  it("unknown question ids ignored", () => {
    const s = computeTwinBaseModelScores({
      not_a_question: "a",
    } as Record<string, string>);
    expect(s.decision_style).toBe(0);
  });

  it("dimension isolation: only decision_style questions answered", () => {
    const s = computeTwinBaseModelScores({
      base_model_q01: "d",
      base_model_q02: "d",
    });
    expect(s.decision_style).toBe(1);
    expect(s.emotional_regulation).toBe(0);
    expect(s.self_trust_vs_external_validation).toBe(0);
  });

  it("derived signals respect thresholds and max list size", () => {
    const high: TwinBaseModelScores = {
      avoidance_vs_confrontation: 0.7,
      consistency_vs_impulsiveness: 0.7,
      decision_style: 0.7,
      emotional_regulation: 0.7,
      goal_orientation_vs_drift: 0.7,
      self_trust_vs_external_validation: 0.7,
    };
    const d = deriveTwinBaseSignals(high, countsAllOnes());
    expect(d.dominantTraits.length).toBeLessThanOrEqual(5);
    expect(d.riskPatterns.length).toBeLessThanOrEqual(5);
    expect(d.strengths.length).toBeLessThanOrEqual(5);
    expect(d.dominantTraits).toContain("tends toward reflective decisions");
    expect(d.strengths.length).toBeGreaterThan(0);
  });

  it("low-score pattern adds risk hints without clinical wording", () => {
    const low: TwinBaseModelScores = {
      avoidance_vs_confrontation: 0.2,
      consistency_vs_impulsiveness: 0.2,
      decision_style: 0.2,
      emotional_regulation: 0.2,
      goal_orientation_vs_drift: 0.2,
      self_trust_vs_external_validation: 0.2,
    };
    const d = deriveTwinBaseSignals(low, countsAllOnes());
    expect(d.riskPatterns.join(" ").toLowerCase()).not.toContain("disorder");
    expect(d.riskPatterns.join(" ").toLowerCase()).not.toContain("diagnos");
  });

  it("getTwinBaseModelQuestionById returns question", () => {
    expect(getTwinBaseModelQuestionById("base_model_q01")?.id).toBe("base_model_q01");
    expect(getTwinBaseModelQuestionById("missing")).toBeUndefined();
  });

  it("score keys remain the schema dimension set", () => {
    const s = computeTwinBaseModelScores(fullAnswersAllD());
    expect(new Set(Object.keys(s))).toEqual(new Set(TWIN_BASE_MODEL_DIMENSIONS));
  });
});
