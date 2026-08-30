import { describe, expect, it } from "vitest";

import { adjudicateRuntimeAuthorityStartupV2, createInMemoryRuntimeAuthorityAssessmentRepositoryV2,
  readAdminRuntimeAuthoritiesV2, readTenantRuntimeAuthorityV2,
  type RuntimeAuthorityAssessmentV2, type RuntimeAuthorityStartupWriterV2 } from "@/lib/trader/runtime-authority/v2";

const digest = (value: string) => value.repeat(64);
const exactInput = (overrides: Record<string, unknown> = {}) => ({ runtimeInstanceId: "runtime-a",
  releaseId: "release", releaseContentDigest: digest("a"), realityFrontierId: "frontier",
  realityContentDigest: digest("b"), controlLeaseEpoch: 1, controlLeaseContentDigest: digest("c"),
  adjudicatedAtUtc: "2026-08-30T03:00:00.000Z", evidence: { realityRebuildComplete: true,
    executionUncertaintyResolved: true, guardianCoverageComplete: true, allowancesValid: true,
    releaseIdentityValid: true, promotionIdentityValid: true, credentialsReady: true,
    persistenceReady: true, exclusiveControlLeaseValid: true }, ...overrides });

describe("Runtime Authority startup orchestration and projections", () => {
  it("derives exact posture before invoking the sole fenced writer", async () => {
    let received: RuntimeAuthorityAssessmentV2 | undefined;
    const writer: RuntimeAuthorityStartupWriterV2 = { async commitAssessment(_context, assessment) {
      received = assessment; return assessment;
    } };
    const result = await adjudicateRuntimeAuthorityStartupV2(writer, { organizationId: "org-a" }, exactInput());
    expect(result.posture).toBe("FULL_ANALYSIS_AND_NEW_RISK");
    expect(received).toBe(result);
  });

  it("keeps restart uncertainty fail-closed until exact recovery evidence is complete", async () => {
    const writer: RuntimeAuthorityStartupWriterV2 = { async commitAssessment(_context, assessment) { return assessment; } };
    const uncertain = await adjudicateRuntimeAuthorityStartupV2(writer, { organizationId: "org-a" },
      exactInput({ evidence: { ...exactInput().evidence, realityRebuildComplete: false,
        executionUncertaintyResolved: false } }));
    expect(uncertain.posture).toBe("HALT");
    expect(uncertain.reasonCodes).toContain("RUNTIME_REALITY_REBUILD_INCOMPLETE");
    const recovered = await adjudicateRuntimeAuthorityStartupV2(writer, { organizationId: "org-a" }, exactInput({
      adjudicatedAtUtc: "2026-08-30T03:01:00.000Z",
    }));
    expect(recovered.posture).toBe("FULL_ANALYSIS_AND_NEW_RISK");
  });

  it("keeps tenant and authorized operator projections separate with explicit unavailable states", async () => {
    const repository = createInMemoryRuntimeAuthorityAssessmentRepositoryV2();
    expect(await readTenantRuntimeAuthorityV2(repository, { organizationId: "org-a" }, "runtime-a"))
      .toMatchObject({ availability: "UNAVAILABLE", posture: null });
    const writer: RuntimeAuthorityStartupWriterV2 = { async commitAssessment(context, assessment) {
      return repository.append(context, assessment);
    } };
    await adjudicateRuntimeAuthorityStartupV2(writer, { organizationId: "org-a" }, exactInput());
    expect(await readTenantRuntimeAuthorityV2(repository, { organizationId: "org-b" }, "runtime-a"))
      .toMatchObject({ availability: "UNAVAILABLE", organizationId: "org-b" });
    const admin = await readAdminRuntimeAuthoritiesV2(repository, ["org-b", "org-a"],
      { "org-a": "runtime-a" });
    expect(admin.map((row) => [row.organizationId, row.availability])).toEqual([
      ["org-a", "AVAILABLE"], ["org-b", "UNAVAILABLE"],
    ]);
  });
});
