import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import { assertGuardianAssessmentV2, type GuardianAssessmentV2 } from "./guardian-assessment-v2";

export type TenantGuardianAssessmentViewV2 = Readonly<{
  assessmentId: string;
  positionId: string;
  lotId: string;
  symbol: string;
  recommendation: GuardianAssessmentV2["recommendation"];
  targetReductionBps: number;
  openPositionSufficiency: GuardianAssessmentV2["openPositionSufficiency"];
  reasonCodes: readonly string[];
}>;

export type AdminGuardianAssessmentViewV2 = TenantGuardianAssessmentViewV2 & Readonly<{
  organizationId: string;
  contentDigest: string;
  openingCausalLineageDigest: string;
  realityFrontierId: string;
  realityContentDigest: string;
  qualifiedEvidenceBundleId: string;
  qualifiedEvidenceContentDigest: string;
}>;

export function buildTenantGuardianAssessmentViewV2(
  context: OrgContext,
  assessment: GuardianAssessmentV2,
): TenantGuardianAssessmentViewV2 {
  assertGuardianAssessmentV2(assessment);
  if (assessment.organizationId !== context.organizationId) {
    throw new Error("TENANT_GUARDIAN_ASSESSMENT_SCOPE_MISMATCH");
  }
  return Object.freeze({
    assessmentId: assessment.assessmentId,
    positionId: assessment.positionId,
    lotId: assessment.lotId,
    symbol: assessment.symbol,
    recommendation: assessment.recommendation,
    targetReductionBps: assessment.targetReductionBps,
    openPositionSufficiency: assessment.openPositionSufficiency,
    reasonCodes: Object.freeze([...assessment.reasonCodes]),
  });
}

export function buildAdminGuardianAssessmentViewV2(
  assessment: GuardianAssessmentV2,
): AdminGuardianAssessmentViewV2 {
  assertGuardianAssessmentV2(assessment);
  return Object.freeze({
    ...buildTenantGuardianAssessmentViewV2({ organizationId: assessment.organizationId }, assessment),
    organizationId: assessment.organizationId,
    contentDigest: assessment.contentDigest,
    openingCausalLineageDigest: assessment.openingCausalLineageDigest,
    realityFrontierId: assessment.realityFrontierId,
    realityContentDigest: assessment.realityContentDigest,
    qualifiedEvidenceBundleId: assessment.qualifiedEvidenceBundleId,
    qualifiedEvidenceContentDigest: assessment.qualifiedEvidenceContentDigest,
  });
}
