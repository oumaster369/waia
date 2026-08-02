/**
 * Phase 13 — FHV official-scale full corpus technical completion (blocking gate).
 */

import { existsSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { FHV_OFFICIAL_TOTAL_BARS } from "@/lib/trader/market-data/fhv-official-scale-corpus";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";

import {
  buildFhvOfficialScaleHarnessContext,
  readFhvOfficialScaleMetrics,
  setupFhvOfficialScaleLaunchPaths,
  toFhvOfficialScaleLaunchInput,
} from "./fhv-official-scale-harness";
import {
  CHECKPOINT_EVERY_CYCLES,
  LAST_COMMITTED_CYCLE_INDEX,
  LAST_TARGET_CYCLE_INDEX,
  TARGET_CYCLE_COUNT,
} from "./fhv-official-scale-constants";

describe("FHV official-scale full corpus (Phase 13 blocking)", () => {
  const harness = buildFhvOfficialScaleHarnessContext();

  beforeAll(() => {
    const metrics = readFhvOfficialScaleMetrics(harness.artifactRoot);
    if (!metrics) {
      throw new Error(
        "BLOCKED_BY_CI_SCALE_TIME_FEASIBILITY: probe metrics missing — run throughput probe first",
      );
    }
    if (!metrics.feasibilityTimePass || metrics.cps < 877) {
      throw new Error(
        `BLOCKED_BY_CI_SCALE_TIME_FEASIBILITY: probe cps=${metrics.cps.toFixed(3)} projected_runtime_s=${metrics.projectedRuntimeS.toFixed(1)}`,
      );
    }
    expect(existsSync(harness.datasetRoot)).toBe(true);
  }, 600_000);

  it("documents full corpus completion constants", () => {
    expect(TARGET_CYCLE_COUNT).toBe(4509);
    expect(LAST_TARGET_CYCLE_INDEX).toBe(4508);
    expect(CHECKPOINT_EVERY_CYCLES).toBe(3997);
    expect(LAST_COMMITTED_CYCLE_INDEX).toBe(3996);
    expect(FHV_OFFICIAL_TOTAL_BARS).toBe(6_312_960);
  });

  it("FHV_OFFICIAL_FULL_CORPUS: OFFICIAL_MULTI_YEAR technical completion", async () => {
    const metrics = readFhvOfficialScaleMetrics(harness.artifactRoot);
    if (!metrics?.feasibilityTimePass) {
      expect.fail(
        `BLOCKED_BY_CI_SCALE_TIME_FEASIBILITY: cps=${metrics?.cps?.toFixed(3) ?? "unknown"}`,
      );
    }

    const runId = "fhv-official-scale-full-corpus";
    const paths = setupFhvOfficialScaleLaunchPaths({
      harness,
      runId,
      maxCycles: null,
      targetCycleCount: FHV_OFFICIAL_TOTAL_BARS,
      checkpointEveryCycles: CHECKPOINT_EVERY_CYCLES,
    });

    const result = await executeFhvFullHistoricalLaunch(toFhvOfficialScaleLaunchInput(paths));

    expect(result.classification).toBe("FULL_HISTORICAL_TECHNICAL_COMPLETION");
    expect(result.backtest?.sourceFrontier?.globalEventSequence).toBe(FHV_OFFICIAL_TOTAL_BARS);
    expect(result.backtest?.sourceFrontier?.sourceExhausted).toBe(true);
  }, 1_800_000);

  it("FHV_OFFICIAL_FULL_CORPUS: must not classify FULL_HISTORICAL_VALIDATION_COMPLETED", async () => {
    const metrics = readFhvOfficialScaleMetrics(harness.artifactRoot);
    if (!metrics?.feasibilityTimePass) {
      expect.fail("BLOCKED_BY_CI_SCALE_TIME_FEASIBILITY");
    }

    const runId = "fhv-official-scale-full-corpus-guard";
    const paths = setupFhvOfficialScaleLaunchPaths({
      harness,
      runId,
      maxCycles: null,
      targetCycleCount: FHV_OFFICIAL_TOTAL_BARS,
    });
    const result = await executeFhvFullHistoricalLaunch(toFhvOfficialScaleLaunchInput(paths));
    expect(result.classification).not.toBe("FULL_HISTORICAL_VALIDATION_COMPLETED");
    expect(result.classification).toBe("FULL_HISTORICAL_TECHNICAL_COMPLETION");
  }, 1_800_000);
});
