import { describe, expect, it } from "vitest";

import {
  evaluateFhvHostStoragePolicy,
  FHV_HOST_MAX_UTILIZATION_FRACTION,
  FHV_HUMAN_MAC_MIN_FREE_BYTES,
} from "@/lib/trader/observability/fhv-host-storage-policy";

/**
 * WP-10, Human decision APPROVE_PR452_WP10_DYNAMIC_70_30_HOST_FLOOR. The floor is proportional to
 * the filesystem, not a fixed byte count, so the guarantee is a post-run utilization ceiling
 * rather than a number that means different things on different hosts.
 */
describe("FHV host storage policy", () => {
  const terabyte = 1024 ** 4;

  it("passes when the projected peak still leaves 30% of capacity free", () => {
    const decision = evaluateFhvHostStoragePolicy({
      totalCapacityBytes: terabyte,
      currentFreeBytes: terabyte * 0.6,
      projectedAdditionalPeakBytes: terabyte * 0.2,
    });

    expect(decision.pass).toBe(true);
    expect(decision.classification).toBe("FHV_HOST_STORAGE_WITHIN_POLICY");
    expect(decision.projectedUtilizationFraction).toBeLessThanOrEqual(
      FHV_HOST_MAX_UTILIZATION_FRACTION,
    );
  });

  it("fails when the peak would push utilization past 70%", () => {
    const decision = evaluateFhvHostStoragePolicy({
      totalCapacityBytes: terabyte,
      currentFreeBytes: terabyte * 0.35,
      projectedAdditionalPeakBytes: terabyte * 0.2,
    });

    expect(decision.pass).toBe(false);
    expect(decision.classification).toBe("FHV_HOST_STORAGE_BELOW_70_30_FLOOR");
    expect(decision.projectedUtilizationFraction).toBeGreaterThan(
      FHV_HOST_MAX_UTILIZATION_FRACTION,
    );
    expect(decision.reason).toContain("30% reserve");
  });

  it("computes requiredFreeBytes as peak plus a ceiled 30% reserve", () => {
    const decision = evaluateFhvHostStoragePolicy({
      totalCapacityBytes: 1_000_000_001,
      currentFreeBytes: 0,
      projectedAdditionalPeakBytes: 5_000,
    });

    expect(decision.reserveBytes).toBe(Math.ceil(1_000_000_001 * 0.3));
    expect(decision.requiredFreeBytes).toBe(5_000 + decision.reserveBytes);
  });

  it("keeps the additional absolute floor for Human workstation work", () => {
    const decision = evaluateFhvHostStoragePolicy({
      totalCapacityBytes: terabyte,
      // Proportionally fine, but below the absolute workstation floor.
      currentFreeBytes: 20 * 1024 ** 3,
      projectedAdditionalPeakBytes: 0,
      absoluteMinimumFreeBytes: FHV_HUMAN_MAC_MIN_FREE_BYTES,
    });

    expect(decision.pass).toBe(false);
    expect(decision.classification).toBe("FHV_HOST_STORAGE_BELOW_ABSOLUTE_FLOOR");
  });

  it("fails closed when capacity is unknown", () => {
    const decision = evaluateFhvHostStoragePolicy({
      totalCapacityBytes: 0,
      currentFreeBytes: 0,
      projectedAdditionalPeakBytes: 0,
    });

    expect(decision.pass).toBe(false);
  });
});
