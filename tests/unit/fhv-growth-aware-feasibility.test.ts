import { describe, expect, it } from "vitest";

import {
  FHV_CANONICAL_MAX_RUNTIME_S,
  FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
} from "@/lib/trader/observability/fhv-growth-law";

import { evaluateFhvOfficialScaleTimeFeasibility } from "@/tests/fhv/official-scale/blocking/fhv-official-scale-harness";

/**
 * WP-8. The probe certified run 31011816726 as feasible and the full corpus then breached 7,200 s,
 * because `totalBars / cps` treats cost per bar as constant while checkpoint cost is Θ(database
 * size) and the database grows monotonically. The regression proof is that the growth-aware
 * projector, fed the audited run's own numbers, refuses what the legacy projection accepted.
 */
describe("FHV growth-aware feasibility projection", () => {
  /*
   * Audited baseline: ~321 bytes/cycle session growth, checkpoints every 10,000 cycles, and the
   * measured checkpoint cost curve (32 ms at 3.4 MB rising to 7,647 ms at 1.17 GB) which fits
   * ~6,530 ms/GB with a small fixed intercept.
   */
  const auditedGrowth = {
    checkpointWallTimeMs: 120_000,
    checkpointCount: 12,
    sessionGrowthBytesPerCycle: 321,
    checkpointInterceptMs: 25,
    checkpointMsPerGigabyte: 6_530,
    checkpointEveryCycles: 10_000,
  };

  it("blocks the audited probe metrics that the legacy projection accepted", () => {
    const result = evaluateFhvOfficialScaleTimeFeasibility({
      barsProcessed: 1_000_000,
      wallTimeMs: 1_000_000_000 / 1_000,
      growth: auditedGrowth,
    });

    // The legacy value is what certified the run as feasible.
    expect(result.projectedRuntimeS).toBeLessThanOrEqual(FHV_CANONICAL_MAX_RUNTIME_S);
    // The growth-aware value would have refused it.
    expect(result.projectedRuntimeSecondsWithGrowth).not.toBeNull();
    expect(result.projectedRuntimeSecondsWithGrowth!).toBeGreaterThan(FHV_CANONICAL_MAX_RUNTIME_S);
    expect(result.prelaunchPass).toBe(false);
    expect(result.prelaunchClassification).toBe("FHV_PRELAUNCH_PROJECTION_EXCEEDS_6480S");
  });

  it("keeps the 6480 s pre-launch bar distinct from the 7200 s terminal contract", () => {
    expect(FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S).toBe(6480);
    expect(FHV_CANONICAL_MAX_RUNTIME_S).toBe(7200);
    expect(FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S).toBeLessThan(FHV_CANONICAL_MAX_RUNTIME_S);
  });

  it("accepts a bounded-hot-state curve at the same corpus size", () => {
    // Post-WP-6A: ~97 bytes/cycle measured, and clone-based checkpoints cost ~380 ms/GB.
    const result = evaluateFhvOfficialScaleTimeFeasibility({
      barsProcessed: 1_000_000,
      wallTimeMs: 1_000_000_000 / 1_400,
      growth: {
        ...auditedGrowth,
        checkpointWallTimeMs: 3_000,
        sessionGrowthBytesPerCycle: 97,
        checkpointMsPerGigabyte: 380,
      },
    });

    expect(result.projectedRuntimeSecondsWithGrowth!).toBeLessThanOrEqual(
      FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
    );
    expect(result.prelaunchPass).toBe(true);
    expect(result.probeRepresentativenessWarning).toBeNull();
  });

  it("warns when the probe segment is too short to show checkpoint growth", () => {
    const result = evaluateFhvOfficialScaleTimeFeasibility({
      barsProcessed: 100_000,
      wallTimeMs: 100_000_000 / 1_400,
      growth: { ...auditedGrowth, checkpointCount: 1 },
    });

    expect(result.probeRepresentativenessWarning).toContain("1 checkpoint");
  });

  it("leaves the legacy projection and blocking constants untouched", () => {
    const withoutGrowth = evaluateFhvOfficialScaleTimeFeasibility({
      barsProcessed: 1_000_000,
      wallTimeMs: 1_000_000_000 / 1_000,
    });

    expect(withoutGrowth.projectedRuntimeSecondsWithGrowth).toBeNull();
    expect(withoutGrowth.prelaunchPass).toBeNull();
    expect(withoutGrowth.prelaunchClassification).toBe("FHV_PRELAUNCH_PROJECTION_UNAVAILABLE");
    // 877 cps and 7,200 s remain the canonical blocking pair.
    expect(withoutGrowth.pass).toBe(true);
  });
});
