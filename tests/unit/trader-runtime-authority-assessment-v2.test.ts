import { describe, expect, it } from "vitest";

import {
  assertRuntimeAuthorityAssessmentV2,
  buildRuntimeAuthorityAssessmentV2,
  serializeRuntimeAuthorityAssessmentV2,
} from "@/lib/trader/runtime-authority/v2";

const digest = (character: string) => character.repeat(64);

function draft() {
  return {
    organizationId: "org-a",
    runtimeInstanceId: "runtime-a",
    releaseId: "release-a",
    releaseContentDigest: digest("a"),
    realityFrontierId: "frontier-a",
    realityContentDigest: digest("b"),
    controlLeaseEpoch: 7,
    controlLeaseContentDigest: digest("c"),
    adjudicatedAtUtc: "2026-08-30T03:00:00.000Z",
    evidence: {
      realityRebuildComplete: true,
      executionUncertaintyResolved: true,
      guardianCoverageComplete: true,
      allowancesValid: true,
      releaseIdentityValid: true,
      promotionIdentityValid: true,
      credentialsReady: true,
      persistenceReady: true,
      exclusiveControlLeaseValid: true,
    },
  } as const;
}

describe("RuntimeAuthorityAssessmentV2", () => {
  it("is deterministic, content-addressed and grants new-risk posture only on complete evidence", () => {
    const first = buildRuntimeAuthorityAssessmentV2(draft());
    const second = buildRuntimeAuthorityAssessmentV2(draft());
    expect(first).toEqual(second);
    expect(first.posture).toBe("FULL_ANALYSIS_AND_NEW_RISK");
    expect(first.reasonCodes).toEqual(["RUNTIME_AUTHORITY_READY"]);
    expect(serializeRuntimeAuthorityAssessmentV2(first)).toBe(serializeRuntimeAuthorityAssessmentV2(second));
  });

  it.each([
    ["guardianCoverageComplete", "NO_NEW_RISK"],
    ["executionUncertaintyResolved", "CLOSE_ONLY"],
    ["realityRebuildComplete", "HALT"],
    ["persistenceReady", "HALT"],
    ["exclusiveControlLeaseValid", "HALT"],
  ] as const)("fails downward when %s is false", (field, posture) => {
    const input = draft();
    const assessment = buildRuntimeAuthorityAssessmentV2({
      ...input,
      evidence: { ...input.evidence, [field]: false },
    });
    expect(assessment.posture).toBe(posture);
    expect(assessment.contentDigest).not.toBe(buildRuntimeAuthorityAssessmentV2(input).contentDigest);
  });

  it("uses the most restrictive failure and rejects mutated derived authority", () => {
    const input = draft();
    const assessment = buildRuntimeAuthorityAssessmentV2({
      ...input,
      evidence: {
        ...input.evidence,
        guardianCoverageComplete: false,
        executionUncertaintyResolved: false,
        persistenceReady: false,
      },
    });
    expect(assessment.posture).toBe("HALT");
    expect(() =>
      assertRuntimeAuthorityAssessmentV2({ ...assessment, posture: "FULL_ANALYSIS_AND_NEW_RISK" }),
    ).toThrow("RUNTIME_AUTHORITY_DERIVATION_MISMATCH");
  });

  it("rejects invalid trusted time, lease epoch and digests", () => {
    expect(() => buildRuntimeAuthorityAssessmentV2({ ...draft(), adjudicatedAtUtc: "now" })).toThrow();
    expect(() => buildRuntimeAuthorityAssessmentV2({ ...draft(), controlLeaseEpoch: 0 })).toThrow();
    expect(() => buildRuntimeAuthorityAssessmentV2({ ...draft(), realityContentDigest: "bad" })).toThrow();
  });
});
