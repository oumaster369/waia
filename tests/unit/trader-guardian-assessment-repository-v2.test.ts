import { describe, expect, it } from "vitest";

import {
  buildGuardianAssessmentV2,
  InMemoryGuardianAssessmentRepositoryV2,
} from "@/lib/trader/guardian/v2";

const hex = (character: string) => character.repeat(64);
const assessment = (organizationId: string, lotId = "lot-a") => buildGuardianAssessmentV2({
  organizationId,
  positionId: "trade-a",
  lotId,
  symbol: "BTCUSDT",
  openingCausalLineageDigest: hex("1"),
  realityFrontierId: "reality-a",
  realityContentDigest: hex("2"),
  qualifiedEvidenceBundleId: "evidence-a",
  qualifiedEvidenceContentDigest: hex("3"),
  informationSufficiencyProfile: "OPEN_POSITION_REASSESSMENT",
  openPositionSufficiency: "SUFFICIENT",
  newOpportunitySufficiency: "INSUFFICIENT",
  recommendation: "HOLD",
  targetReductionBps: 0,
  reasonCodes: ["THESIS_INTACT"],
});

describe("GuardianAssessmentRepositoryV2", () => {
  it("is idempotent for byte-identical content-addressed assessments", async () => {
    const repository = new InMemoryGuardianAssessmentRepositoryV2();
    const value = assessment("org-a");
    const first = await repository.append({ organizationId: "org-a" }, value);
    const second = await repository.append({ organizationId: "org-a" }, value);
    expect(second).toBe(first);
    expect(await repository.listByLot({ organizationId: "org-a" }, "lot-a")).toEqual([value]);
  });

  it("fails closed on cross-tenant writes and hides cross-tenant reads", async () => {
    const repository = new InMemoryGuardianAssessmentRepositoryV2();
    const value = assessment("org-a");
    await expect(repository.append({ organizationId: "org-b" }, value)).rejects.toThrow(
      "GUARDIAN_ASSESSMENT_TENANT_MISMATCH",
    );
    await repository.append({ organizationId: "org-a" }, value);
    await expect(repository.getById({ organizationId: "org-b" }, value.assessmentId)).resolves.toBeNull();
    await expect(repository.listByLot({ organizationId: "org-b" }, "lot-a")).resolves.toEqual([]);
  });
});
