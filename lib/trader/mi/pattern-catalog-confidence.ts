import type { PatternCatalogOutcomeTag } from "@/lib/trader/mi/pattern-catalog.types";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

const DEFAULT_PRIOR_HITS = 1;
const DEFAULT_PRIOR_MISSES = 1;

function clampScore(value: string): string {
  if (compareDecimal(value, "0") < 0) {
    return "0";
  }
  if (compareDecimal(value, "1") > 0) {
    return "1";
  }
  return value;
}

export type PatternConfidenceState = {
  priorHits: number;
  priorMisses: number;
};

export function createInitialPatternConfidenceState(): PatternConfidenceState {
  return {
    priorHits: DEFAULT_PRIOR_HITS,
    priorMisses: DEFAULT_PRIOR_MISSES,
  };
}

function outcomeToHitMiss(outcomeTag: PatternCatalogOutcomeTag): {
  hitDelta: number;
  missDelta: number;
  rationale: string;
} {
  switch (outcomeTag) {
    case "supporting":
      return {
        hitDelta: 1,
        missDelta: 0,
        rationale: "outcome_tag_supporting",
      };
    case "contradicting":
      return {
        hitDelta: 0,
        missDelta: 1,
        rationale: "outcome_tag_contradicting",
      };
    default:
      return {
        hitDelta: 0,
        missDelta: 0,
        rationale: "outcome_tag_neutral",
      };
  }
}

export function updatePatternConfidenceState(input: {
  state: PatternConfidenceState;
  outcomeTag: PatternCatalogOutcomeTag;
}): {
  state: PatternConfidenceState;
  confidenceMean: string;
  confidenceBandLow: string;
  confidenceBandHigh: string;
  rationale: readonly string[];
} {
  const { hitDelta, missDelta, rationale } = outcomeToHitMiss(input.outcomeTag);
  const nextHits = input.state.priorHits + hitDelta;
  const nextMisses = input.state.priorMisses + missDelta;
  const total = nextHits + nextMisses;
  const mean = divideDecimal(String(nextHits), String(total));
  const variance = divideDecimal(
    multiplyDecimal(mean, subtractDecimal("1", mean)),
    String(total + 1),
  );
  const bandHalfWidth = multiplyDecimal(formatDecimal(parseDecimal(variance)), "2");
  const bandLow = clampScore(subtractDecimal(mean, bandHalfWidth));
  const bandHigh = clampScore(addDecimal(mean, bandHalfWidth));

  return {
    state: {
      priorHits: nextHits,
      priorMisses: nextMisses,
    },
    confidenceMean: clampScore(mean),
    confidenceBandLow: bandLow,
    confidenceBandHigh: bandHigh,
    rationale: [
      rationale,
      `posterior_hits=${nextHits}`,
      `posterior_misses=${nextMisses}`,
      "descriptive_consistency_not_success_probability",
    ],
  };
}
