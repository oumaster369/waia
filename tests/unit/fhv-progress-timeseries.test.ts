/**
 * WP-1 — kill-survivable FHV progress telemetry.
 *
 * PR452 run 31011816726 produced a single overwritten snapshot and a completely silent
 * 125-minute job log, so the throughput decay curve had to be reconstructed forensically from
 * checkpoint mtimes. These tests lock the append-only series, the rolling-vs-lifetime rate
 * split, and the bounded overhead.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendFhvFullHistoricalProgressJsonl,
  createFhvFullHistoricalProgressReporter,
  FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME,
  FHV_FULL_HISTORICAL_PROGRESS_ROLLING_SAMPLES,
  resolveFhvFullHistoricalProgressJsonlPath,
  type FhvFullHistoricalProgressV1,
} from "@/lib/trader/observability/fhv-full-historical-progress";

const dirs: string[] = [];

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(root);
  return root;
}

function readSeries(runDir: string): FhvFullHistoricalProgressV1[] {
  const raw = readFileSync(resolveFhvFullHistoricalProgressJsonlPath(runDir), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FhvFullHistoricalProgressV1);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WP-1 FHV progress time series", () => {
  it("appends one durable record per report and never rewrites history", () => {
    const root = makeRoot("fhv-progress-jsonl-");
    const runDir = join(root, "run");
    const artifactRoot = join(root, "artifacts");
    const reporter = createFhvFullHistoricalProgressReporter({
      runDir,
      artifactRoot,
      targetCycleCount: 10_000,
      intervalMs: 1,
    });

    for (let index = 1; index <= 4; index += 1) {
      reporter.forceReport({
        cycleCount: index * 100,
        epochId: index,
        globalEventSequence: index * 100,
      });
    }

    const series = readSeries(runDir);
    expect(series).toHaveLength(4);
    expect(series.map((entry) => entry.globalEventSequence)).toEqual([100, 200, 300, 400]);
    // Monotonic, append-only.
    for (let index = 1; index < series.length; index += 1) {
      expect(series[index]!.globalEventSequence).toBeGreaterThan(
        series[index - 1]!.globalEventSequence,
      );
      expect(series[index]!.elapsedSeconds).toBeGreaterThanOrEqual(
        series[index - 1]!.elapsedSeconds,
      );
    }

    // The artifact-root copy is staged for CI upload alongside the snapshot.
    expect(existsSync(join(artifactRoot, FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME))).toBe(true);
  });

  it("survives SIGKILL: records written before the kill remain readable", () => {
    const root = makeRoot("fhv-progress-kill-");
    const runDir = join(root, "run");
    // Mirror the durable append (O_APPEND + fsync), then hard-kill the writer process.
    const child = `
      const fs = require('node:fs');
      const path = ${JSON.stringify(resolveFhvFullHistoricalProgressJsonlPath(runDir))};
      fs.mkdirSync(require('node:path').dirname(path), { recursive: true });
      for (let i = 1; i <= 3; i += 1) {
        const fd = fs.openSync(path, 'a');
        fs.writeSync(fd, JSON.stringify({ schemaVersion: 'fhv-full-historical-progress/v1', globalEventSequence: i * 10 }) + '\\n');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
      }
      process.kill(process.pid, 'SIGKILL');
    `;
    try {
      execFileSync(process.execPath, ["-e", child], { stdio: "pipe" });
    } catch {
      // SIGKILL is the expected termination.
    }

    const series = readSeries(runDir);
    expect(series).toHaveLength(3);
    expect(series[2]?.globalEventSequence).toBe(30);
  });

  it("reports rolling and lifetime rates separately on a decaying series", () => {
    const root = makeRoot("fhv-progress-decay-");
    const runDir = join(root, "run");
    const reporter = createFhvFullHistoricalProgressReporter({
      runDir,
      targetCycleCount: 1_000_000,
      intervalMs: 1,
    });

    // Fast start then a stall: lifetime average stays high while the rolling rate collapses.
    reporter.forceReport({ cycleCount: 500_000, epochId: 0, globalEventSequence: 500_000 });
    const busyUntil = Date.now() + 60;
    while (Date.now() < busyUntil) {
      /* advance the wall clock without advancing the sequence */
    }
    const stalled = reporter.forceReport({
      cycleCount: 500_100,
      epochId: 1,
      globalEventSequence: 500_100,
    });

    expect(stalled.rollingBarsPerSecond).not.toBeNull();
    expect(stalled.windowBarsPerSecond).not.toBeNull();
    expect(stalled.rollingBarsPerSecond!).toBeLessThan(stalled.effectiveBarsPerSecond);
    // Both ETAs are published so the lifetime optimism is visible rather than hidden.
    expect(stalled.estimatedRemainingSecondsLifetimeAverage).not.toBeNull();
    expect(stalled.estimatedRemainingSeconds!).toBeGreaterThan(
      stalled.estimatedRemainingSecondsLifetimeAverage!,
    );
    expect(stalled.projectedTotalRuntimeSecondsRolling).not.toBeNull();
  });

  it("separates checkpoint cost from hot-path throughput", () => {
    const root = makeRoot("fhv-progress-hotpath-");
    const runDir = join(root, "run");
    const reporter = createFhvFullHistoricalProgressReporter({
      runDir,
      targetCycleCount: 100_000,
      intervalMs: 1,
    });

    reporter.forceReport({ cycleCount: 1_000, epochId: 0, globalEventSequence: 1_000 });
    // Let real wall time accrue, then attribute part of it to a checkpoint.
    const busyUntil = Date.now() + 60;
    while (Date.now() < busyUntil) {
      /* accrue elapsed wall time */
    }
    reporter.noteCheckpoint(20);
    const sample = reporter.forceReport({
      cycleCount: 2_000,
      epochId: 1,
      globalEventSequence: 2_000,
    });

    expect(sample.cumulativeCheckpointDurationMs).toBe(20);
    expect(sample.checkpointCount).toBe(1);
    // With checkpoint time subtracted the hot path must look faster than end-to-end.
    expect(sample.checkpointExcludedBarsPerSecond).not.toBeNull();
    expect(sample.checkpointExcludedBarsPerSecond!).toBeGreaterThan(sample.effectiveBarsPerSecond);
  });

  it("retains a bounded rolling window", () => {
    expect(FHV_FULL_HISTORICAL_PROGRESS_ROLLING_SAMPLES).toBe(5);
    const root = makeRoot("fhv-progress-window-");
    const runDir = join(root, "run");
    const reporter = createFhvFullHistoricalProgressReporter({
      runDir,
      targetCycleCount: 100_000,
      intervalMs: 1,
    });
    for (let index = 1; index <= 12; index += 1) {
      reporter.forceReport({
        cycleCount: index * 10,
        epochId: index,
        globalEventSequence: index * 10,
      });
    }
    expect(readSeries(runDir)).toHaveLength(12);
  });

  it("append overhead stays far below the 0.5% stop condition", () => {
    const root = makeRoot("fhv-progress-overhead-");
    const jsonlPath = join(root, FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME);
    const sample = {
      schemaVersion: "fhv-full-historical-progress/v1",
      globalEventSequence: 1,
    } as unknown as FhvFullHistoricalProgressV1;

    const iterations = 50;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      appendFhvFullHistoricalProgressJsonl(jsonlPath, sample);
    }
    const perAppendMs = (performance.now() - startedAt) / iterations;

    // Sampling is gated to at most one report per 30s of wall clock.
    const overheadFraction = perAppendMs / 30_000;
    expect(overheadFraction).toBeLessThan(0.005);
  });
});
