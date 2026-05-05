import "server-only";

/**
 * DEE-24 Twin base model — questionnaire and deterministic score mapping.
 * Behavioral style descriptors only: no clinical labels, identity claims, or therapy framing.
 */

import type {
  TwinBaseModelAnswers,
  TwinBaseModelDimension,
  TwinBaseModelDerivedSignals,
  TwinBaseModelDimensionCounts,
  TwinBaseModelQuestion,
  TwinBaseModelScores,
} from "@/lib/dashboard/twin-base-model-api.types";
import { TWIN_BASE_MODEL_DIMENSIONS } from "@/lib/dashboard/twin-base-model-api.types";

const SCORE_SCALE = 10 ** 4;

/** Monotonic revision when questions change. */
export const TWIN_BASE_MODEL_QUESTIONNAIRE_REVISION = 1;

function opt(
  value: string,
  score: number,
  label: string,
): { value: string; score: number; label: string } {
  return { value, score, label };
}

/**
 * Ten questions: two each for decision_style, emotional_regulation, avoidance_vs_confrontation,
 * consistency_vs_impulsiveness; one each for self_trust_vs_external_validation, goal_orientation_vs_drift.
 */
export const TWIN_BASE_MODEL_QUESTIONNAIRE: readonly TwinBaseModelQuestion[] = [
  {
    id: "base_model_q01",
    dimension: "decision_style",
    prompt: "When a decision matters, I usually:",
    options: [
      opt("a", 0, "Decide quickly and move on"),
      opt("b", 1, "Decide fairly soon after a short check"),
      opt("c", 2, "Take time to weigh options before choosing"),
      opt("d", 4, "Prefer to reflect and gather context before committing"),
    ],
  },
  {
    id: "base_model_q02",
    dimension: "decision_style",
    prompt: "Under time pressure, I tend to:",
    options: [
      opt("a", 0, "Pick the first workable option"),
      opt("b", 1, "Pick quickly, then adjust if needed"),
      opt("c", 2, "Balance speed with a quick comparison"),
      opt("d", 4, "Still try to pause briefly to avoid a rash choice"),
    ],
  },
  {
    id: "base_model_q03",
    dimension: "emotional_regulation",
    prompt: "When stress ramps up, my reactions tend to be:",
    options: [
      opt("a", 0, "Hard to settle for a while"),
      opt("b", 1, "Up and down before I steady"),
      opt("c", 2, "Noticeable but manageable"),
      opt("d", 4, "Generally steady; I can regroup"),
    ],
  },
  {
    id: "base_model_q04",
    dimension: "emotional_regulation",
    prompt: "After a sharp setback, I usually:",
    options: [
      opt("a", 0, "Feel thrown off for a noticeable stretch"),
      opt("b", 1, "Need time before I feel back on track"),
      opt("c", 2, "Recover steadily with some effort"),
      opt("d", 4, "Return to baseline relatively soon"),
    ],
  },
  {
    id: "base_model_q05",
    dimension: "avoidance_vs_confrontation",
    prompt: "When tension appears in a conversation, I tend to:",
    options: [
      opt("a", 0, "Step back or change the subject"),
      opt("b", 1, "Delay addressing it until necessary"),
      opt("c", 2, "Address it cautiously when it feels safe"),
      opt("d", 4, "Name it and work through it directly"),
    ],
  },
  {
    id: "base_model_q06",
    dimension: "avoidance_vs_confrontation",
    prompt: "If I disagree with someone close, I:",
    options: [
      opt("a", 0, "Often keep quiet to keep peace"),
      opt("b", 1, "Hint at it indirectly"),
      opt("c", 2, "Speak up when it matters"),
      opt("d", 4, "Prefer to say it clearly and respectfully"),
    ],
  },
  {
    id: "base_model_q07",
    dimension: "consistency_vs_impulsiveness",
    prompt: "My follow-through on plans I care about is usually:",
    options: [
      opt("a", 0, "Pretty consistent and predictable"),
      opt("b", 1, "Mostly steady with occasional slips"),
      opt("c", 2, "Mixed—depends on the week"),
      opt("d", 4, "More spur-of-the-moment than steady"),
    ],
  },
  {
    id: "base_model_q08",
    dimension: "consistency_vs_impulsiveness",
    prompt: "When something exciting appears, I:",
    options: [
      opt("a", 0, "Stick to what I already committed to"),
      opt("b", 1, "Usually hold course"),
      opt("c", 2, "Sometimes shift focus"),
      opt("d", 4, "Often reprioritize toward the new thing"),
    ],
  },
  {
    id: "base_model_q09",
    dimension: "self_trust_vs_external_validation",
    prompt: "Before acting on a judgment call, I:",
    options: [
      opt("a", 0, "Often check what others would approve"),
      opt("b", 1, "Sometimes seek reassurance"),
      opt("c", 2, "Mix my own read with outside input"),
      opt("d", 4, "Rely mainly on my own read once I have enough context"),
    ],
  },
  {
    id: "base_model_q10",
    dimension: "goal_orientation_vs_drift",
    prompt: "Over the next few months, my priorities feel:",
    options: [
      opt("a", 0, "Unclear or shifting week to week"),
      opt("b", 1, "Loosely defined"),
      opt("c", 2, "Mostly clear with some flexibility"),
      opt("d", 4, "Clear enough to guide weekly choices"),
    ],
  },
];

