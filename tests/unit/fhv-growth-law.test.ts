/**
 * WP-4 — growth law and growth-aware projection.
 *
 * The decisive check is that the projector would have blocked PR452 run 31011816726 at the probe
 * stage: the flat `totalBars / cps` model projected 7,188 s and the run was still at 65.7% after
 * 7,374 s.
 */
import { describe, expect, it } from "vitest";

import {
  assessFhvHotPathDecay,
  countFhvIndependentCheckpointObservations,
  FHV_CANONICAL_MAX_RUNTIME_S,
  FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
  fitFhvCheckpointDurationVsSize,
  fitFhvSessionGrowthLaw,
  projectFhvGrowthAwareRuntime,
  rankFhvHotspots,
} from "@/lib/trader/observability/fhv-growth-law";
import type { FhvFullHistoricalProgressV1 } from "@/lib/trader/observability/fhv-full-historical-progress";

function sample(overrides: Partial<FhvFullHistoricalProgressV1>): FhvFullHistoricalProgressV1 {
  return {
    schemaVersion: "fhv-full-historical-progress/v1",
    capturedAtUtc: "2026-08-05T00:00:00.000Z",
    elapsedSeconds: 0,
    globalEventSequence: 0,
    sourceProgressPct: 0,
    currentEpochId: 0,
    currentCycleCount: 0,
    effectiveBarsPerSecond: 0,
    lastCheckpointDurationMs: null,
    cumulativeCheckpointDurationMs: 0,
    checkpointCount: 0,
    evidenceBytesWritten: null,
    sqliteDatabaseBytes: null,
    rssBytes: 0,
    heapUsedBytes: 0,
    estimatedRemainingSeconds: null,
    targetCycleCount: 6_312_960,
    rollingBarsPerSecond: null,
    windowBarsPerSecond: null,
    checkpointExcludedBarsPerSecond: null,
    windowCheckpointExcludedBarsPerSecond: null,
    estimatedRemainingSecondsLifetimeAverage: null,
    projectedTotalRuntimeSecondsRolling: null,
    lastCheckpointBytes: null,
    checkpointBytesPerSecond: null,
    sessionDatabaseGrowthBytesPerCycle: null,
    ficloneSucceeded: null,
    ...overrides,
  };
}

