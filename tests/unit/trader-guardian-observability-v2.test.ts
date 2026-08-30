import { describe, expect, it } from "vitest";

import {
  buildAdminGuardianAssessmentViewV2,
  buildGuardianAssessmentV2,
  buildTenantGuardianAssessmentViewV2,
} from "@/lib/trader/guardian/v2";

const hex = (value: string) => value.repeat(64);
const assessment = buildGuardianAssessmentV2({
  organizationId: "org-a", positionId: "trade-a", lotId: "lot-a", symbol: "BTCUSDT",
  openingCausalLineageDigest: hex("1"), realityFrontierId: "reality-a",
  realityContentDigest: hex("2"), qualifiedEvidenceBundleId: "evidence-a",
  qualifiedEvidenceContentDigest: hex("3"), informationSufficiencyProfile: "OPEN_POSITION_REASSESSMENT",
  openPositionSufficiency: "SUFFICIENT", newOpportunitySufficiency: "INSUFFICIENT",
  recommendation: "REDUCE_PARTIAL", targetReductionBps: 2_500, reasonCodes: ["THESIS_WEAKENED"],
});

describe("Guardian V2 observability", () => {
  it("gives a tenant a scoped operational projection without operator digests", () => {
    const view = buildTenantGuardianAssessmentViewV2({ organizationId: "org-a" }, assessment);
    expect(view).toMatchObject({ assessmentId: assessment.assessmentId, lotId: "lot-a", recommendation: "REDUCE_PARTIAL" });
    expect(view).not.toHaveProperty("organizationId");
    expect(view).not.toHaveProperty("contentDigest");
    expect(() => buildTenantGuardianAssessmentViewV2({ organizationId: "org-b" }, assessment)).toThrow(
      "TENANT_GUARDIAN_ASSESSMENT_SCOPE_MISMATCH",
    );
  });

  it("gives operators explicit tenant and causal evidence identities", () => {
    expect(buildAdminGuardianAssessmentViewV2(assessment)).toMatchObject({
      organizationId: "org-a",
      contentDigest: assessment.contentDigest,
      openingCausalLineageDigest: hex("1"),
      qualifiedEvidenceContentDigest: hex("3"),
    });
  });
});
