import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HypothesisSet } from
  "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { requireCanonicalHistoricalApplicabilityReceiptV1 } from
  "@/lib/trader/intelligence/hypothesis/canonical-historical-applicability-v1";
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
  const opportunity = input.hypothesisSet.opportunity;
  let receiptValid = false;
  if (active && opportunity?.applicabilityReceipt) {
    try {
      const receipt = requireCanonicalHistoricalApplicabilityReceiptV1(
        opportunity.applicabilityReceipt,
      );
      receiptValid =
        receipt.contentDigestHex === opportunity.applicabilityReceiptContentDigestHex &&
        receipt.organizationId === input.organizationId &&
        receipt.symbol === input.symbol &&
        receipt.pitAnchor === input.pitAnchor &&
        receipt.canonicalHypothesisId === active.canonicalHypothesisId &&
        receipt.canonicalHypothesisCausalStateDigestHex ===
          active.canonicalHypothesisCausalStateDigest;
    } catch {
      receiptValid = false;
    }
  }
  const status: HypothesisApplicabilityAssessmentV1["status"] =
    !active || !opportunity
      ? "BLOCKED"
      : active.authority !== "CANONICAL_PIT_KNOWLEDGE"
        ? "BLOCKED"
        : opportunity.authorized &&
            opportunity.authority ===
              "CANONICAL_HISTORICAL_APPLICABILITY_RECEIPT_V1" &&
            opportunity.capitalAuthority === "NONE" &&
            /^[0-9a-f]{64}$/.test(
              opportunity.applicabilityReceiptContentDigestHex ?? "",
            ) && receiptValid
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
