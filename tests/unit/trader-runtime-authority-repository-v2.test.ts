import { describe, expect, it } from "vitest";

import {
  buildRuntimeAuthorityAssessmentV2,
  createInMemoryRuntimeAuthorityAssessmentRepositoryV2,
  createInMemoryRuntimeControlLeaseRepositoryV2,
} from "@/lib/trader/runtime-authority/v2";

const digest = (value: string) => value.repeat(64);
const context = (organizationId: string) => ({ organizationId });

function assessment(organizationId = "org-a") {
  return buildRuntimeAuthorityAssessmentV2({
    organizationId,
    runtimeInstanceId: "runtime-a",
    releaseId: "release-a",
    releaseContentDigest: digest("a"),
    realityFrontierId: "frontier-a",
    realityContentDigest: digest("b"),
    controlLeaseEpoch: 1,
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
  });
}

describe("Runtime Authority V2 repositories", () => {
  it("appends idempotently and preserves tenant isolation across restart-visible reads", async () => {
    const repository = createInMemoryRuntimeAuthorityAssessmentRepositoryV2();
    const value = assessment();
    expect(await repository.append(context("org-a"), value)).toEqual(value);
    expect(await repository.append(context("org-a"), value)).toEqual(value);
    expect(await repository.getById(context("org-b"), value.assessmentId)).toBeNull();
    expect(await repository.listByRuntime(context("org-a"), "runtime-a")).toEqual([value]);
    await expect(repository.append(context("org-b"), value)).rejects.toThrow("RUNTIME_AUTHORITY_TENANT_MISMATCH");
  });

  it("allows exactly one concurrent runtime to claim a tenant control epoch", async () => {
    const repository = createInMemoryRuntimeControlLeaseRepositoryV2();
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, index) => repository.claimExclusive({
        organizationId: "org-a",
        runtimeInstanceId: `runtime-${index}`,
        leaseEpoch: 1,
        leaseContentDigest: digest(index.toString(16)),
        validUntilUtc: "2026-08-30T04:00:00.000Z",
      })),
    );
    expect(claims.filter((claim) => claim === "CLAIMED")).toHaveLength(1);
    expect(claims.filter((claim) => claim === "CONFLICT")).toHaveLength(7);
    expect(await repository.current("org-b")).toBeNull();
  });
});
