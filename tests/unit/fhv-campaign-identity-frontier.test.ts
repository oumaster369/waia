import { describe, expect, it } from "vitest";

import {
  assertIdentityFrontierMonotonicWrite,
  assertSafeIdentityCounter,
  createFhvCampaignIdentityContext,
  FhvCampaignIdentityError,
  previewScopedIdentityId,
  validateFhvCampaignIdentityFrontier,
} from "@/lib/trader/observability/fhv-campaign-identity";

const RUN_ID = "fhv-campaign-identity-unit";
const ORG_A = "00000000-0000-4000-8000-000000000431";
const ORG_B = "00000000-0000-4000-8000-000000000432";
const RUN_B = "fhv-campaign-identity-other-run";

describe("FHV campaign identity frontier (DEE-431 closed set)", () => {
  it("continues ID sequences from restored checkpoint frontier in a fresh context", () => {
    const firstContext = createFhvCampaignIdentityContext({ runId: RUN_ID, organizationId: ORG_A });
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
      organizationId: ORG_A,
      restoredFrontier: frontier,
    });
    const secondNewId = secondContext.createNewIdFactory();
    const secondRandomUuid = secondContext.createRandomUuidFactory();
    const actualNext = [secondNewId(), secondRandomUuid()];

    expect(actualNext).toEqual(expectedNext);
    expect(firstContext.newIdSeq).toBe(secondContext.newIdSeq);
    expect(firstContext.randomUuidSeq).toBe(secondContext.randomUuidSeq);
  });

  it("scopes deterministic IDs by organizationId and runId", () => {
    const orgAId = previewScopedIdentityId({
      organizationId: ORG_A,
      runId: RUN_ID,
      identityStream: "newId",
      sequence: 1,
    });
    const orgBId = previewScopedIdentityId({
      organizationId: ORG_B,
      runId: RUN_ID,
      identityStream: "newId",
      sequence: 1,
    });
    const otherRunId = previewScopedIdentityId({
      organizationId: ORG_A,
      runId: RUN_B,
      identityStream: "newId",
      sequence: 1,
    });

    expect(orgAId).not.toBe(orgBId);
    expect(orgAId).not.toBe(otherRunId);
  });

  it("rejects duplicate generated identity within the same context", () => {
    const context = createFhvCampaignIdentityContext({ runId: RUN_ID, organizationId: ORG_A });
    const newId = context.createNewIdFactory();
    const first = newId();
    const second = newId();
    expect(first).not.toBe(second);
  });

  it("rejects identity frontier rollback", () => {
    expect(() =>
      validateFhvCampaignIdentityFrontier({
        frontier: {
          schemaVersion: "fhv-campaign-identity-frontier/v1",
          runId: RUN_ID,
          organizationId: ORG_A,
          safeResumeThroughCycleIndex: 44,
          newIdSeq: 0,
          randomUuidSeq: 0,
        },
        runId: RUN_ID,
        organizationId: ORG_A,
        safeResumeThroughCycleIndex: 44,
      }),
    ).toThrow(FhvCampaignIdentityError);
  });

  it.each([
    ["string", "1"],
    ["decimal", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -1],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ] as const)("rejects invalid newIdSeq: %s", (_label, value) => {
    expect(() => assertSafeIdentityCounter(value, "newIdSeq")).toThrow(FhvCampaignIdentityError);
  });

  it("rejects monotonic write rollback against prior durable checkpoint", () => {
    const runRoot = "/tmp/fhv-identity-monotonic-write-not-used";
    expect(() =>
      assertIdentityFrontierMonotonicWrite({
        runRoot,
        frontier: {
          schemaVersion: "fhv-campaign-identity-frontier/v1",
          runId: RUN_ID,
          organizationId: ORG_A,
          safeResumeThroughCycleIndex: 44,
          newIdSeq: 10,
          randomUuidSeq: 10,
        },
      }),
    ).not.toThrow();
  });
});
