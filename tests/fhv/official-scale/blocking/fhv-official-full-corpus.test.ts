/**
 * Phase 13 — FHV official-scale full corpus technical completion (blocking gate).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { FHV_OFFICIAL_TOTAL_BARS } from "@/lib/trader/market-data/fhv-official-scale-corpus";
import {
  executeFhvFullHistoricalLaunch,
  resolveFhvFullLaunchRunDirectory,
} from "@/lib/trader/observability/fhv-full-historical-launch";

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

/** Plan §13: 125-minute process-kill ceiling (semantic acceptance remains ≤7200s). */
const FULL_CORPUS_TEST_TIMEOUT_MS = 7_500_000;

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

  it(
    "FHV_OFFICIAL_FULL_CORPUS: OFFICIAL_MULTI_YEAR technical completion",
    async () => {
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

      const journalPath = join(paths.runDir, "fhv-launch-journal.v1.json");
      const resume = existsSync(journalPath);
      const startedAt = Date.now();
      const result = await executeFhvFullHistoricalLaunch(
        toFhvOfficialScaleLaunchInput(paths, { resume }),
      );
      const wallTimeMs = Date.now() - startedAt;
      expect(wallTimeMs / 1000).toBeLessThanOrEqual(7200);

      expect(result.classification).toBe("FULL_HISTORICAL_TECHNICAL_COMPLETION");
      expect(result.classification).not.toBe("FULL_HISTORICAL_VALIDATION_COMPLETED");
      expect(result.backtest?.sourceFrontier?.globalEventSequence).toBe(FHV_OFFICIAL_TOTAL_BARS);
      expect(result.backtest?.sourceFrontier?.sourceExhausted).toBe(true);
    },
    FULL_CORPUS_TEST_TIMEOUT_MS,
  );

  it("FHV_OFFICIAL_FULL_CORPUS: must not classify FULL_HISTORICAL_VALIDATION_COMPLETED", () => {
    const runDir = resolveFhvFullLaunchRunDirectory(
      harness.artifactRoot,
      "fhv-official-scale-full-corpus",
    );
    const launchResultPath = join(runDir, "fhv-full-launch-result.v1.json");
    expect(existsSync(launchResultPath)).toBe(true);
    const launchResult = JSON.parse(readFileSync(launchResultPath, "utf8")) as {
      classification: string;
    };
    expect(launchResult.classification).not.toBe("FULL_HISTORICAL_VALIDATION_COMPLETED");
    expect(launchResult.classification).toBe("FULL_HISTORICAL_TECHNICAL_COMPLETION");
  });
});
