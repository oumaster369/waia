import type { GuardianAssessmentV2 } from "./guardian-assessment-v2";

export type GuardianOrdinaryRouteV2 =
  | Readonly<{ route: "NO_ACTION"; assessmentId: string }>
  | Readonly<{
      route: "DECISION_V2_REQUIRED";
      assessmentId: string;
      assessmentContentDigest: string;
      recommendation: "REDUCE_PARTIAL" | "REDUCE_FULL";
      maximumReductionBps: number;
    }>;

/** Guardian V2 never returns an executable order, Risk allowance, or connector command. */
export function routeGuardianOrdinaryAssessmentV2(
  assessment: GuardianAssessmentV2,
): GuardianOrdinaryRouteV2 {
  if (assessment.recommendation === "HOLD") {
    return Object.freeze({ route: "NO_ACTION", assessmentId: assessment.assessmentId });
  }
  return Object.freeze({
    route: "DECISION_V2_REQUIRED",
    assessmentId: assessment.assessmentId,
    assessmentContentDigest: assessment.contentDigest,
    recommendation: assessment.recommendation,
    maximumReductionBps: assessment.targetReductionBps,
  });
}

