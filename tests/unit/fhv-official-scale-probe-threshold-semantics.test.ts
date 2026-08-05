/**
 * H-ARCH-1 / PR452: blocking CI floor (877 / 7200) vs Phase-10 local probe target (1000).
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  buildFhvOfficialScaleMetrics,
  DEFAULT_PROBE_TARGET_CPS,
  evaluateFhvOfficialScaleTimeFeasibility,
  MAX_PROJECTED_FULL_CORPUS_RUNTIME_S,
  MIN_THROUGHPUT_CPS,
  resolveProbeTargetCps,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-harness";
import { FHV_OFFICIAL_TOTAL_BARS } from "@/lib/trader/market-data/fhv-official-scale-corpus";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("FHV official-scale probe threshold semantics (plan §8 / Phase 10)", () => {
  const prior = process.env.FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND;

  afterEach(() => {
    if (prior === undefined) {
      delete process.env.FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND;
    } else {
      process.env.FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND = prior;
    }
  });

  it("locks the hard floor and Phase-10 target constants", () => {
    expect(MIN_THROUGHPUT_CPS).toBe(877);
    expect(DEFAULT_PROBE_TARGET_CPS).toBe(1000);
    expect(MAX_PROJECTED_FULL_CORPUS_RUNTIME_S).toBe(7200);
    expect(Math.ceil(FHV_OFFICIAL_TOTAL_BARS / MAX_PROJECTED_FULL_CORPUS_RUNTIME_S)).toBe(
      MIN_THROUGHPUT_CPS,
    );
  });

  it("classifies CI-observed cps=884.159 / projected=7140.1 as blocking PASS", () => {
    // Exact CI probe failure on fda57d7 under the incorrect 1000-as-floor wiring.
    const cps = 884.159;
    const projectedRuntimeS = 7140.1;
    const barsProcessed = 4547;
    const reconstructedWallMs = (barsProcessed / cps) * 1000;
    const time = evaluateFhvOfficialScaleTimeFeasibility({
      barsProcessed,
      wallTimeMs: reconstructedWallMs,
    });
    expect(time.cps).toBeCloseTo(cps, 3);
    expect(time.projectedRuntimeS).toBeCloseTo(projectedRuntimeS, 1);
    expect(time.pass).toBe(true);
    expect(time.cps).toBeGreaterThanOrEqual(MIN_THROUGHPUT_CPS);
    expect(time.projectedRuntimeS).toBeLessThanOrEqual(MAX_PROJECTED_FULL_CORPUS_RUNTIME_S);
    // Phase-10 target remains unmet and visible.
    expect(time.cps).toBeLessThan(DEFAULT_PROBE_TARGET_CPS);
  });

  it("fails blocking feasibility below 877 cps", () => {
    const barsProcessed = 4547;
    const wallTimeMs = (barsProcessed / 876) * 1000;
    const time = evaluateFhvOfficialScaleTimeFeasibility({ barsProcessed, wallTimeMs });
    expect(time.cps).toBeLessThan(MIN_THROUGHPUT_CPS);
    expect(time.pass).toBe(false);
  });

  it("fails blocking feasibility when projected runtime exceeds 7200s", () => {
    const barsProcessed = 4547;
    // cps just under the projected-runtime boundary for the full corpus.
    const wallTimeMs = (barsProcessed / 876.5) * 1000;
    const time = evaluateFhvOfficialScaleTimeFeasibility({ barsProcessed, wallTimeMs });
    expect(time.projectedRuntimeS).toBeGreaterThan(MAX_PROJECTED_FULL_CORPUS_RUNTIME_S);
    expect(time.pass).toBe(false);
  });

  it("keeps the Phase-10 1000 target visible and env-adjustable without gating feasibility", () => {
    delete process.env.FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND;
    expect(resolveProbeTargetCps()).toBe(1000);

    process.env.FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND = "1000";
    expect(resolveProbeTargetCps()).toBe(1000);

    // Env may raise the reported target; it must not enter evaluateFhvOfficialScaleTimeFeasibility.
    process.env.FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND = "2000";
    expect(resolveProbeTargetCps()).toBe(2000);
    const barsProcessed = 4547;
    const wallTimeMs = (barsProcessed / 884.159) * 1000;
    const time = evaluateFhvOfficialScaleTimeFeasibility({ barsProcessed, wallTimeMs });
    expect(time.pass).toBe(true);
    expect(time.cps).toBeLessThan(resolveProbeTargetCps());
  });

  it("rejects env attempts to weaken the hard floor via minThroughputCps argument", () => {
    const barsProcessed = 4547;
    const wallTimeMs = (barsProcessed / 880) * 1000;
    const weakened = evaluateFhvOfficialScaleTimeFeasibility({
      barsProcessed,
      wallTimeMs,
      minThroughputCps: 500,
    });
    // 880 ≥ 877 → still governed by the hard floor clamp, not 500.
    expect(weakened.pass).toBe(true);

    const belowFloor = evaluateFhvOfficialScaleTimeFeasibility({
      barsProcessed,
      wallTimeMs: (barsProcessed / 800) * 1000,
      minThroughputCps: 500,
    });
    expect(belowFloor.pass).toBe(false);
  });

  it("keeps env 1000 as visible probeTargetPass=false without failing feasibilityTimePass", () => {
    process.env.FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND = "1000";
    const root = mkdtempSync(join(tmpdir(), "fhv-probe-thresh-"));
    const runDir = mkdtempSync(join(tmpdir(), "fhv-probe-run-"));
    const barsProcessed = 4547;
    const wallTimeMs = (barsProcessed / 884.159) * 1000;
    const metrics = buildFhvOfficialScaleMetrics({
      cycleCount: 10_000,
      barsProcessed,
      wallTimeMs,
      classification: "PROBE",
      checkpointBytes: null,
      checkpointBackupDurationMs: null,
      artifactRoot: root,
      runDir,
    });
    expect(metrics.feasibilityTimePass).toBe(true);
    expect(metrics.probeTargetCps).toBe(1000);
    expect(metrics.probeTargetPass).toBe(false);
    expect(metrics.probeGateClassification).not.toBe("BLOCKED_BY_CI_SCALE_TIME_FEASIBILITY");
  });
});
