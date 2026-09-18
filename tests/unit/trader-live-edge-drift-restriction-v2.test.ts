import { describe, expect, it } from "vitest";

import {
  assessLiveEdgeDriftRestrictionV2,
  boundLiveEdgeDriftIdentityDigestV2,
  LIVE_EDGE_DRIFT_CHANNELS_V2,
  LIVE_EDGE_DRIFT_RESTRICTION_POLICY_V2,
  type LiveEdgeDriftBoundIdentityV2,
  type LiveEdgeDriftChannelObservationV2,
} from "@/lib/trader/restriction";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const ACK = "c".repeat(64);
const ASSESSED = "2026-02-01T12:00:00.000Z";
const PRIOR = "2026-02-01T11:00:00.000Z";
const FRESH = "2026-02-01T11:50:00.000Z";

const identity: LiveEdgeDriftBoundIdentityV2 = {
  qualificationTupleDigestHex: DIGEST_A,
  packageDigestHex: DIGEST_A,
  informationContractDigestHex: DIGEST_A,
  runtimeReleaseDigestHex: DIGEST_A,
  liveEnvelopeDigestHex: DIGEST_A,
};

const policy = {
  policyVersion: LIVE_EDGE_DRIFT_RESTRICTION_POLICY_V2,
  maxStalenessMs: 60 * 60 * 1000,
  coolingOffMs: 24 * 60 * 60 * 1000,
} as const;

function observation(
  channel: LiveEdgeDriftChannelObservationV2["channel"],
  overrides: Partial<LiveEdgeDriftChannelObservationV2> = {},
): LiveEdgeDriftChannelObservationV2 {
  return {
    channel,
    state: "OBSERVED",
    observedAt: FRESH,
    boundIdentityDigestHex: boundLiveEdgeDriftIdentityDigestV2(identity),
    restrictive: false,
    failClosedPosture: "NO_NEW_RISK",
    breachPosture: "CLOSE_ONLY",
    ...overrides,
  };
}

function healthyObservations(): LiveEdgeDriftChannelObservationV2[] {
  return LIVE_EDGE_DRIFT_CHANNELS_V2.map((channel) => observation(channel));
}

describe("DEE-774 live-edge drift restriction", () => {
  it("stays NORMAL on complete fresh non-restrictive evidence and is deterministic", () => {
    const first = assessLiveEdgeDriftRestrictionV2({
      organizationId: "org-1",
      assessedAt: ASSESSED,
      boundIdentity: identity,
      policy,
      previousPosture: "NORMAL",
      previousAssessedAt: PRIOR,
      observations: healthyObservations(),
      humanRecoveryAckDigestHex: null,
    });
    const second = assessLiveEdgeDriftRestrictionV2({
      organizationId: "org-1",
      assessedAt: ASSESSED,
      boundIdentity: identity,
      policy,
      previousPosture: "NORMAL",
      previousAssessedAt: PRIOR,
      observations: healthyObservations(),
      humanRecoveryAckDigestHex: null,
    });
    expect(first.effectivePosture).toBe("NORMAL");
    expect(first.capitalAuthority).toBe("NONE");
    expect(first.contentDigestHex).toBe(second.contentDigestHex);
  });

  it("is monotone: calibration breach and missing source-health only preserve or reduce authority", () => {
    const breached = healthyObservations().map((item) =>
      item.channel === "CALIBRATION"
        ? { ...item, restrictive: true, breachPosture: "CLOSE_ONLY" as const }
        : item,
    );
    const receipt = assessLiveEdgeDriftRestrictionV2({
      organizationId: "org-1",
      assessedAt: ASSESSED,
      boundIdentity: identity,
      policy,
      previousPosture: "NO_NEW_RISK",
      previousAssessedAt: PRIOR,
      observations: breached.filter((item) => item.channel !== "SOURCE_HEALTH"),
      humanRecoveryAckDigestHex: null,
    });
    expect(receipt.assessedPosture).toBe("CLOSE_ONLY");
    expect(receipt.effectivePosture).toBe("CLOSE_ONLY");
    expect(receipt.reasonCodes).toContain("DRIFT_CALIBRATION_BREACH");
    expect(receipt.reasonCodes).toContain("DRIFT_SOURCE_HEALTH_MISSING");
  });

  it("fails closed on stale, mismatched tuple and unknown evidence", () => {
    const stale = assessLiveEdgeDriftRestrictionV2({
      organizationId: "org-1",
      assessedAt: ASSESSED,
      boundIdentity: identity,
      policy,
      previousPosture: "NORMAL",
      previousAssessedAt: PRIOR,
      observations: healthyObservations().map((item) =>
        item.channel === "DRAWDOWN"
          ? { ...item, observedAt: "2026-01-01T00:00:00.000Z", state: "STALE" as const }
          : item,
      ),
      humanRecoveryAckDigestHex: null,
    });
    expect(stale.effectivePosture).toBe("NO_NEW_RISK");

    const mismatched = assessLiveEdgeDriftRestrictionV2({
      organizationId: "org-1",
      assessedAt: ASSESSED,
      boundIdentity: identity,
      policy,
      previousPosture: "NORMAL",
      previousAssessedAt: PRIOR,
      observations: healthyObservations().map((item) =>
        item.channel === "PAPER_LIVE_DIVERGENCE"
          ? { ...item, boundIdentityDigestHex: DIGEST_B }
          : item,
      ),
      humanRecoveryAckDigestHex: null,
    });
    expect(mismatched.effectivePosture).toBe("SUPERVISED_STOP");
  });

  it("refuses silent recovery to a wider posture without cooling-off and Human acknowledgement", () => {
    const refused = assessLiveEdgeDriftRestrictionV2({
      organizationId: "org-1",
      assessedAt: ASSESSED,
      boundIdentity: identity,
      policy,
      previousPosture: "CLOSE_ONLY",
      previousAssessedAt: PRIOR,
      observations: healthyObservations(),
      humanRecoveryAckDigestHex: null,
    });
    expect(refused.assessedPosture).toBe("NORMAL");
    expect(refused.effectivePosture).toBe("CLOSE_ONLY");
    expect(refused.widenedWithoutAuthority).toBe(true);

    const authorized = assessLiveEdgeDriftRestrictionV2({
      organizationId: "org-1",
      assessedAt: "2026-02-03T12:00:00.000Z",
      boundIdentity: identity,
      policy,
      previousPosture: "CLOSE_ONLY",
      previousAssessedAt: PRIOR,
      observations: healthyObservations().map((item) => ({
        ...item,
        observedAt: "2026-02-03T11:50:00.000Z",
      })),
      humanRecoveryAckDigestHex: ACK,
    });
    expect(authorized.effectivePosture).toBe("NORMAL");
    expect(authorized.widenedWithoutAuthority).toBe(false);
  });
});
