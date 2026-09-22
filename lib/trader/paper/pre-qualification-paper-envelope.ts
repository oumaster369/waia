import type { PaperCanonicalOrdinaryCapitalEnvelopeV2 } from "@/lib/trader/paper/paper-cycle.types";

/** Sources that do not exist before qualification. No digest is invented for them. */
export const PRE_QUALIFICATION_UNAVAILABLE_SOURCES = [
  "runtimeAssessment",
  "driftRestriction",
  "qualificationTuple",
  "package",
  "informationContract",
  "informationNeedPlan",
  "release",
] as const;

/**
 * Envelope for a paper bar before qualification artifacts exist.
 * It names the missing sources and is not a qualified runtime context.
 */
export function buildPreQualificationPaperEnvelope(): PaperCanonicalOrdinaryCapitalEnvelopeV2 {
  return {
    navigatorReceipt: null,
    predictiveAdmissionVerdict: "NOT_ADMITTED",
    futureCycleEffect: null,
    currentRuntimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    currentDriftPosture: "NORMAL",
    unavailableContextSources: PRE_QUALIFICATION_UNAVAILABLE_SOURCES,
  };
}
