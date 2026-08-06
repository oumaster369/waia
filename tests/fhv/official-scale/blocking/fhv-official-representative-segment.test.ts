/**
 * WP-7A (diagnostic) / WP-7B (blocking) — deep-state representative segment.
 *
 * Every pre-existing gate samples the corpus start, where the session database is near-empty and
 * at most one checkpoint occurs. Only the two-hour full corpus reached the regime where cost
 * decays, so the failure took 125 minutes to surface. This segment runs the production path with
 * enough checkpoints to observe the growth law in minutes.
 *
 * Diagnostic by default and expected RED at the audited baseline. WP-7B promotes it by setting
 * FHV_REPRESENTATIVE_SEGMENT_GATE=blocking.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getIdhpsHotPathCounters } from "@/lib/trader/execution/idhps-hot-path-counters";
import {
  executeFhvFullHistoricalLaunch,
  resolveFhvFullLaunchRunDirectory,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import {
  FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME,
  type FhvFullHistoricalProgressV1,
} from "@/lib/trader/observability/fhv-full-historical-progress";

import { TARGET_CYCLE_COUNT } from "./fhv-official-scale-constants";
import {
  buildFhvOfficialScaleHarnessContext,
  resolveBarsProcessed,
  resolveWp17OpenCount,
  setupFhvOfficialScaleLaunchPaths,
  teardownFhvOfficialScaleHarnessContext,
  toFhvOfficialScaleLaunchInput,
} from "./fhv-official-scale-harness";

const BLOCKING = process.env.FHV_REPRESENTATIVE_SEGMENT_GATE === "blocking";

export const REPRESENTATIVE_SEGMENT_REPORT_FILENAME = "fhv-deep-state-segment-report.v1.json";

/** Small enough that the bounded segment still commits several epochs. */
const SEGMENT_CHECKPOINT_EVERY_CYCLES = 1_000;
const MIN_SEGMENT_CHECKPOINTS = 3;
const SEGMENT_RUN_ID = "fhv-official-scale-deep-state-segment";

/**
 * Launch receipts and configuration freezes are single-use by design, so a repeated local run
 * would fail on the previous invocation's artifacts. CI always starts from a clean workspace.
 */
function resetSegmentRunArtifacts(artifactRoot: string): void {
  rmSync(join(artifactRoot, "prep", SEGMENT_RUN_ID), { recursive: true, force: true });
  rmSync(resolveFhvFullLaunchRunDirectory(artifactRoot, SEGMENT_RUN_ID), {
    recursive: true,
    force: true,
  });
}

type SegmentReport = {
  schemaVersion: "fhv-deep-state-segment-report/v1";
  capturedAtUtc: string;
  mode: "diagnostic" | "blocking";
  classification: string;
  cycleCount: number;
  barsProcessed: number;
  hotPathWallTimeMs: number | null;
  checkpointEveryCycles: number;
  workload: {
    fills: number;
    accountingSequence: number;
    wp17OpenCount: number;
    checkpointCount: number;
    evidenceChunkCount: number;
    reconciliationCalls: number;
    progressSamples: number;
  };
  growth: {
    sessionDatabaseBytesFirst: number | null;
    sessionDatabaseBytesLast: number | null;
    sessionDatabaseGrowthBytesPerCycle: number | null;
    checkpointDurationMsFirst: number | null;
    checkpointDurationMsLast: number | null;
    cumulativeCheckpointDurationMs: number | null;
    ficloneSucceeded: boolean | null;
  };
  throughput: {
    effectiveBarsPerSecond: number | null;
    rollingBarsPerSecond: number | null;
    checkpointExcludedBarsPerSecond: number | null;
    windowCheckpointExcludedBarsPerSecondSeries: number[];
  };
};

function readProgressSeries(runDir: string): FhvFullHistoricalProgressV1[] {
  const path = join(runDir, FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FhvFullHistoricalProgressV1);
}

function countEvidenceChunks(runDir: string): number {
  const evidenceRoot = join(runDir, "evidence");
  if (!existsSync(evidenceRoot)) {
    return 0;
  }
  let count = 0;
  const stack = [evidenceRoot];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(join(current, entry.name));
      } else if (entry.name.startsWith("chunk-")) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Open positions at the newest committed epoch checkpoint.
 *
 * `resolveWp17OpenCount` reads the research replay checkpoint, which the FHV epoch-bundle layout
 * does not publish, so it returns null here. The exchange snapshot in the bundle is the
 * authoritative source for this path.
 */
