import { describe, expect, it } from "vitest";

import { buildHistoricalHypothesisApplicabilitySetV2 } from
  "@/lib/trader/historical-simulation-v2/hypothesis-applicability-v2";
import type { HypothesisSet, MarketHypothesis } from
  "@/lib/trader/intelligence/hypothesis/hypothesis.types";

const PIT = "2026-01-01T00:01:00.000Z";
const SHA = "1".repeat(40);

function hypothesis(authority: MarketHypothesis["authority"]): MarketHypothesis {
  return {
    hypothesisType: "mean_reversion", confidence: 0.8, supportingEvidence: ["range"],
    contradictingEvidence: [], expectedPath: "revert_to_mean", invalidationConditions: ["trend"],
    eligibleStrategyFamilies: ["mean_reversion"], authority,
  };
}

function set(active: MarketHypothesis | null, authorized: boolean): HypothesisSet {
  return {
    schemaVersion: "waia.trader.hypothesis_set.v1", evaluatedAt: PIT,
    hypotheses: active ? [active] : [], activeHypothesis: active,
    opportunity: active ? {
      authorized, hypothesisType: active.hypothesisType, conviction: active.confidence,
      sustainedCycles: 3, eligibleStrategyFamilies: active.eligibleStrategyFamilies,
      reasonCode: authorized ? "HYP_CONVICTION_SUSTAINED" : "HYP_CONVICTION_INSUFFICIENT",
    } : null,
  };
}

function build(hypothesisSet: HypothesisSet) {
  return buildHistoricalHypothesisApplicabilitySetV2({
    releaseSha: SHA, organizationId: "org", symbol: "BTCUSDT", pitAnchor: PIT, hypothesisSet,
  });
}

describe("historical hypothesis applicability v2", () => {
  it("admits only an authorized canonical PIT knowledge hypothesis", () => {
    expect(build(set(hypothesis("CANONICAL_PIT_KNOWLEDGE"), true)).assessments[0]?.status)
      .toBe("APPLICABLE");
    expect(build(set(hypothesis("LEGACY_DIAGNOSTIC"), true)).assessments[0]?.status)
      .toBe("BLOCKED");
  });

  it("records cold start and unauthorized canonical evidence without fabricating applicability", () => {
    expect(build(set(null, false)).assessments[0]?.status).toBe("BLOCKED");
    expect(build(set(hypothesis("CANONICAL_PIT_KNOWLEDGE"), false)).assessments[0]?.status)
      .toBe("NOT_APPLICABLE");
    expect(build(set(null, false))).toEqual(build(set(null, false)));
  });
});
