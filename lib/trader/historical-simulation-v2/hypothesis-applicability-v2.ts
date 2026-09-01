import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HypothesisSet } from
  "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import type { HypothesisApplicabilityAssessmentV1 } from
  "@/lib/trader/intelligence/predictive-admission";

export const HISTORICAL_HYPOTHESIS_APPLICABILITY_EVALUATOR_V2 =
  "waia.trader.historical_hypothesis_applicability.v2" as const;

export type HistoricalHypothesisApplicabilitySetV2 = Readonly<{
  evaluatorIdentityDigestHex: string;
  assessments: readonly HypothesisApplicabilityAssessmentV1[];
  contentDigestHex: string;
}>;

/**
 * Converts the cycle's actual hypothesis result into Forecast V2 applicability evidence.
 * Legacy/diagnostic hypotheses are retained as BLOCKED evidence and can never be promoted
 * into predictive authority by this adapter.
 */
export function buildHistoricalHypothesisApplicabilitySetV2(input: Readonly<{
  releaseSha: string;
  organizationId: string;
  symbol: string;
  pitAnchor: string;
  hypothesisSet: HypothesisSet;
}>): HistoricalHypothesisApplicabilitySetV2 {
  if (!/^[0-9a-f]{40}$/.test(input.releaseSha) || !input.organizationId.trim() ||
      !input.symbol.trim() || new Date(input.pitAnchor).toISOString() !== input.pitAnchor ||
      input.hypothesisSet.evaluatedAt !== input.pitAnchor) {
    throw new Error("HISTORICAL_HYPOTHESIS_APPLICABILITY_REFUSED:IDENTITY");
  }
  const evaluatorIdentityDigestHex = computeSemanticSha256Hex({
    evaluatorVersion: HISTORICAL_HYPOTHESIS_APPLICABILITY_EVALUATOR_V2,
    releaseSha: input.releaseSha,
  });
  const active = input.hypothesisSet.activeHypothesis;
  const status: HypothesisApplicabilityAssessmentV1["status"] =
    !active || !input.hypothesisSet.opportunity
      ? "BLOCKED"
      : active.authority !== "CANONICAL_PIT_KNOWLEDGE"
        ? "BLOCKED"
        : input.hypothesisSet.opportunity.authorized
          ? "APPLICABLE"
          : "NOT_APPLICABLE";
  const assessmentBody = {
    evaluatorIdentityDigestHex,
    organizationId: input.organizationId,
    symbol: input.symbol,
    pitAnchor: input.pitAnchor,
    hypothesisSetSchemaVersion: input.hypothesisSet.schemaVersion,
    activeHypothesis: active ?? null,
    opportunity: input.hypothesisSet.opportunity ?? null,
    status,
  };
  const assessment = Object.freeze({
    hypothesisAssessmentContentDigestHex: computeSemanticSha256Hex(assessmentBody),
    evaluatorIdentityDigestHex,
    status,
  });
  const assessments = Object.freeze([assessment]);
  return Object.freeze({
    evaluatorIdentityDigestHex,
    assessments,
    contentDigestHex: computeSemanticSha256Hex({ assessments }),
  });
}
