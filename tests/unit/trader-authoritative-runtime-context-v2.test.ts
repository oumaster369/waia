import { describe, expect, it } from "vitest";

import { buildAuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";

const DIGEST = "a".repeat(64);

function input() {
  return {
    organizationId: "org-1",
    accountId: "account-1",
    symbol: "BTCUSDT",
    pitAnchor: "2026-02-01T12:00:00.000Z",
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK" as const,
    runtimeAssessmentDigestHex: DIGEST,
    driftPosture: "NORMAL" as const,
    driftRestrictionDigestHex: DIGEST,
    qualificationTupleDigestHex: DIGEST,
    packageDigestHex: DIGEST,
    informationContractDigestHex: DIGEST,
    informationNeedPlanDigestHex: DIGEST,
    releaseDigestHex: DIGEST,
  };
}

describe("DEE-639 AuthoritativeRuntimeContextV2", () => {
  it("is an envelope-only content-addressed bound and is deterministic", () => {
    const first = buildAuthoritativeRuntimeContextV2(input());
    const second = buildAuthoritativeRuntimeContextV2(input());
    expect(first.authority).toBe("ENVELOPE_ONLY");
    expect(first.capitalAuthority).toBe("NONE");
    expect(first.contentDigestHex).toBe(second.contentDigestHex);
    expect(first.contentDigestHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses invalid PIT and missing digests", () => {
    expect(() => buildAuthoritativeRuntimeContextV2({ ...input(), pitAnchor: "not-iso" })).toThrow(
      "RUNTIME_CONTEXT_PIT_INVALID",
    );
    expect(() =>
      buildAuthoritativeRuntimeContextV2({
        ...input(),
        packageDigestHex: "zzz",
      }),
    ).toThrow("RUNTIME_CONTEXT_PACKAGE_INVALID");
  });
});
