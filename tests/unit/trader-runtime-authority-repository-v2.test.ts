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
        adjudicatedAtUtc: "2026-08-30T03:00:00.000Z",
        expectedPreviousDigest: null,
      })),
    );
    expect(claims.filter((claim) => claim === "CLAIMED")).toHaveLength(1);
    expect(claims.filter((claim) => claim === "CONFLICT")).toHaveLength(7);
    expect(await repository.current("org-b")).toBeNull();
  });

  it("requires trusted expiry, next epoch and prior-digest CAS, then fences the stale holder", async () => {
    const repository = createInMemoryRuntimeControlLeaseRepositoryV2();
    const first = {
      organizationId: "org-a",
      runtimeInstanceId: "runtime-a",
      leaseEpoch: 1,
      leaseContentDigest: digest("a"),
      validUntilUtc: "2026-08-30T04:00:00.000Z",
      adjudicatedAtUtc: "2026-08-30T03:00:00.000Z",
      expectedPreviousDigest: null,
    } as const;
    expect(await repository.claimExclusive(first)).toBe("CLAIMED");
    expect(await repository.claimExclusive({
      ...first,
      runtimeInstanceId: "runtime-b",
      leaseEpoch: 2,
      leaseContentDigest: digest("b"),
      adjudicatedAtUtc: "2026-08-30T03:59:59.999Z",
      validUntilUtc: "2026-08-30T05:00:00.000Z",
      expectedPreviousDigest: first.leaseContentDigest,
    })).toBe("CONFLICT");
    expect(await repository.claimExclusive({
      ...first,
      runtimeInstanceId: "runtime-b",
      leaseEpoch: 3,
      leaseContentDigest: digest("b"),
      adjudicatedAtUtc: "2026-08-30T04:00:00.001Z",
      validUntilUtc: "2026-08-30T05:00:00.000Z",
      expectedPreviousDigest: first.leaseContentDigest,
    })).toBe("CONFLICT");
    const second = {
      ...first,
      runtimeInstanceId: "runtime-b",
      leaseEpoch: 2,
      leaseContentDigest: digest("b"),
      adjudicatedAtUtc: "2026-08-30T04:00:00.001Z",
      validUntilUtc: "2026-08-30T05:00:00.000Z",
      expectedPreviousDigest: first.leaseContentDigest,
    } as const;
    expect(await repository.claimExclusive(second)).toBe("CLAIMED");
    await expect(repository.assertCurrentHolder({ ...first, adjudicatedAtUtc: second.adjudicatedAtUtc })).rejects.toThrow("STALE_HOLDER");
    await expect(repository.assertCurrentHolder({ ...second, adjudicatedAtUtc: "2026-08-30T05:00:00.001Z" })).rejects.toThrow("STALE_HOLDER");
  });
});
