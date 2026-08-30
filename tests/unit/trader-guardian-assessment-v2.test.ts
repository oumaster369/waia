import { describe, expect, it } from "vitest";

import {
  assertGuardianAssessmentV2,
  buildGuardianAssessmentV2,
  parseGuardianAssessmentV2,
  serializeGuardianAssessmentV2,
  type GuardianAssessmentV2Draft,
} from "@/lib/trader/guardian/v2";

const hex = (character: string) => character.repeat(64);

const draft = (overrides: Partial<GuardianAssessmentV2Draft> = {}): GuardianAssessmentV2Draft => ({
  organizationId: "org-a",
  positionId: "position-a",
  lotId: "lot-a",
  symbol: "BTCUSDT",
  openingCausalLineageDigest: hex("1"),
  realityFrontierId: "reality-frontier-a",
  realityContentDigest: hex("2"),
  qualifiedEvidenceBundleId: "evidence-a",
  qualifiedEvidenceContentDigest: hex("3"),
  informationSufficiencyProfile: "OPEN_POSITION_REASSESSMENT",
  openPositionSufficiency: "SUFFICIENT",
  newOpportunitySufficiency: "INSUFFICIENT",
  recommendation: "REDUCE_PARTIAL",
  targetReductionBps: 2_500,
  reasonCodes: ["THESIS_WEAKENED", "REALITY_FRONTIER_ADVANCED"],
  ...overrides,
});

describe("GuardianAssessmentV2", () => {
  it("is deterministic, content-addressed and canonical", () => {
    const left = buildGuardianAssessmentV2(draft());
    const right = buildGuardianAssessmentV2(draft({
      reasonCodes: ["REALITY_FRONTIER_ADVANCED", "THESIS_WEAKENED"],
    }));

    expect(left).toEqual(right);
    expect(left.assessmentId).toBe(`guardian-assessment-v2:${left.contentDigest}`);
    expect(parseGuardianAssessmentV2(serializeGuardianAssessmentV2(left))).toEqual(left);
  });

  it("changes identity when any causal input changes", () => {
    const baseline = buildGuardianAssessmentV2(draft());
    const changed = buildGuardianAssessmentV2(draft({ realityContentDigest: hex("4") }));
    expect(changed.contentDigest).not.toBe(baseline.contentDigest);
    expect(changed.assessmentId).not.toBe(baseline.assessmentId);
  });

  it("does not conflate new-opportunity and open-position sufficiency", () => {
    const assessment = buildGuardianAssessmentV2(draft({
      newOpportunitySufficiency: "INSUFFICIENT",
      openPositionSufficiency: "SUFFICIENT",
    }));
    expect(assessment.recommendation).toBe("REDUCE_PARTIAL");
  });

  it("fails closed when open-position evidence is insufficient", () => {
    expect(() => buildGuardianAssessmentV2(draft({
      openPositionSufficiency: "INSUFFICIENT",
      recommendation: "REDUCE_FULL",
      targetReductionBps: 10_000,
    }))).toThrow("GUARDIAN_ASSESSMENT_INSUFFICIENT_REASSESSMENT_MUST_HOLD");
  });

  it.each([
    ["HOLD", 1, "GUARDIAN_ASSESSMENT_HOLD_MUST_NOT_REDUCE"],
    ["REDUCE_PARTIAL", 0, "GUARDIAN_ASSESSMENT_PARTIAL_REDUCTION_OUT_OF_RANGE"],
    ["REDUCE_PARTIAL", 10_000, "GUARDIAN_ASSESSMENT_PARTIAL_REDUCTION_OUT_OF_RANGE"],
    ["REDUCE_FULL", 9_999, "GUARDIAN_ASSESSMENT_FULL_REDUCTION_MUST_CLOSE"],
  ] as const)("rejects invalid %s reduction %s", (recommendation, targetReductionBps, error) => {
    expect(() => buildGuardianAssessmentV2(draft({ recommendation, targetReductionBps }))).toThrow(error);
  });

  it("rejects mutation, extra fields and non-canonical JSON", () => {
    const assessment = buildGuardianAssessmentV2(draft());
    expect(() => assertGuardianAssessmentV2({
      ...assessment,
      organizationId: "org-b",
    })).toThrow("GUARDIAN_ASSESSMENT_DIGEST_MISMATCH");
    expect(() => assertGuardianAssessmentV2({
      ...assessment,
      unexpected: true,
    } as never)).toThrow("GUARDIAN_ASSESSMENT_UNEXPECTED_FIELD");
    expect(() => parseGuardianAssessmentV2(JSON.stringify(assessment, null, 2))).toThrow(
      "GUARDIAN_ASSESSMENT_NON_CANONICAL_JSON",
    );
  });
});
