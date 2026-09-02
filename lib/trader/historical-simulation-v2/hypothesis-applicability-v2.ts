import { isDeepStrictEqual } from "node:util";

import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HypothesisSet } from
  "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import {
  buildCanonicalHistoricalApplicabilityReceiptV1,
  requireCanonicalHistoricalApplicabilityReceiptV1,
} from
  "@/lib/trader/intelligence/hypothesis/canonical-historical-applicability-v1";
import type { CanonicalRuntimeIntelligenceStateV1 } from
  "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import type { ReconstructionSnapshot } from
  "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import { computeReconstructionContentDigest } from
  "@/lib/trader/intelligence/reconstruction/reconstruction-assembly";
import {
  computeCanonicalCycleCausalInputDigestV2,
  parseCanonicalCycleCausalInputBundleV2,
} from "@/lib/trader/intelligence/records/causal-input-bundle-v2";
import { computeCycleEnvelopeContentDigest } from
  "@/lib/trader/intelligence/records/serialize-intelligence-records";
import type { TraderIntelligenceCycleEnvelopeRecord } from
  "@/lib/trader/intelligence/records/intelligence-records.types";
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
  reconstruction: ReconstructionSnapshot;
  canonicalRuntimeIntelligenceState: CanonicalRuntimeIntelligenceStateV1;
  evaluationEnvelope: TraderIntelligenceCycleEnvelopeRecord;
  hypothesisSet: HypothesisSet;
}>): HistoricalHypothesisApplicabilitySetV2 {
  if (!/^[0-9a-f]{40}$/.test(input.releaseSha) || !input.organizationId.trim() ||
      !input.symbol.trim() || new Date(input.pitAnchor).toISOString() !== input.pitAnchor ||
      input.hypothesisSet.evaluatedAt !== input.pitAnchor ||
      input.reconstruction.evaluatedAt !== input.pitAnchor ||
      input.canonicalRuntimeIntelligenceState.organizationId !== input.organizationId ||
      input.canonicalRuntimeIntelligenceState.symbol !== input.symbol ||
      input.canonicalRuntimeIntelligenceState.pitAnchor !== input.pitAnchor) {
    throw new Error("HISTORICAL_HYPOTHESIS_APPLICABILITY_REFUSED:IDENTITY");
  }
  const envelope = input.evaluationEnvelope;
  const causalInput = envelope.inputCausalBundleJson
    ? parseCanonicalCycleCausalInputBundleV2(envelope.inputCausalBundleJson)
    : null;
  const sealedEvaluationValid =
    causalInput !== null &&
    computeCycleEnvelopeContentDigest(envelope) === envelope.contentDigest &&
    computeCanonicalCycleCausalInputDigestV2(causalInput) === envelope.inputSemanticDigest &&
    envelope.organizationId === input.organizationId &&
    envelope.symbol === input.symbol &&
    envelope.evaluatedAt === input.pitAnchor &&
    causalInput.scope.organizationId === input.organizationId &&
    causalInput.scope.instrumentId === input.reconstruction.instrumentId &&
    causalInput.scope.evaluatedAt === input.pitAnchor &&
    computeReconstructionContentDigest(input.reconstruction) ===
      input.reconstruction.contentDigest &&
    causalInput.reconstruction.schemaVersion === input.reconstruction.schemaVersion &&
    causalInput.reconstruction.contentDigest === input.reconstruction.contentDigest &&
    causalInput.hypothesisConstruction.hypothesisSetContentDigest ===
      computeSemanticSha256Hex(input.hypothesisSet) &&
    isDeepStrictEqual(
      causalInput.hypothesisConstruction.canonicalIntelligenceStateDigests,
      [input.canonicalRuntimeIntelligenceState.semanticDigest],
    );
  const evaluatorIdentityDigestHex = computeSemanticSha256Hex({
    evaluatorVersion: HISTORICAL_HYPOTHESIS_APPLICABILITY_EVALUATOR_V2,
    releaseSha: input.releaseSha,
  });
  const active = input.hypothesisSet.activeHypothesis;
  const opportunity = input.hypothesisSet.opportunity;
  let receiptValid = false;
  if (sealedEvaluationValid && active && opportunity?.applicabilityReceipt) {
    try {
      const receipt = requireCanonicalHistoricalApplicabilityReceiptV1(
        opportunity.applicabilityReceipt,
      );
      const replayedReceipt = buildCanonicalHistoricalApplicabilityReceiptV1({
        reconstruction: input.reconstruction,
        canonicalState: input.canonicalRuntimeIntelligenceState,
        activeHypothesis: active,
      });
      receiptValid =
        isDeepStrictEqual(receipt, replayedReceipt) &&
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
