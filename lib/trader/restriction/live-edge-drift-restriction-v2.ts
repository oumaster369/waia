import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const LIVE_EDGE_DRIFT_RESTRICTION_SCHEMA_V2 =
  "waia.trader.live_edge_drift_restriction.v2" as const;

export const LIVE_EDGE_DRIFT_RESTRICTION_POLICY_V2 =
  "live-edge-drift-restriction-policy/v2" as const;

export const LIVE_EDGE_DRIFT_POSTURES_V2 = [
  "NORMAL",
  "NO_NEW_RISK",
  "CLOSE_ONLY",
  "SUPERVISED_STOP",
] as const;

export type LiveEdgeDriftPostureV2 = (typeof LIVE_EDGE_DRIFT_POSTURES_V2)[number];

export const LIVE_EDGE_DRIFT_CHANNELS_V2 = [
  "CALIBRATION",
  "CONSERVATIVE_EV",
  "REALIZED_COST_SLIPPAGE",
  "FILL_QUALITY",
  "DRAWDOWN",
  "REGIME_OOD",
  "SOURCE_HEALTH",
  "PAPER_LIVE_DIVERGENCE",
] as const;

export type LiveEdgeDriftChannelV2 = (typeof LIVE_EDGE_DRIFT_CHANNELS_V2)[number];

export const LIVE_EDGE_DRIFT_EVIDENCE_STATES_V2 = [
  "OBSERVED",
  "MISSING",
  "STALE",
  "MISMATCH",
  "UNKNOWN",
] as const;

export type LiveEdgeDriftEvidenceStateV2 = (typeof LIVE_EDGE_DRIFT_EVIDENCE_STATES_V2)[number];

export const LIVE_EDGE_DRIFT_POSTURE_RANK_V2: Readonly<Record<LiveEdgeDriftPostureV2, number>> = {
  NORMAL: 0,
  NO_NEW_RISK: 1,
  CLOSE_ONLY: 2,
  SUPERVISED_STOP: 3,
};

const HEX64 = /^[0-9a-f]{64}$/;

export type LiveEdgeDriftBoundIdentityV2 = Readonly<{
  qualificationTupleDigestHex: string;
  packageDigestHex: string;
  informationContractDigestHex: string;
  runtimeReleaseDigestHex: string;
  liveEnvelopeDigestHex: string;
}>;

export type LiveEdgeDriftChannelObservationV2 = Readonly<{
  channel: LiveEdgeDriftChannelV2;
  state: LiveEdgeDriftEvidenceStateV2;
  observedAt: string;
  boundIdentityDigestHex: string;
  restrictive: boolean;
  failClosedPosture: LiveEdgeDriftPostureV2;
  breachPosture: LiveEdgeDriftPostureV2;
}>;

export type LiveEdgeDriftPolicyV2 = Readonly<{
  policyVersion: typeof LIVE_EDGE_DRIFT_RESTRICTION_POLICY_V2;
  maxStalenessMs: number;
  coolingOffMs: number;
}>;

export type LiveEdgeDriftRestrictionReceiptV2 = Readonly<{
  schemaVersion: typeof LIVE_EDGE_DRIFT_RESTRICTION_SCHEMA_V2;
  policyVersion: typeof LIVE_EDGE_DRIFT_RESTRICTION_POLICY_V2;
  authority: "RESTRICTION_ONLY";
  capitalAuthority: "NONE";
  organizationId: string;
  assessedAt: string;
  boundIdentity: LiveEdgeDriftBoundIdentityV2;
  boundIdentityDigestHex: string;
  previousPosture: LiveEdgeDriftPostureV2;
  assessedPosture: LiveEdgeDriftPostureV2;
  effectivePosture: LiveEdgeDriftPostureV2;
  widenedWithoutAuthority: boolean;
  reasonCodes: readonly string[];
  contentDigestHex: string;
}>;

export type AssessLiveEdgeDriftRestrictionV2Input = Readonly<{
  organizationId: string;
  assessedAt: string;
  boundIdentity: LiveEdgeDriftBoundIdentityV2;
  policy: LiveEdgeDriftPolicyV2;
  previousPosture: LiveEdgeDriftPostureV2;
  previousAssessedAt: string | null;
  observations: readonly LiveEdgeDriftChannelObservationV2[];
  humanRecoveryAckDigestHex: string | null;
}>;

function requireHex(value: string, code: string): void {
  if (!HEX64.test(value)) throw new Error(code);
}

function pitMs(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(code);
  }
  return parsed;
}

function moreRestrictive(
  left: LiveEdgeDriftPostureV2,
  right: LiveEdgeDriftPostureV2,
): LiveEdgeDriftPostureV2 {
  return LIVE_EDGE_DRIFT_POSTURE_RANK_V2[left] >= LIVE_EDGE_DRIFT_POSTURE_RANK_V2[right]
    ? left
    : right;
}

export function boundLiveEdgeDriftIdentityDigestV2(identity: LiveEdgeDriftBoundIdentityV2): string {
  return computeSemanticSha256Hex(identity);
}

