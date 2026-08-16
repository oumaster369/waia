/**
 * DEE-536 — hot-path stability assessor v2.
 *
 * Authority is equal work-mass on cumulative sequence vs checkpoint-excluded hot time.
 * Sampler-window CPS is diagnostic only. Legal subdivision of the same cumulative curve
 * must not change the FLAT/DECAYING verdict when both representations meet evidence minima.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  assertFhvGrowthLawReportV2,
  buildFhvGrowthLawReportV2,
  FhvGrowthLawReportError,
} from "@/lib/trader/observability/fhv-growth-law-report";
import {
  assessFhvHotPathDecay,
  FHV_GROWTH_LAW_REPORT_FILENAME,
  FHV_HOT_PATH_STABILITY_ASSESSOR_VERSION,
  FHV_HOT_PATH_STABILITY_DECAY_RATIO_CAP,
} from "@/lib/trader/observability/fhv-growth-law";
import type { FhvFullHistoricalProgressV1 } from "@/lib/trader/observability/fhv-full-historical-progress";
import { execFileSync } from "node:child_process";
import { FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME } from "@/lib/trader/observability/fhv-full-historical-progress";
import {
  createFhvThroughputProducerBinding,
  stampFhvProgressProducerIdentity,
} from "@/lib/trader/observability/fhv-throughput-producer-binding";
import { buildFhvThroughputQualifierSamplerContract } from "@/lib/trader/observability/fhv-throughput-sampler";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function sample(overrides: Partial<FhvFullHistoricalProgressV1>): FhvFullHistoricalProgressV1 {
  return {
    schemaVersion: "fhv-full-historical-progress/v1",
    capturedAtUtc: "2026-08-16T00:00:00.000Z",
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
    sqliteDatabaseBytes: 2_662_400,
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

function elapsedForPiecewiseCps(
  seq: number,
  midSeq: number,
  earlyCps: number,
  lateCps: number,
): number {
  if (seq <= midSeq) {
    return seq / earlyCps;
  }
  return midSeq / earlyCps + (seq - midSeq) / lateCps;
}

function seriesFromSeqElapsed(
  points: readonly (readonly [number, number])[],
  windowCps?: (index: number) => number | null,
): FhvFullHistoricalProgressV1[] {
  return points.map(([seq, elapsedSeconds], index) =>
    sample({
      globalEventSequence: seq,
      elapsedSeconds,
      currentCycleCount: seq,
      windowCheckpointExcludedBarsPerSecond: windowCps?.(index) ?? 1_800,
      checkpointExcludedBarsPerSecond: windowCps?.(index) ?? 1_800,
    }),
  );
}

function constantCpsSeries(input: {
  cps: number;
  startSeq: number;
  endSeq: number;
  steps: number;
  windowCps?: (index: number) => number | null;
}): FhvFullHistoricalProgressV1[] {
  const points: [number, number][] = [];
  for (let step = 0; step <= input.steps; step += 1) {
    const frac = step / input.steps;
    const seq = input.startSeq + frac * (input.endSeq - input.startSeq);
    points.push([seq, seq / input.cps]);
  }
  return seriesFromSeqElapsed(points, input.windowCps);
}

describe("FHV hot-path stability assessor v2", () => {
  it("locks the 10% degradation cap and v2 assessor identity", () => {
    expect(FHV_HOT_PATH_STABILITY_DECAY_RATIO_CAP).toBe(0.1);
    expect(FHV_HOT_PATH_STABILITY_ASSESSOR_VERSION).toBe("fhv-hot-path-stability-assessor/v2");
  });

  it("keeps the same verdict and ratio at 250 ms-equivalent vs denser sampling of one curve", () => {
    const cps = 1_800;
    const endSeq = 1_800;
    const coarse = constantCpsSeries({ cps, startSeq: 0, endSeq, steps: 4 });
    const dense = constantCpsSeries({ cps, startSeq: 0, endSeq, steps: 20 });
    const coarseAssessment = assessFhvHotPathDecay(coarse);
    const denseAssessment = assessFhvHotPathDecay(dense);
    expect(coarseAssessment.windowCount).toBeGreaterThanOrEqual(4);
    expect(denseAssessment.windowCount).toBeGreaterThan(coarseAssessment.windowCount);
    expect(coarseAssessment.verdict).toBe("FLAT");
    expect(denseAssessment.verdict).toBe(coarseAssessment.verdict);
    expect(denseAssessment.earlyCps).toBeCloseTo(coarseAssessment.earlyCps!, 4);
    expect(denseAssessment.lateCps).toBeCloseTo(coarseAssessment.lateCps!, 4);
    expect(denseAssessment.decayRatio).toBeCloseTo(coarseAssessment.decayRatio!, 6);
  });

  it("keeps the same decaying verdict after denser sampling of a degraded curve", () => {
    const earlyCps = 1_800;
    const lateCps = 1_500;
    const endSeq = 3_600;
    const midSeq = endSeq / 2;
    const make = (steps: number) => {
      const points: [number, number][] = [];
      for (let step = 0; step <= steps; step += 1) {
        const seq = (step / steps) * endSeq;
        points.push([seq, elapsedForPiecewiseCps(seq, midSeq, earlyCps, lateCps)]);
      }
      return seriesFromSeqElapsed(points);
    };
    const coarse = assessFhvHotPathDecay(make(4));
    const dense = assessFhvHotPathDecay(make(20));
    expect(coarse.verdict).toBe("DECAYING");
    expect(dense.verdict).toBe("DECAYING");
    expect(dense.earlyCps).toBeCloseTo(coarse.earlyCps!, 3);
    expect(dense.lateCps).toBeCloseTo(coarse.lateCps!, 3);
    expect(dense.decayRatio).toBeCloseTo(coarse.decayRatio!, 5);
  });

  it("merging adjacent collinear intervals does not change the verdict", () => {
    const dense = constantCpsSeries({ cps: 1_800, startSeq: 0, endSeq: 1_800, steps: 8 });
    const merged = constantCpsSeries({ cps: 1_800, startSeq: 0, endSeq: 1_800, steps: 4 });
    const denseAssessment = assessFhvHotPathDecay(dense);
    const mergedAssessment = assessFhvHotPathDecay(merged);
    expect(denseAssessment.windowCount).toBeGreaterThan(mergedAssessment.windowCount);
    expect(mergedAssessment.windowCount).toBeGreaterThanOrEqual(4);
    expect(mergedAssessment.verdict).toBe(denseAssessment.verdict);
    expect(mergedAssessment.earlyCps).toBeCloseTo(denseAssessment.earlyCps!, 4);
    expect(mergedAssessment.lateCps).toBeCloseTo(denseAssessment.lateCps!, 4);
    expect(mergedAssessment.decayRatio).toBeCloseTo(denseAssessment.decayRatio!, 6);
  });

  it("keeps a stable ~1800 cps trajectory FLAT despite bursty short-window CPS", () => {
    const burst = [null, 400, 3_500, 200, 4_000, 180, 3_200, 1_800];
    const series = constantCpsSeries({
      cps: 1_800,
      startSeq: 0,
      endSeq: 3_600,
      steps: 7,
      windowCps: (index) => burst[index] ?? 1_800,
    });
    const assessment = assessFhvHotPathDecay(series);
    expect(assessment.verdict).toBe("FLAT");
    expect(assessment.earlyCps).toBeCloseTo(1_800, 3);
    expect(assessment.lateCps).toBeCloseTo(1_800, 3);
    expect(assessment.firstHotCps).toBe(400);
    expect(assessment.lastHotCps).toBe(1_800);
  });

  it("classifies genuine sustained late degradation above 10% as DECAYING", () => {
    const earlyCps = 1_800;
    const lateCps = 1_580;
    const endSeq = 3_600;
    const midSeq = endSeq / 2;
    const series = seriesFromSeqElapsed(
      [0, 1, 2, 3, 4].map((step) => {
        const seq = (step / 4) * endSeq;
        return [seq, elapsedForPiecewiseCps(seq, midSeq, earlyCps, lateCps)] as const;
      }),
    );
    const assessment = assessFhvHotPathDecay(series);
    expect(assessment.verdict).toBe("DECAYING");
    expect(assessment.decayRatio).toBeGreaterThan(0.1);
    expect(assessment.decayRatio).toBeLessThan(0.2);
  });

  it("keeps severe sustained late degradation DECAYING", () => {
    const earlyCps = 1_800;
    const lateCps = 700;
    const endSeq = 3_600;
    const midSeq = endSeq / 2;
    const series = seriesFromSeqElapsed(
      [0, 1, 2, 3, 4].map((step) => {
        const seq = (step / 4) * endSeq;
        return [seq, elapsedForPiecewiseCps(seq, midSeq, earlyCps, lateCps)] as const;
      }),
    );
    const assessment = assessFhvHotPathDecay(series);
    expect(assessment.verdict).toBe("DECAYING");
    expect(assessment.decayRatio).toBeGreaterThan(0.5);
  });

  it("does not let one endpoint window outlier control authority", () => {
    const series = constantCpsSeries({
      cps: 1_800,
      startSeq: 0,
      endSeq: 3_600,
      steps: 6,
      windowCps: (index) => (index === 1 ? 8_000 : index === 6 ? 90 : 1_800),
    });
    const assessment = assessFhvHotPathDecay(series);
    expect(assessment.verdict).toBe("FLAT");
    expect(assessment.firstHotCps).toBe(8_000);
    expect(assessment.lastHotCps).toBe(90);
    expect(assessment.decayRatio).toBeCloseTo(0, 4);
  });

  it("fails closed on non-monotonic cumulative sequence", () => {
    const series = seriesFromSeqElapsed([
      [0, 0],
      [1_000, 1],
      [800, 2],
      [2_000, 3],
      [3_000, 4],
    ]);
    expect(assessFhvHotPathDecay(series).verdict).toBe("INSUFFICIENT_SAMPLES");
  });

  it("fails closed on non-increasing elapsedSeconds", () => {
    const series = seriesFromSeqElapsed([
      [0, 0],
      [1_000, 1],
      [2_000, 1],
      [3_000, 2],
      [4_000, 3],
    ]);
    expect(assessFhvHotPathDecay(series).verdict).toBe("INSUFFICIENT_SAMPLES");
  });

  it("fails closed when checkpoint duration decreases", () => {
    const series = [0, 1, 2, 3, 4].map((step) =>
      sample({
        globalEventSequence: step * 1_000,
        elapsedSeconds: step,
        cumulativeCheckpointDurationMs: step === 3 ? 1 : step * 10,
        windowCheckpointExcludedBarsPerSecond: 1_000,
      }),
    );
    expect(assessFhvHotPathDecay(series).verdict).toBe("INSUFFICIENT_SAMPLES");
  });

  it("fails closed when positive work has zero hot-time delta", () => {
    const series = [0, 1, 2, 3, 4].map((step) =>
      sample({
        globalEventSequence: step * 1_000,
        elapsedSeconds: step,
        cumulativeCheckpointDurationMs: step * 1_000,
        windowCheckpointExcludedBarsPerSecond: 1_000,
      }),
    );
    expect(assessFhvHotPathDecay(series).verdict).toBe("INSUFFICIENT_SAMPLES");
  });

  it("fails closed on non-finite cumulative facts", () => {
    const series = [0, 1, 2, 3, 4].map((step) =>
      sample({
        globalEventSequence: step * 1_000,
        elapsedSeconds: step === 2 ? Number.NaN : step,
        windowCheckpointExcludedBarsPerSecond: 1_000,
      }),
    );
    expect(assessFhvHotPathDecay(series).verdict).toBe("INSUFFICIENT_SAMPLES");
  });

  it("fails closed on insufficient evidence", () => {
    const series = constantCpsSeries({ cps: 1_800, startSeq: 0, endSeq: 1_800, steps: 2 });
    expect(assessFhvHotPathDecay(series).verdict).toBe("INSUFFICIENT_SAMPLES");
    expect(assessFhvHotPathDecay(series).windowCount).toBeLessThan(4);
  });
});

describe("FHV growth-law report fails closed on unsupported hot-path assessor", () => {
  function git(repo: string, args: string[]): string {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  }

  it("rejects a v1 assessor identity even with a matching digest", () => {
    const repo = mkdtempSync(join(tmpdir(), "fhv-hotpath-repo-"));
    roots.push(repo);
    git(repo, ["init"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "test"]);
    writeFileSync(join(repo, "README"), "bound\n");
    git(repo, ["add", "README"]);
    git(repo, ["commit", "-m", "init"]);
    const runDir = join(repo, "run");
    mkdirSync(runDir, { recursive: true });
    const points = [0, 500, 1_000, 1_500, 2_000, 2_500, 3_000, 3_500].map((seq) =>
      sample({
        globalEventSequence: seq,
        elapsedSeconds: seq / 1_000,
        sqliteDatabaseBytes: 2_662_400,
        windowCheckpointExcludedBarsPerSecond: 1_800,
        checkpointCount: seq === 0 ? 0 : Math.max(1, Math.floor(seq / 1_000)),
      }),
    );
    const binding = createFhvThroughputProducerBinding({
      runDir,
      repoPath: repo,
      runId: "fhv-qual-test-run",
      samplerContract: buildFhvThroughputQualifierSamplerContract({
        FHV_IDHPS_PROGRESS_INTERVAL_MS: "0",
      }),
    });
    const stamp = stampFhvProgressProducerIdentity(binding);
    writeFileSync(
      join(runDir, FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME),
      `${points.map((point) => JSON.stringify({ ...point, ...stamp })).join("\n")}\n`,
    );
    const report = buildFhvGrowthLawReportV2({ runDir, repoPath: repo });
    const mutated = {
      ...report,
      hotPath: {
        ...report.hotPath,
        assessorVersion: "fhv-hot-path-stability-assessor/v1",
      },
    };
    const { reportDigest, ...body } = mutated;
    expect(reportDigest).toHaveLength(64);
    const rewritten = {
      ...body,
      reportDigest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    };
    const reportPath = join(runDir, FHV_GROWTH_LAW_REPORT_FILENAME);
    writeFileSync(reportPath, `${JSON.stringify(rewritten, null, 2)}\n`);
    try {
      assertFhvGrowthLawReportV2({ reportPath, runDir, expectedHeadSha: report.checkout.headSha });
      throw new Error("expected unsupported assessor");
    } catch (error) {
      expect((error as FhvGrowthLawReportError).code).toBe(
        "FHV_GROWTH_LAW_HOT_PATH_ASSESSOR_UNSUPPORTED",
      );
    }
  });
});
