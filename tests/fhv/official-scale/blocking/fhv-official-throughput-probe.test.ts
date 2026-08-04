/**
 * Phase 10 — FHV official-scale throughput probe (blocking gate).
 */

import { existsSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";

import {
  CHECKPOINT_EVERY_CYCLES,
  LAST_COMMITTED_CYCLE_INDEX,
  LAST_TARGET_CYCLE_INDEX,
  TARGET_CYCLE_COUNT,
} from "./fhv-official-scale-constants";
import {
  assertFhvOfficialScaleProbeNonTrivialCheckpoint,
  buildFhvOfficialScaleHarnessContext,
  buildFhvOfficialScaleMetrics,
  resolveBarsProcessed,
  resolveFhvOfficialScaleCheckpointBytes,
  resolveWp17OpenCount,
  setupFhvOfficialScaleLaunchPaths,
  toFhvOfficialScaleLaunchInput,
  writeFhvOfficialScaleMetrics,
} from "./fhv-official-scale-harness";

export {
  CHECKPOINT_EVERY_CYCLES,
  LAST_COMMITTED_CYCLE_INDEX,
  LAST_TARGET_CYCLE_INDEX,
  TARGET_CYCLE_COUNT,
} from "./fhv-official-scale-constants";

describe("FHV official-scale throughput probe (Phase 10 blocking)", () => {
  const harness = buildFhvOfficialScaleHarnessContext();

  beforeAll(() => {
    expect(existsSync(harness.datasetRoot)).toBe(true);
    expect(existsSync(harness.manifestPath)).toBe(true);
  }, 600_000);

  it("documents official-scale throughput constants", () => {
    expect(CHECKPOINT_EVERY_CYCLES).toBe(3997);
    expect(LAST_COMMITTED_CYCLE_INDEX).toBe(3996);
    expect(TARGET_CYCLE_COUNT).toBe(4509);
    expect(LAST_TARGET_CYCLE_INDEX).toBe(4508);
    expect(LAST_COMMITTED_CYCLE_INDEX).toBeLessThan(TARGET_CYCLE_COUNT);
  });

  it("FHV_OFFICIAL_ENGINE_THROUGHPUT_PROBE: synthetic scale authority throughput proof", async () => {
    const runId = "fhv-official-scale-probe";
    const paths = setupFhvOfficialScaleLaunchPaths({
      harness,
      runId,
      maxCycles: TARGET_CYCLE_COUNT,
      targetCycleCount: TARGET_CYCLE_COUNT,
      checkpointEveryCycles: CHECKPOINT_EVERY_CYCLES,
    });

    const startedAt = Date.now();
    const result = await executeFhvFullHistoricalLaunch(
      toFhvOfficialScaleLaunchInput(paths, { maxCycles: TARGET_CYCLE_COUNT }),
    );
    // Feasibility uses pure hot-path wall (runBacktest), not seed/receipt setup tax.
    const wallTimeMs = result.hotPathWallTimeMs ?? Date.now() - startedAt;

    expect(result.classification).toBe("FHV_SYNTHETIC_SCALE_PROBE_COMPLETED");
    expect(result.classification).not.toBe("FULL_HISTORICAL_VALIDATION_COMPLETED");

    const barsProcessed = resolveBarsProcessed({
      sourceFrontier: result.backtest?.sourceFrontier,
      cycleCount: result.backtest?.cycleCount,
    });
    const { checkpointBytes, checkpointBackupDurationMs } = resolveFhvOfficialScaleCheckpointBytes(
      result.runDir,
    );
    const metrics = buildFhvOfficialScaleMetrics({
      cycleCount: result.backtest?.cycleCount ?? 0,
      barsProcessed,
      wallTimeMs,
      classification: result.classification,
      checkpointBytes,
      checkpointBackupDurationMs,
      artifactRoot: harness.artifactRoot,
      runDir: result.runDir,
    });
    writeFhvOfficialScaleMetrics(harness.artifactRoot, metrics);

    const reachedCheckpoint = (result.backtest?.cycleCount ?? 0) >= CHECKPOINT_EVERY_CYCLES;
    assertFhvOfficialScaleProbeNonTrivialCheckpoint({
      fillsCount: result.backtest?.accountingFrontierState?.consumedFillIds.length ?? 0,
      accountingSequence: result.backtest?.accountingFrontierState?.accountingSequence ?? 0,
      wp17OpenCount: resolveWp17OpenCount(result.runDir),
      reachedCheckpoint,
    });

    if (!metrics.feasibilityTimePass) {
      expect.fail(
        `BLOCKED_BY_CI_SCALE_TIME_FEASIBILITY: cps=${metrics.cps.toFixed(3)} projected_runtime_s=${metrics.projectedRuntimeS.toFixed(1)}`,
      );
    }
    if (!metrics.feasibilityDiskPass) {
      expect.fail("BLOCKED_BY_CI_SCALE_DISK_FEASIBILITY");
    }
    expect(metrics.probeGateClassification).toBe("FHV_OFFICIAL_ENGINE_THROUGHPUT_PROBE_PASS");
  }, 600_000);
});
