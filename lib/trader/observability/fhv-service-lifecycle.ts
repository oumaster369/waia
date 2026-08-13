import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { FhvAuthorizationClaimV2 } from "@/lib/trader/observability/fhv-authorization-claim";
import { FhvAuthorizationClaimError } from "@/lib/trader/observability/fhv-authorization-claim";

export type FhvStaleRunningClaimDecisionV1 = Readonly<{
  stale: boolean;
  code: "CLAIM_STALE" | "CLAIM_RUNNING_OK";
  detail: string;
  leaseExpired: boolean;
  heartbeatMissing: boolean;
  heartbeatStale: boolean;
}>;

export function evaluateFhvStaleRunningClaim(input: {
  claim: FhvAuthorizationClaimV2;
  nowMs?: number;
  lastHeartbeatAtUtc?: string | null;
  heartbeatMaxAgeMs?: number;
}): FhvStaleRunningClaimDecisionV1 {
  if (input.claim.state !== "RUNNING") {
    return {
      stale: false,
      code: "CLAIM_RUNNING_OK",
      detail: `claim state is ${input.claim.state}`,
      leaseExpired: false,
      heartbeatMissing: false,
      heartbeatStale: false,
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const leaseExpiresMs = Date.parse(input.claim.leaseExpiresAtUtc);
  const leaseExpired = Number.isFinite(leaseExpiresMs) && leaseExpiresMs <= nowMs;

  const heartbeatMaxAgeMs = input.heartbeatMaxAgeMs ?? 120_000;
  const heartbeatAt = input.lastHeartbeatAtUtc ?? null;
  const heartbeatMissing = heartbeatAt === null;
  let heartbeatStale = false;
  if (heartbeatAt !== null) {
    const heartbeatMs = Date.parse(heartbeatAt);
    heartbeatStale = !Number.isFinite(heartbeatMs) || nowMs - heartbeatMs > heartbeatMaxAgeMs;
  }

  const stale = leaseExpired || heartbeatMissing || heartbeatStale;
  if (!stale) {
    return {
      stale: false,
      code: "CLAIM_RUNNING_OK",
      detail: "RUNNING claim has valid lease and heartbeat",
      leaseExpired,
      heartbeatMissing,
      heartbeatStale,
    };
  }

  const reasons: string[] = [];
  if (leaseExpired) {
    reasons.push("lease expired");
  }
  if (heartbeatMissing) {
    reasons.push("heartbeat missing");
  }
  if (heartbeatStale) {
    reasons.push("heartbeat stale");
  }

  return {
    stale: true,
    code: "CLAIM_STALE",
    detail: reasons.join("; "),
    leaseExpired,
    heartbeatMissing,
    heartbeatStale,
  };
}

export function assertFhvRunningClaimNotStale(input: {
  claim: FhvAuthorizationClaimV2;
  nowMs?: number;
  lastHeartbeatAtUtc?: string | null;
  heartbeatMaxAgeMs?: number;
}): void {
  const decision = evaluateFhvStaleRunningClaim(input);
  if (decision.stale) {
    throw new FhvAuthorizationClaimError(decision.code, decision.detail);
  }
}

export function resolveFhvStaleRunningClaimAction(
  decision: FhvStaleRunningClaimDecisionV1,
): "TAKEOVER" | "RESUME" | "NONE" {
  if (!decision.stale) {
    return "NONE";
  }
  if (decision.leaseExpired) {
    return "TAKEOVER";
  }
  return "RESUME";
}
