import { describe, expect, it } from "vitest";

import { assertProtectiveTriggerProofV2, buildProtectiveTriggerProofV2 } from "@/lib/trader/guardian/v2";

const hex = (value: string) => value.repeat(64);
const draft = {
  mandateId: "protective-mandate-v2:a", mandateContentDigest: hex("1"),
  deterministicTriggerSpecDigest: hex("2"), realityProjectionId: "reality-a",
  realityContentDigest: hex("3"), evaluatorVersion: "guardian-trigger-v2.1",
  evaluatorDigest: hex("4"), observedAtUtc: "2026-08-30T00:00:00.000Z",
} as const;

describe("ProtectiveTriggerProofV2", () => {
  it("is deterministic and content-addressed", () => {
    const left = buildProtectiveTriggerProofV2(draft);
    const right = buildProtectiveTriggerProofV2({ ...draft });
    expect(left).toEqual(right);
    expect(() => assertProtectiveTriggerProofV2(left)).not.toThrow();
  });

  it("rejects forged evaluator or reality evidence", () => {
    const value = buildProtectiveTriggerProofV2(draft);
    expect(() => assertProtectiveTriggerProofV2({ ...value, evaluatorVersion: "forged" })).toThrow(
      "PROTECTIVE_TRIGGER_PROOF_DIGEST_MISMATCH",
    );
    expect(() => buildProtectiveTriggerProofV2({ ...draft, realityContentDigest: "bad" })).toThrow(
      "PROTECTIVE_TRIGGER_PROOF_INVALID_DIGEST",
    );
  });
});
