import { describe, expect, it } from "vitest";

import {
  FULL_CORPUS_CHECKPOINT_EVERY_CYCLES,
  FHV_OFFICIAL_SCALE_PROFILE_RUN_COUNT,
  FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE,
  FHV_OFFICIAL_SCALE_PROFILE_TOTAL_CYCLES,
  resolveProfileRunId,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-profile-constants";
import {
  buildTierBaseline,
  computeBracketControlMsPerBar,
  computeExclusiveFloorMsPerBar,
  computeProfilerOverheadPercent,
  median,
  reconcileExclusiveStages,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-profile-harness";

describe("fhv-official-scale-profile-harness math", () => {
  it("locks schedule size and cycle budget", () => {
    expect(FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE).toHaveLength(FHV_OFFICIAL_SCALE_PROFILE_RUN_COUNT);
    expect(FHV_OFFICIAL_SCALE_PROFILE_TOTAL_CYCLES).toBe(860_000);
    expect(FULL_CORPUS_CHECKPOINT_EVERY_CYCLES).toBe(10_000);
    const sum = FHV_OFFICIAL_SCALE_PROFILE_SCHEDULE.reduce(
      (acc, entry) => acc + entry.targetCycleCount,
      0,
    );
    expect(sum).toBe(860_000);
  });

  it("builds deterministic run ids", () => {
    expect(resolveProfileRunId("A-P1")).toBe("pr452-profile-a-p1-1336ed3");
    expect(resolveProfileRunId("C-P0-3")).toBe("pr452-profile-c-p0-3-1336ed3");
  });

  it("computes median and tier baseline", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const baseline = buildTierBaseline([70, 72, 71]);
    expect(baseline.median).toBe(71);
    expect(baseline.min).toBe(70);
    expect(baseline.max).toBe(72);
    expect(baseline.range).toBe(2);
  });

  it("computes bracketing profiler overhead formula", () => {
    const bracket = computeBracketControlMsPerBar(10, 12);
    expect(bracket).toBe(11);
    expect(computeProfilerOverheadPercent(12.1, bracket)).toBeCloseTo(10, 5);
  });

  it("reconciles exclusive stages within 5%", () => {
    // 100 ms wall = 100_000_000 ns; exclusive 90 ms leaves 10 ms unattributed.
    const ok = reconcileExclusiveStages({
      exclusiveStageTotalNs: 90_000_000n,
      controlNormalizedWallTimeMs: 100,
    });
    expect(ok.pass).toBe(true);
    const fail = reconcileExclusiveStages({
      exclusiveStageTotalNs: 50_000_000n,
      controlNormalizedWallTimeMs: 100,
      unattributedNs: 0n,
    });
    expect(fail.pass).toBe(false);
  });

  it("computes exclusive floor vs 1.140 ms/bar", () => {
    const floor = computeExclusiveFloorMsPerBar({
      stageExclusiveNsByStage: {
        // totals across 10_000 bars → ms/bar = totalNs/1e6/bars
        "paper-cycle": String(80_000_000_000), // 8 ms/bar
        "bar-source-next": String(5_000_000_000), // 0.5 ms/bar
        "fused-context-build": String(1_000_000_000), // removable 0.1 ms/bar
      },
      barsProcessed: 10_000,
    });
    expect(floor.nonRemovableExclusiveFloorMsPerBar).toBeCloseTo(8.5, 5);
    expect(floor.floorAtOrBelowTarget).toBe(false);
  });
});