export function assessLiveEdgeDriftRestrictionV2(
  input: AssessLiveEdgeDriftRestrictionV2Input,
): LiveEdgeDriftRestrictionReceiptV2 {
  if (!input.organizationId.trim()) throw new Error("DRIFT_ORGANIZATION_INVALID");
  if (input.policy.policyVersion !== LIVE_EDGE_DRIFT_RESTRICTION_POLICY_V2) {
    throw new Error("DRIFT_POLICY_VERSION_INVALID");
  }
  if (!Number.isSafeInteger(input.policy.maxStalenessMs) || input.policy.maxStalenessMs < 0) {
    throw new Error("DRIFT_POLICY_INVALID");
  }
  if (!Number.isSafeInteger(input.policy.coolingOffMs) || input.policy.coolingOffMs < 0) {
    throw new Error("DRIFT_POLICY_INVALID");
  }
  requireHex(input.boundIdentity.qualificationTupleDigestHex, "DRIFT_IDENTITY_INVALID");
  requireHex(input.boundIdentity.packageDigestHex, "DRIFT_IDENTITY_INVALID");
  requireHex(input.boundIdentity.informationContractDigestHex, "DRIFT_IDENTITY_INVALID");
  requireHex(input.boundIdentity.runtimeReleaseDigestHex, "DRIFT_IDENTITY_INVALID");
  requireHex(input.boundIdentity.liveEnvelopeDigestHex, "DRIFT_IDENTITY_INVALID");
  if (input.humanRecoveryAckDigestHex !== null) {
    requireHex(input.humanRecoveryAckDigestHex, "DRIFT_HUMAN_ACK_INVALID");
  }

  const assessedAtMs = pitMs(input.assessedAt, "DRIFT_ASSESSED_AT_INVALID");
  const previousAssessedAtMs =
    input.previousAssessedAt === null
      ? null
      : pitMs(input.previousAssessedAt, "DRIFT_PREVIOUS_AT_INVALID");
  if (previousAssessedAtMs !== null && assessedAtMs < previousAssessedAtMs) {
    throw new Error("DRIFT_LOOKAHEAD");
  }

  const boundIdentityDigestHex = boundLiveEdgeDriftIdentityDigestV2(input.boundIdentity);
  const reasonCodes: string[] = [];
  let assessedPosture: LiveEdgeDriftPostureV2 = "NORMAL";
  const observationsByChannel = new Map<
    LiveEdgeDriftChannelV2,
    LiveEdgeDriftChannelObservationV2
  >();
  for (const observation of input.observations) {
    if (observationsByChannel.has(observation.channel)) {
      reasonCodes.push(`DRIFT_${observation.channel}_DUPLICATE`);
      assessedPosture = moreRestrictive(assessedPosture, "SUPERVISED_STOP");
      continue;
    }
    observationsByChannel.set(observation.channel, observation);
  }

  for (const channel of LIVE_EDGE_DRIFT_CHANNELS_V2) {
    const observation = observationsByChannel.get(channel);
    if (!observation) {
      reasonCodes.push(`DRIFT_${channel}_MISSING`);
      assessedPosture = moreRestrictive(assessedPosture, "NO_NEW_RISK");
      continue;
    }

    if (observation.boundIdentityDigestHex !== boundIdentityDigestHex) {
      reasonCodes.push(`DRIFT_${channel}_TUPLE_MISMATCH`);
      assessedPosture = moreRestrictive(assessedPosture, "SUPERVISED_STOP");
      continue;
    }

    const observedAtMs = pitMs(observation.observedAt, "DRIFT_OBSERVED_AT_INVALID");
    if (observedAtMs > assessedAtMs) {
      reasonCodes.push(`DRIFT_${channel}_LOOKAHEAD`);
      assessedPosture = moreRestrictive(assessedPosture, observation.failClosedPosture);
      continue;
    }
    if (
      assessedAtMs - observedAtMs > input.policy.maxStalenessMs ||
      observation.state === "STALE"
    ) {
      reasonCodes.push(`DRIFT_${channel}_STALE`);
      assessedPosture = moreRestrictive(assessedPosture, observation.failClosedPosture);
      continue;
    }
    if (
      observation.state === "MISSING" ||
      observation.state === "UNKNOWN" ||
      observation.state === "MISMATCH"
    ) {
      reasonCodes.push(`DRIFT_${channel}_${observation.state}`);
      assessedPosture = moreRestrictive(assessedPosture, observation.failClosedPosture);
      continue;
    }
    if (observation.restrictive) {
      reasonCodes.push(`DRIFT_${channel}_BREACH`);
      assessedPosture = moreRestrictive(assessedPosture, observation.breachPosture);
    }
  }

  const coolingOffElapsed =
    previousAssessedAtMs !== null &&
    assessedAtMs - previousAssessedAtMs >= input.policy.coolingOffMs;
  const recoveryAuthorized =
    LIVE_EDGE_DRIFT_POSTURE_RANK_V2[assessedPosture] <
    LIVE_EDGE_DRIFT_POSTURE_RANK_V2[input.previousPosture]
      ? coolingOffElapsed && input.humanRecoveryAckDigestHex !== null
      : true;
  const widenedWithoutAuthority = !recoveryAuthorized;
  const effectivePosture = widenedWithoutAuthority
    ? moreRestrictive(assessedPosture, input.previousPosture)
    : assessedPosture;

  const body = {
    schemaVersion: LIVE_EDGE_DRIFT_RESTRICTION_SCHEMA_V2,
    policyVersion: LIVE_EDGE_DRIFT_RESTRICTION_POLICY_V2,
    authority: "RESTRICTION_ONLY" as const,
    capitalAuthority: "NONE" as const,
    organizationId: input.organizationId,
    assessedAt: input.assessedAt,
    boundIdentity: input.boundIdentity,
    boundIdentityDigestHex,
    previousPosture: input.previousPosture,
    assessedPosture,
    effectivePosture,
    widenedWithoutAuthority,
    reasonCodes: [...reasonCodes].sort(),
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
