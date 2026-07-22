import { describe, expect, it } from "vitest";

import {
  createFhvCampaignIdentityContext,
  FhvCampaignIdentityError,
  FHV_CAMPAIGN_NEW_ID_NAMESPACE,
  FHV_CAMPAIGN_RANDOM_UUID_NAMESPACE,
  validateFhvCampaignIdentityFrontier,
} from "@/lib/trader/observability/fhv-campaign-identity";

const RUN_ID = "fhv-campaign-identity-unit";

describe("FHV campaign identity frontier (DEE-431)", () => {
  it("continues ID sequences from restored checkpoint frontier in a fresh context", () => {
    const firstContext = createFhvCampaignIdentityContext({ runId: RUN_ID });
    const firstNewId = firstContext.createNewIdFactory();
    const firstRandomUuid = firstContext.createRandomUuidFactory();
    firstNewId();
    firstRandomUuid();
    firstNewId();
    const frontier = firstContext.captureFrontier(3);
    const continuedNewId = firstContext.createNewIdFactory();
    const continuedRandomUuid = firstContext.createRandomUuidFactory();
    const expectedNext = [continuedNewId(), continuedRandomUuid()];

    const secondContext = createFhvCampaignIdentityContext({
      runId: RUN_ID,
      restoredFrontier: frontier,
    });
    const secondNewId = secondContext.createNewIdFactory();
    const secondRandomUuid = secondContext.createRandomUuidFactory();
    const actualNext = [secondNewId(), secondRandomUuid()];

    expect(actualNext).toEqual(expectedNext);
    expect(firstContext.newIdSeq).toBe(secondContext.newIdSeq);
    expect(firstContext.randomUuidSeq).toBe(secondContext.randomUuidSeq);
  });

  it("uses stable namespace seeds independent of process-local memory", () => {
    const context = createFhvCampaignIdentityContext({ runId: RUN_ID });
    const newId = context.createNewIdFactory();
    const randomUuid = context.createRandomUuidFactory();
    expect(newId()).toBe(
      `00000000-0000-4000-8000-${String(FHV_CAMPAIGN_NEW_ID_NAMESPACE + 1).padStart(12, "0")}`,
    );
    expect(randomUuid()).toBe(
      `00000000-0000-4000-8000-${String(FHV_CAMPAIGN_RANDOM_UUID_NAMESPACE + 1).padStart(12, "0")}`,
    );
  });

  it("rejects identity frontier rollback", () => {
    expect(() =>
      validateFhvCampaignIdentityFrontier({
        frontier: {
          schemaVersion: "fhv-campaign-identity-frontier/v1",
          runId: RUN_ID,
          safeResumeThroughCycleIndex: 44,
          newIdSeq: 0,
          randomUuidSeq: 0,
        },
        runId: RUN_ID,
        safeResumeThroughCycleIndex: 44,
      }),
    ).toThrow(FhvCampaignIdentityError);
  });
});
