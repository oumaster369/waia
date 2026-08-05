import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createFhvFullHistoricalProgressReporter,
  FHV_FULL_HISTORICAL_PROGRESS_FILENAME,
  writeFhvFullHistoricalProgressAtomic,
  type FhvFullHistoricalProgressV1,
} from "@/lib/trader/observability/fhv-full-historical-progress";

describe("fhv-full-historical-progress (observational)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes progress atomically outside checkpoint rotation paths", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-progress-"));
    dirs.push(root);
    const runDir = join(root, "run");
    const artifactRoot = join(root, "artifacts");
    const reporter = createFhvFullHistoricalProgressReporter({
      runDir,
      artifactRoot,
      targetCycleCount: 1000,
      intervalMs: 1,
    });
    reporter.noteCheckpoint(12.5);
    reporter.noteCheckpoint(20);
    const progress = reporter.forceReport({
      cycleCount: 400,
      epochId: 1,
      globalEventSequence: 400,
    });
    expect(progress.schemaVersion).toBe("fhv-full-historical-progress/v1");
    expect(progress.checkpointCount).toBe(2);
    expect(progress.cumulativeCheckpointDurationMs).toBe(32.5);
    expect(progress.effectiveBarsPerSecond).toBeGreaterThan(0);
    const fromRun = JSON.parse(
      readFileSync(join(runDir, FHV_FULL_HISTORICAL_PROGRESS_FILENAME), "utf8"),
    ) as FhvFullHistoricalProgressV1;
    const fromArtifact = JSON.parse(
      readFileSync(join(artifactRoot, FHV_FULL_HISTORICAL_PROGRESS_FILENAME), "utf8"),
    ) as FhvFullHistoricalProgressV1;
    expect(fromRun.globalEventSequence).toBe(400);
    expect(fromArtifact.checkpointCount).toBe(2);
  });

  it("atomic writer replaces via temp rename", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-progress-atomic-"));
    dirs.push(root);
    const path = join(root, FHV_FULL_HISTORICAL_PROGRESS_FILENAME);
    const sample: FhvFullHistoricalProgressV1 = {
      schemaVersion: "fhv-full-historical-progress/v1",
      capturedAtUtc: "2026-08-05T00:00:00.000Z",
      elapsedSeconds: 1,
      globalEventSequence: 10,
      sourceProgressPct: 1,
      currentEpochId: 0,
      currentCycleCount: 10,
      effectiveBarsPerSecond: 10,
      lastCheckpointDurationMs: null,
      cumulativeCheckpointDurationMs: 0,
      checkpointCount: 0,
      evidenceBytesWritten: null,
      sqliteDatabaseBytes: null,
      rssBytes: 1,
      heapUsedBytes: 1,
      estimatedRemainingSeconds: 99,
      targetCycleCount: 1000,
    };
    writeFhvFullHistoricalProgressAtomic(path, sample);
    writeFhvFullHistoricalProgressAtomic(path, { ...sample, globalEventSequence: 20 });
    const parsed = JSON.parse(readFileSync(path, "utf8")) as FhvFullHistoricalProgressV1;
    expect(parsed.globalEventSequence).toBe(20);
  });
});
