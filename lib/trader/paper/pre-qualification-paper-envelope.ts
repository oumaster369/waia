import type { PaperCanonicalOrdinaryCapitalEnvelopeV2 } from "@/lib/trader/paper/paper-cycle.types";

/** Structural placeholder. It is not a scientific qualification digest. */
export const PRE_QUALIFICATION_CONTEXT_DIGEST_HEX = "0".repeat(64);

/**
 * Envelope for a paper bar before C3 qualification exists.
 * Navigator and future-cycle receipts stay null. The canonical cycle must refuse at EPISTEMIC.
 */
export function buildPreQualificationPaperEnvelope(): PaperCanonicalOrdinaryCapitalEnvelopeV2 {
  return {
    contextInputs: {
      runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
      runtimeAssessmentDigestHex: PRE_QUALIFICATION_CONTEXT_DIGEST_HEX,
      driftPosture: "NORMAL",
      driftRestrictionDigestHex: PRE_QUALIFICATION_CONTEXT_DIGEST_HEX,
      qualificationTupleDigestHex: PRE_QUALIFICATION_CONTEXT_DIGEST_HEX,
      packageDigestHex: PRE_QUALIFICATION_CONTEXT_DIGEST_HEX,
      informationContractDigestHex: PRE_QUALIFICATION_CONTEXT_DIGEST_HEX,
      informationNeedPlanDigestHex: PRE_QUALIFICATION_CONTEXT_DIGEST_HEX,
      releaseDigestHex: PRE_QUALIFICATION_CONTEXT_DIGEST_HEX,
    },
    navigatorReceipt: null,
    predictiveAdmissionVerdict: "NOT_ADMITTED",
    futureCycleEffect: null,
    currentRuntimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    currentDriftPosture: "NORMAL",
  };
}
