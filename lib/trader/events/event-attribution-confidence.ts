import type { EventAttributionOutcomeTag } from "@/lib/trader/events/event-attribution.types";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

const DEFAULT_PRIOR_SUPPORTING = 1;
const DEFAULT_PRIOR_CONTRADICTING = 1;

function clampScore(value: string): string {
  if (compareDecimal(value, "0") < 0) {
    return "0";
  }
  if (compareDecimal(value, "1") > 0) {
    return "1";
  }
  return value;
}

export type EventAttributionConfidenceState = {
  priorSupporting: number;
  priorContradicting: number;
};

export function createInitialEventAttributionConfidenceState(): EventAttributionConfidenceState {
  return {
    priorSupporting: DEFAULT_PRIOR_SUPPORTING,
    priorContradicting: DEFAULT_PRIOR_CONTRADICTING,
  };
}

function outcomeToSupportingContradicting(outcomeTag: EventAttributionOutcomeTag): {
  supportingDelta: number;
  contradictingDelta: number;
  rationale: string;
} {
  switch (outcomeTag) {
    case "supporting":
      return {
        supportingDelta: 1,
        contradictingDelta: 0,
        rationale: "attribution_co_occurred_with_observed_outcome",
      };
    case "contradicting":
      return {
        supportingDelta: 0,
        contradictingDelta: 1,
        rationale: "attribution_pattern_mismatch",
      };
    default:
      return {
        supportingDelta: 0,
        contradictingDelta: 0,
        rationale: "attribution_evidence_neutral",
      };
  }
}

export function updateEventAttributionConfidenceState(input: {
  state: EventAttributionConfidenceState;
  outcomeTag: EventAttributionOutcomeTag;
}): {
  state: EventAttributionConfidenceState;
  confidenceMean: string;
  confidenceBandLow: string;
  confidenceBandHigh: string;
  rationale: readonly string[];
} {
  const { supportingDelta, contradictingDelta, rationale } = outcomeToSupportingContradicting(
    input.outcomeTag,
  );
  const nextSupporting = input.state.priorSupporting + supportingDelta;
  const nextContradicting = input.state.priorContradicting + contradictingDelta;
  const total = nextSupporting + nextContradicting;
  const mean = divideDecimal(String(nextSupporting), String(total));
  const variance = divideDecimal(
    multiplyDecimal(mean, subtractDecimal("1", mean)),
    String(total + 1),
  );
  const bandHalfWidth = multiplyDecimal(formatDecimal(parseDecimal(variance)), "2");
  const bandLow = clampScore(subtractDecimal(mean, bandHalfWidth));
  const bandHigh = clampScore(addDecimal(mean, bandHalfWidth));

  return {
    state: {
      priorSupporting: nextSupporting,
      priorContradicting: nextContradicting,
    },
    confidenceMean: clampScore(mean),
    confidenceBandLow: bandLow,
    confidenceBandHigh: bandHigh,
    rationale: [
      rationale,
      `posterior_supporting=${nextSupporting}`,
      `posterior_contradicting=${nextContradicting}`,
      "descriptive_attribution_not_success_probability",
    ],
  };
}