describe("WP-4 FHV growth law", () => {
  it("recovers the measured session growth slope", () => {
    // 321 bytes/cycle is the PR452 measurement; WP-7A independently observed 319.8.
    const series = [0, 10_000, 20_000, 30_000, 40_000].map((seq) =>
      sample({ globalEventSequence: seq, sqliteDatabaseBytes: 4_542_464 + 321 * seq }),
    );
    const fit = fitFhvSessionGrowthLaw(series);
    expect(fit.slope).toBeCloseTo(321, 6);
    expect(fit.intercept).toBeCloseTo(4_542_464, 3);
    expect(fit.rSquared).toBeCloseTo(1, 6);
  });

  it("recovers checkpoint duration as a function of snapshot size", () => {
    const gigabyte = 1_073_741_824;
    const series = [0.1, 0.5, 1.0].map((gb) =>
      sample({
        lastCheckpointBytes: gb * gigabyte,
        lastCheckpointDurationMs: 50 + 6_500 * gb,
      }),
    );
    const fit = fitFhvCheckpointDurationVsSize(series);
    expect(fit.slope).toBeCloseTo(6_500, 3);
    expect(fit.intercept).toBeCloseTo(50, 3);
  });

  it("uses equal work-mass cumulative hot time, not window-CPS medians", () => {
    const decaying = [0, 1, 2, 3, 4].map((step) => {
      const seq = step * 10_000;
      const midSeq = 20_000;
      const elapsed = seq <= midSeq ? seq / 1_000 : midSeq / 1_000 + (seq - midSeq) / 850;
      return sample({
        elapsedSeconds: elapsed,
        globalEventSequence: seq,
        windowCheckpointExcludedBarsPerSecond: 1_000,
      });
    });
    const decayingAssessment = assessFhvHotPathDecay(decaying);
    expect(decayingAssessment.verdict).toBe("DECAYING");
    expect(decayingAssessment.assessorVersion).toBe("fhv-hot-path-stability-assessor/v2");
    expect(decayingAssessment.decayRatio).toBeGreaterThan(0.1);

    const flat = [0, 1, 2, 3, 4].map((step) =>
      sample({
        elapsedSeconds: step * 10,
        globalEventSequence: step * 10_000,
        windowCheckpointExcludedBarsPerSecond: 1_000 - step * 150,
      }),
    );
    const flatAssessment = assessFhvHotPathDecay(flat);
    expect(flatAssessment.verdict).toBe("FLAT");
    expect(flatAssessment.earlyCps).toBeCloseTo(1_000, 3);
    expect(flatAssessment.lateCps).toBeCloseTo(1_000, 3);
  });

  it("does not let first/last window-CPS outliers decide a stationary series", () => {
    const series = [0, 1, 2, 3, 4, 5, 6].map((step, index) => {
      const rates = [null, 2_000, 1_000, 1_010, 990, 1_005, 500];
      return sample({
        elapsedSeconds: step * 10,
        globalEventSequence: step * 10_000,
        windowCheckpointExcludedBarsPerSecond: rates[index],
      });
    });
    const assessment = assessFhvHotPathDecay(series);
    expect(assessment.windowCount).toBe(6);
    expect(assessment.verdict).toBe("FLAT");
    expect(assessment.firstHotCps).toBe(2_000);
    expect(assessment.lastHotCps).toBe(500);
    expect(assessment.decayRatio).toBeCloseTo(0, 4);
  });

  it("fails closed on insufficient windows", () => {
    const series = [
      sample({ elapsedSeconds: 0, globalEventSequence: 0 }),
      sample({
        elapsedSeconds: 10,
        globalEventSequence: 10_000,
        windowCheckpointExcludedBarsPerSecond: 1_000,
      }),
      sample({
        elapsedSeconds: 20,
        globalEventSequence: 20_000,
        windowCheckpointExcludedBarsPerSecond: 500,
      }),
    ];
    expect(assessFhvHotPathDecay(series).verdict).toBe("INSUFFICIENT_SAMPLES");
  });

  it("is deterministic for an identical progress series", () => {
    const series = [0, 1, 2, 3, 4].map((step) =>
      sample({
        elapsedSeconds: step * 10,
        globalEventSequence: step * 10_000,
        windowCheckpointExcludedBarsPerSecond: 900,
      }),
    );
    expect(assessFhvHotPathDecay(series)).toEqual(assessFhvHotPathDecay(series));
  });

  it("would have blocked PR452 run 31011816726 at the probe stage", () => {
    // Measured at the audited HEAD: hot path 717.99 cps, growth 321 bytes/cycle,
    // checkpoint ~6,530 ms/GB at epoch 414 (7,647 ms for 1.171 GB).
    const projection = projectFhvGrowthAwareRuntime({
      hotPathBarsPerSecond: 717.99,
      sessionGrowthBytesPerCycle: 321,
      initialSessionBytes: 4_542_464,
      checkpointInterceptMs: 30,
      checkpointMsPerGigabyte: 6_530,
      checkpointEveryCycles: 10_000,
    });

    expect(projection.withinCanonicalLimit).toBe(false);
    expect(projection.withinPreLaunchHeadroom).toBe(false);
    expect(projection.projectedRuntimeSeconds).toBeGreaterThan(FHV_CANONICAL_MAX_RUNTIME_S);
    // Checkpointing alone must dominate the budget at this architecture.
    expect(projection.checkpointSeconds).toBeGreaterThan(3_000);
    // ~2 GB final database at 6.3M cycles.
    expect(projection.finalSessionDatabaseBytes).toBeGreaterThan(2_000_000_000);
  });

  it("accepts a bounded-cost architecture within the pre-launch headroom", () => {
    // OPTION_A target: checkpoint cost independent of run length.
    const projection = projectFhvGrowthAwareRuntime({
      hotPathBarsPerSecond: 1_000,
      sessionGrowthBytesPerCycle: 0,
      initialSessionBytes: 8_000_000,
      checkpointInterceptMs: 120,
      checkpointMsPerGigabyte: 200,
      checkpointEveryCycles: 10_000,
    });
    expect(projection.withinCanonicalLimit).toBe(true);
    expect(projection.withinPreLaunchHeadroom).toBe(true);
    expect(projection.projectedRuntimeSeconds).toBeLessThanOrEqual(
      FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
    );
  });

  it("keeps the pre-launch headroom strictly inside the canonical limit", () => {
    expect(FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S).toBe(6480);
    expect(FHV_CANONICAL_MAX_RUNTIME_S).toBe(7200);
    expect(FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S).toBeLessThan(FHV_CANONICAL_MAX_RUNTIME_S);
  });

  it("ranks hotspots by measured wall-time contribution", () => {
    const ranked = rankFhvHotspots({
      accounting: { totalMs: 500, sampleCount: 10 },
      features: { totalMs: 1_500, sampleCount: 10 },
      evidence: { totalMs: 200, sampleCount: 10 },
    });
    expect(ranked.map((entry) => entry.stage)).toEqual(["features", "accounting", "evidence"]);
    expect(ranked[0]!.shareOfMeasuredMs).toBeCloseTo(0.6818, 3);
  });
});

describe("FHV independent checkpoint sample counting", () => {
  it("counts distinct checkpointCount values, not sticky lastCheckpoint fields", () => {
    const series = [0, 1, 1, 1, 2, 2].map((checkpointCount, index) =>
      sample({
        globalEventSequence: index * 100,
        checkpointCount,
        lastCheckpointBytes: checkpointCount === 0 ? null : 1_000,
        lastCheckpointDurationMs: checkpointCount === 0 ? null : 5,
      }),
    );
    expect(countFhvIndependentCheckpointObservations(series)).toBe(2);
    expect(countFhvIndependentCheckpointObservations(series)).not.toBe(5);
  });

  it("does not count checkpointCount 0 as a committed checkpoint", () => {
    const series = [0, 0, 0].map((checkpointCount, index) =>
      sample({ globalEventSequence: index, checkpointCount }),
    );
    expect(countFhvIndependentCheckpointObservations(series)).toBe(0);
  });

  it("fails closed on non-monotonic checkpointCount", () => {
    const series = [0, 1, 2, 1].map((checkpointCount, index) =>
      sample({ globalEventSequence: index, checkpointCount }),
    );
    expect(() => countFhvIndependentCheckpointObservations(series)).toThrow(
      /checkpointCount decreased/,
    );
  });
});