const QUESTION_BY_ID = new Map<string, TwinBaseModelQuestion>(
  TWIN_BASE_MODEL_QUESTIONNAIRE.map((q) => [q.id, q]),
);

const DIMENSION_SET = new Set<string>(TWIN_BASE_MODEL_DIMENSIONS);

export function getTwinBaseModelQuestionById(id: string): TwinBaseModelQuestion | undefined {
  return QUESTION_BY_ID.get(id);
}

function clamp01Scaled(x: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  const y = Math.max(0, Math.min(1, x));
  return Math.round(y * SCORE_SCALE) / SCORE_SCALE;
}

function emptyScores(): TwinBaseModelScores {
  const o = {} as TwinBaseModelScores;
  for (const d of TWIN_BASE_MODEL_DIMENSIONS) {
    o[d] = 0;
  }
  return o;
}

function emptyDimensionCounts(): TwinBaseModelDimensionCounts {
  const o = {} as TwinBaseModelDimensionCounts;
  for (const d of TWIN_BASE_MODEL_DIMENSIONS) {
    o[d] = 0;
  }
  return o;
}

function aggregateTwinBaseAnswers(answers: TwinBaseModelAnswers): {
  sums: Record<TwinBaseModelDimension, number>;
  counts: TwinBaseModelDimensionCounts;
} {
  const sums: Record<TwinBaseModelDimension, number> = {
    avoidance_vs_confrontation: 0,
    consistency_vs_impulsiveness: 0,
    decision_style: 0,
    emotional_regulation: 0,
    goal_orientation_vs_drift: 0,
    self_trust_vs_external_validation: 0,
  };
  const counts = emptyDimensionCounts();

  for (const [questionId, selectedValue] of Object.entries(answers)) {
    const q = QUESTION_BY_ID.get(questionId);
    if (q == null) {
      continue;
    }
    if (!DIMENSION_SET.has(q.dimension)) {
      continue;
    }
    const option = q.options.find((o) => o.value === selectedValue);
    if (option == null) {
      continue;
    }
    const dim = q.dimension as TwinBaseModelDimension;
    sums[dim] += option.score;
    counts[dim] += 1;
  }

  return { sums, counts };
}

export function countTwinBaseModelAnswersByDimension(
  answers: TwinBaseModelAnswers,
): TwinBaseModelDimensionCounts {
  return aggregateTwinBaseAnswers(answers).counts;
}

export function computeTwinBaseModelScores(answers: TwinBaseModelAnswers): TwinBaseModelScores {
  const { sums, counts } = aggregateTwinBaseAnswers(answers);
  const out = emptyScores();
  for (const d of TWIN_BASE_MODEL_DIMENSIONS) {
    const n = counts[d];
    if (n <= 0) {
      out[d] = 0;
    } else {
      out[d] = clamp01Scaled(sums[d] / n / 4);
    }
  }
  return out;
}

const MAX_DERIVED = 5;

function uniqSorted(cap: number, items: string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b)).slice(0, cap);
}

/**
 * Threshold-only behavioral labels; sorted and capped. No clinical wording.
 * Pass `answerCounts` so dimensions with no matched answers (score 0) do not fire low/high rules.
 */
export function deriveTwinBaseSignals(
  scores: TwinBaseModelScores,
  answerCounts: TwinBaseModelDimensionCounts,
): TwinBaseModelDerivedSignals {
  const traits: string[] = [];
  const risks: string[] = [];
  const strengths: string[] = [];

  if (answerCounts.decision_style > 0) {
    if (scores.decision_style >= 0.65) {
      traits.push("tends toward reflective decisions");
    } else if (scores.decision_style <= 0.35) {
      traits.push("tends toward quick commitments");
    }
  }

  if (answerCounts.emotional_regulation > 0) {
    if (scores.emotional_regulation >= 0.65) {
      strengths.push("steadies reasonably well after stress");
    } else if (scores.emotional_regulation <= 0.35) {
      risks.push("stress can linger before settling");
    }
  }

  if (answerCounts.avoidance_vs_confrontation > 0) {
    if (scores.avoidance_vs_confrontation >= 0.65) {
      traits.push("addresses friction more directly");
    } else if (scores.avoidance_vs_confrontation <= 0.35) {
      risks.push("may defer tense topics");
    }
  }

  if (answerCounts.consistency_vs_impulsiveness > 0) {
    if (scores.consistency_vs_impulsiveness <= 0.35) {
      strengths.push("steady follow-through when it matters");
    } else if (scores.consistency_vs_impulsiveness >= 0.65) {
      traits.push("shifts priorities when new opportunities appear");
    }
  }

  if (answerCounts.self_trust_vs_external_validation > 0) {
    if (scores.self_trust_vs_external_validation >= 0.65) {
      strengths.push("relies on own judgment with context");
    } else if (scores.self_trust_vs_external_validation <= 0.35) {
      risks.push("may lean on outside reassurance");
    }
  }

  if (answerCounts.goal_orientation_vs_drift > 0) {
    if (scores.goal_orientation_vs_drift >= 0.65) {
      strengths.push("priorities feel usable for planning");
    } else if (scores.goal_orientation_vs_drift <= 0.35) {
      risks.push("priorities may feel unsettled week to week");
    }
  }

  return {
    dominantTraits: uniqSorted(MAX_DERIVED, traits),
    riskPatterns: uniqSorted(MAX_DERIVED, risks),
    strengths: uniqSorted(MAX_DERIVED, strengths),
  };
}
