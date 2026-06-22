import { describe, expect, it } from "vitest";

import { buildTrialIntegrityContentDigest } from "@/lib/trader/mi/serialize-trial-integrity";

const GOLDEN_ORG_ID = "00000000-0000-4000-8000-00000000e291";

describe("trader mi trial integrity serialize (DEE-291 / LD-5a.2c)", () => {
  const eventTime = new Date("2026-06-22T12:00:00.000Z");
  const ingestTime = new Date("2026-06-22T12:00:01.000Z");
  const baseInput = {
    organizationId: GOLDEN_ORG_ID,
    trialId: "00000000-0000-4000-8000-00000000f291",
    eventType: "invalidated" as const,
    reasonCode: "look_ahead_contamination" as const,
    rationale: "golden invalidation rationale",
    causeRef: null,
    eventTime,
    ingestTime,
    recordedBy: "golden-recorder",
  };

  it("content_digest is deterministic and excludes seq and derived state", () => {
    const digestA = buildTrialIntegrityContentDigest(baseInput);
    const digestB = buildTrialIntegrityContentDigest({ ...baseInput });

    expect(digestA).toBe(digestB);
    expect(digestA).toBe("83e7b10542afaada8d3b043afcd75d3dd18e6ea278ce1e1a5181174df4662983");
  });

  it("reason_code participates in the digest", () => {
    const otherReason = buildTrialIntegrityContentDigest({
      ...baseInput,
      reasonCode: "provenance_gap",
    });
    expect(otherReason).not.toBe(buildTrialIntegrityContentDigest(baseInput));
  });

  it("cause_ref participates in the digest", () => {
    const withCause = buildTrialIntegrityContentDigest({
      ...baseInput,
      causeRef: "upstream-flag-001",
    });
    expect(withCause).not.toBe(buildTrialIntegrityContentDigest(baseInput));
  });
});
