import type { PaperCanonicalOrdinaryCapitalEnvelopeV2 } from "@/lib/trader/paper/paper-cycle.types";
import type { LiveEdgeDriftPostureV2 } from "@/lib/trader/restriction/live-edge-drift-restriction-v2";
import type { RuntimePostureV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-assessment-v2";

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
    unavailableContextSources: PRE_QUALIFICATION_UNAVAILABLE_SOURCES,
  };
}

/**
 * Postures are absent while a named source is unavailable. Building an admission
 * template from that envelope is refused.
 */
export function admissionPosturesForQualifiedEnvelope(
  envelope: PaperCanonicalOrdinaryCapitalEnvelopeV2,
): { currentRuntimePosture: RuntimePostureV2; currentDriftPosture: LiveEdgeDriftPostureV2 } {
  if (envelope.unavailableContextSources && envelope.unavailableContextSources.length > 0) {
    throw new Error("ADMISSION_TEMPLATE_FROM_UNAVAILABLE_CONTEXT");
  }
  if (!envelope.currentRuntimePosture || !envelope.currentDriftPosture) {
    throw new Error("ADMISSION_TEMPLATE_POSTURES_MISSING");
  }
  return {
    currentRuntimePosture: envelope.currentRuntimePosture,
    currentDriftPosture: envelope.currentDriftPosture,
  };
}