function resolveOpenPositionCount(runDir: string): number | null {
  const checkpoints = join(runDir, "checkpoints");
  if (!existsSync(checkpoints)) {
    return null;
  }
  const epochs = readdirSync(checkpoints, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^epoch-\d+$/.test(entry.name))
    .map((entry) => ({ name: entry.name, id: Number(entry.name.slice("epoch-".length)) }))
    .sort((a, b) => b.id - a.id);
  for (const epoch of epochs) {
    const path = join(checkpoints, epoch.name, "mock-exchange.v2.json");
    if (!existsSync(path)) {
      continue;
    }
    try {
      const snapshot = JSON.parse(readFileSync(path, "utf8")) as {
        positions?: readonly { quantity?: string }[];
      };
      return (snapshot.positions ?? []).filter((position) => Number(position.quantity ?? 0) !== 0)
        .length;
    } catch {
      continue;
    }
  }
  return null;
}

function countCommittedCheckpoints(runDir: string): number {
  const checkpoints = join(runDir, "checkpoints");
  if (!existsSync(checkpoints)) {
    return 0;
  }
  let retained = 0;
  for (const entry of readdirSync(checkpoints, { withFileTypes: true })) {
    if (entry.isDirectory() && /^epoch-\d+$/.test(entry.name)) {
      retained += 1;
    }
  }
  const summaries = join(checkpoints, "summaries");
  const summarized = existsSync(summaries)
    ? readdirSync(summaries).filter((name) => name.endsWith(".manifest.json")).length
    : 0;
  return retained + summarized;
}

