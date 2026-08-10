import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  evaluateFhvHostStoragePolicy,
  type FhvHostStorageDecisionV1,
} from "@/lib/trader/observability/fhv-host-storage-policy";

export type FhvDiskPreflightDecisionV1 = Readonly<{
  schemaVersion: "fhv-disk-preflight/v1";
  hotStateBytes: number;
  checkpointBytes: number;
  safetyReserveBytes: number;
  requiredBytes: number;
  currentFreeBytes: number;
  totalCapacityBytes: number;
  pass: boolean;
  classification: "FHV_DISK_PREFLIGHT_PASS" | "FHV_DISK_PREFLIGHT_FAIL" | "FHV_ENOSPC_FAIL_CLOSED";
  hostPolicy: FhvHostStorageDecisionV1;
  reason: string | null;
}>;

/**
 * Disk preflight: `required_bytes = hot + checkpoint + safety_reserve`.
 *
 * Uses the WP-10 70/30 host policy for the capacity check; fails closed when figures are unknown.
 */
export function evaluateFhvDiskPreflightGate(input: {
  currentFreeBytes: number;
  totalCapacityBytes: number;
  hotStateBytes: number;
  checkpointBytes: number;
  safetyReserveBytes: number;
  absoluteMinimumFreeBytes?: number;
}): FhvDiskPreflightDecisionV1 {
  const requiredBytes =
    Math.max(0, input.hotStateBytes) +
    Math.max(0, input.checkpointBytes) +
    Math.max(0, input.safetyReserveBytes);

  const hostPolicy = evaluateFhvHostStoragePolicy({
    currentFreeBytes: input.currentFreeBytes,
    totalCapacityBytes: input.totalCapacityBytes,
    projectedAdditionalPeakBytes: requiredBytes,
    absoluteMinimumFreeBytes: input.absoluteMinimumFreeBytes,
  });

  const enospcFailClosed =
    input.currentFreeBytes >= 0 &&
    input.totalCapacityBytes > 0 &&
    input.currentFreeBytes < requiredBytes;

  const pass = hostPolicy.pass && !enospcFailClosed;
  const classification = enospcFailClosed
    ? "FHV_ENOSPC_FAIL_CLOSED"
    : pass
      ? "FHV_DISK_PREFLIGHT_PASS"
      : "FHV_DISK_PREFLIGHT_FAIL";

  return {
    schemaVersion: "fhv-disk-preflight/v1",
    hotStateBytes: input.hotStateBytes,
    checkpointBytes: input.checkpointBytes,
    safetyReserveBytes: input.safetyReserveBytes,
    requiredBytes,
    currentFreeBytes: input.currentFreeBytes,
    totalCapacityBytes: input.totalCapacityBytes,
    pass,
    classification,
    hostPolicy,
    reason: pass
      ? null
      : enospcFailClosed
        ? `free ${input.currentFreeBytes} < required ${requiredBytes} (ENOSPC fail-closed)`
        : hostPolicy.reason,
  };
}

export function assertFhvDiskPreflightPass(decision: FhvDiskPreflightDecisionV1): void {
  if (!decision.pass) {
    throw new Error(`${decision.classification}: ${decision.reason ?? "disk preflight failed"}`);
  }
}
