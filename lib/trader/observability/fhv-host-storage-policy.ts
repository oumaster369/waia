import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

/**
 * FHV host storage policy (WP-10).
 *
 * Human decision `APPROVE_PR452_WP10_DYNAMIC_70_30_HOST_FLOOR`. The previous 512 MiB absolute
 * floor was meaningless for a multi-hour campaign that writes tens of gigabytes: it could pass on
 * a nearly full disk and then fail the run halfway through. The floor is now dynamic — a run may
 * only start if, after its projected peak, the filesystem still retains 30% of its total capacity
 * free, i.e. final utilization stays at or below 70%.
 */

export const FHV_HOST_RESERVE_FRACTION = 0.3;
export const FHV_HOST_MAX_UTILIZATION_FRACTION = 0.7;

/** Human workstations keep an additional absolute floor on top of the proportional reserve. */
export const FHV_HUMAN_MAC_MIN_FREE_BYTES = 30 * 1024 ** 3;

export type FhvHostStorageDecisionV1 = Readonly<{
  currentFreeBytes: number;
  totalCapacityBytes: number;
  projectedAdditionalPeakBytes: number;
  reserveBytes: number;
  requiredFreeBytes: number;
  freeAfterPeakBytes: number;
  projectedUtilizationFraction: number;
  pass: boolean;
  classification:
    | "FHV_HOST_STORAGE_WITHIN_POLICY"
    | "FHV_HOST_STORAGE_BELOW_70_30_FLOOR"
    | "FHV_HOST_STORAGE_BELOW_ABSOLUTE_FLOOR";
  reason: string | null;
}>;

/**
 * Evaluate whether a host may start a run.
 *
 * Fails closed: a host that cannot supply capacity figures produces a failing decision rather
 * than an optimistic one.
 */
export function evaluateFhvHostStoragePolicy(input: {
  currentFreeBytes: number;
  totalCapacityBytes: number;
  projectedAdditionalPeakBytes: number;
  /** Applies the additional absolute floor used for Human workstation work. */
  absoluteMinimumFreeBytes?: number;
}): FhvHostStorageDecisionV1 {
  const reserveBytes = Math.ceil(input.totalCapacityBytes * FHV_HOST_RESERVE_FRACTION);
  const requiredFreeBytes = input.projectedAdditionalPeakBytes + reserveBytes;
  const freeAfterPeakBytes = input.currentFreeBytes - input.projectedAdditionalPeakBytes;
  const usedAfterPeak = input.totalCapacityBytes - freeAfterPeakBytes;
  const projectedUtilizationFraction =
    input.totalCapacityBytes > 0 ? usedAfterPeak / input.totalCapacityBytes : 1;

  const absoluteMinimum = input.absoluteMinimumFreeBytes ?? 0;
  if (absoluteMinimum > 0 && input.currentFreeBytes < absoluteMinimum) {
    return {
      currentFreeBytes: input.currentFreeBytes,
      totalCapacityBytes: input.totalCapacityBytes,
      projectedAdditionalPeakBytes: input.projectedAdditionalPeakBytes,
      reserveBytes,
      requiredFreeBytes,
      freeAfterPeakBytes,
      projectedUtilizationFraction,
      pass: false,
      classification: "FHV_HOST_STORAGE_BELOW_ABSOLUTE_FLOOR",
      reason: `free ${input.currentFreeBytes} < absolute minimum ${absoluteMinimum}`,
    };
  }

  const pass =
    input.totalCapacityBytes > 0 &&
    input.projectedAdditionalPeakBytes >= 0 &&
    input.currentFreeBytes >= requiredFreeBytes;
  return {
    currentFreeBytes: input.currentFreeBytes,
    totalCapacityBytes: input.totalCapacityBytes,
    projectedAdditionalPeakBytes: input.projectedAdditionalPeakBytes,
    reserveBytes,
    requiredFreeBytes,
    freeAfterPeakBytes,
    projectedUtilizationFraction,
    pass,
    classification: pass ? "FHV_HOST_STORAGE_WITHIN_POLICY" : "FHV_HOST_STORAGE_BELOW_70_30_FLOOR",
    reason: pass
      ? null
      : `free ${input.currentFreeBytes} < required ${requiredFreeBytes} ` +
        `(peak ${input.projectedAdditionalPeakBytes} + 30% reserve ${reserveBytes})`,
  };
}