describe("FHV deep-state representative segment", () => {
  const harness = buildFhvOfficialScaleHarnessContext();
  let report: SegmentReport | null = null;

  beforeAll(() => {
    expect(existsSync(harness.datasetRoot)).toBe(true);
    resetSegmentRunArtifacts(harness.artifactRoot);
  }, 600_000);

  afterAll(() => {
    teardownFhvOfficialScaleHarnessContext(harness);
  });

  it("collects windowed throughput, growth and checkpoint cost over a representative segment", async () => {
    const previousProgress = process.env.FHV_IDHPS_PROGRESS;
    // The segment is only useful with the WP-1 time series enabled.
    process.env.FHV_IDHPS_PROGRESS = "1";

    try {
      const paths = setupFhvOfficialScaleLaunchPaths({
        harness,
        runId: SEGMENT_RUN_ID,
        maxCycles: TARGET_CYCLE_COUNT,
        targetCycleCount: TARGET_CYCLE_COUNT,
        checkpointEveryCycles: SEGMENT_CHECKPOINT_EVERY_CYCLES,
      });

      const result = await executeFhvFullHistoricalLaunch(
        toFhvOfficialScaleLaunchInput(paths, { maxCycles: TARGET_CYCLE_COUNT }),
      );

      const series = readProgressSeries(result.runDir);
      const first = series.at(0) ?? null;
      const last = series.at(-1) ?? null;
      const growthSamples = series
        .map((entry) => entry.sessionDatabaseGrowthBytesPerCycle)
        .filter((value): value is number => value != null);

      report = {
        schemaVersion: "fhv-deep-state-segment-report/v1",
        capturedAtUtc: new Date().toISOString(),
        mode: BLOCKING ? "blocking" : "diagnostic",
        classification: result.classification,
        cycleCount: result.backtest?.cycleCount ?? 0,
        barsProcessed: resolveBarsProcessed({
          sourceFrontier: result.backtest?.sourceFrontier,
          cycleCount: result.backtest?.cycleCount,
        }),
        hotPathWallTimeMs: result.hotPathWallTimeMs ?? null,
        checkpointEveryCycles: SEGMENT_CHECKPOINT_EVERY_CYCLES,
        workload: {
          fills: result.backtest?.accountingFrontierState?.consumedFillIds.length ?? 0,
          accountingSequence: result.backtest?.accountingFrontierState?.accountingSequence ?? 0,
          wp17OpenCount:
            resolveWp17OpenCount(result.runDir) ?? resolveOpenPositionCount(result.runDir) ?? 0,
          checkpointCount: countCommittedCheckpoints(result.runDir),
          evidenceChunkCount: countEvidenceChunks(result.runDir),
          reconciliationCalls: getIdhpsHotPathCounters().reconciliationCalls,
          progressSamples: series.length,
        },
        growth: {
          sessionDatabaseBytesFirst: first?.sqliteDatabaseBytes ?? null,
          sessionDatabaseBytesLast: last?.sqliteDatabaseBytes ?? null,
          sessionDatabaseGrowthBytesPerCycle:
            growthSamples.length > 0
              ? Number(
                  (
                    growthSamples.reduce((acc, value) => acc + value, 0) / growthSamples.length
                  ).toFixed(3),
                )
              : null,
          checkpointDurationMsFirst: first?.lastCheckpointDurationMs ?? null,
          checkpointDurationMsLast: last?.lastCheckpointDurationMs ?? null,
          cumulativeCheckpointDurationMs: last?.cumulativeCheckpointDurationMs ?? null,
          ficloneSucceeded: last?.ficloneSucceeded ?? null,
        },
        throughput: {
          effectiveBarsPerSecond: last?.effectiveBarsPerSecond ?? null,
          rollingBarsPerSecond: last?.rollingBarsPerSecond ?? null,
          checkpointExcludedBarsPerSecond: last?.checkpointExcludedBarsPerSecond ?? null,
          windowCheckpointExcludedBarsPerSecondSeries: series
            .map((entry) => entry.windowCheckpointExcludedBarsPerSecond)
            .filter((value): value is number => value != null),
        },
      };

      mkdirSync(harness.artifactRoot, { recursive: true });
      writeFileSync(
        join(harness.artifactRoot, REPRESENTATIVE_SEGMENT_REPORT_FILENAME),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
      );

      process.stderr.write(
        `[fhv-deep-state-segment] mode=${report.mode} cycles=${report.cycleCount} ` +
          `fills=${report.workload.fills} open=${report.workload.wp17OpenCount} ` +
          `checkpoints=${report.workload.checkpointCount} chunks=${report.workload.evidenceChunkCount} ` +
          `reconciliation_calls=${report.workload.reconciliationCalls} ` +
          `db_growth_b_per_cycle=${report.growth.sessionDatabaseGrowthBytesPerCycle ?? "n/a"} ` +
          `hot_cps=${report.throughput.checkpointExcludedBarsPerSecond ?? "n/a"} ` +
          `cum_ckpt_ms=${report.growth.cumulativeCheckpointDurationMs ?? "n/a"}\n`,
      );
    } finally {
      if (previousProgress == null) {
        delete process.env.FHV_IDHPS_PROGRESS;
      } else {
        process.env.FHV_IDHPS_PROGRESS = previousProgress;
      }
    }

    expect(report).not.toBeNull();
  }, 1_800_000);

  it("exercises every required workload class", () => {
    const workload = report?.workload;
    expect(workload).toBeDefined();
    // Fill-dense and open-position coverage: a segment with no fills proves nothing about
    // accounting cost, and the probe gate already locks these floors.
    expect(workload!.fills).toBeGreaterThan(0);
    expect(workload!.accountingSequence).toBeGreaterThan(0);
    expect(workload!.wp17OpenCount).toBeGreaterThanOrEqual(1);
    // Multiple epoch commits are required to observe checkpoint cost at all.
    expect(workload!.checkpointCount).toBeGreaterThanOrEqual(MIN_SEGMENT_CHECKPOINTS);
    // GS-10 evidence flushes must actually occur.
    expect(workload!.evidenceChunkCount).toBeGreaterThan(0);
    // GS-07 runs three independent phases per cycle; a segment must exercise them.
    expect(workload!.reconciliationCalls).toBeGreaterThanOrEqual(3);
  });

  it("produces a usable growth-law series", () => {
    expect(report?.workload.progressSamples ?? 0).toBeGreaterThan(0);
    expect(report?.throughput.effectiveBarsPerSecond ?? 0).toBeGreaterThan(0);
  });

  it("enforces the deep-state envelope only in blocking mode", () => {
    if (!BLOCKING) {
      // WP-7A is diagnostic: it records the baseline without gating on it.
      expect(report?.mode).toBe("diagnostic");
      return;
    }
    const cumulativeCheckpointMs = report?.growth.cumulativeCheckpointDurationMs ?? 0;
    const hotPathMs = report?.hotPathWallTimeMs ?? 0;
    // Checkpointing must not dominate the segment (PR452: 21.7% and rising).
    expect(hotPathMs).toBeGreaterThan(0);
    expect(cumulativeCheckpointMs / hotPathMs).toBeLessThan(0.1);
  });
});
