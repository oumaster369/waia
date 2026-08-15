import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  assertFhvGrowthLawReportV2,
  buildFhvGrowthLawReportV2,
  FhvGrowthLawReportError,
} from "@/lib/trader/observability/fhv-growth-law-report";
import { FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME } from "@/lib/trader/observability/fhv-full-historical-progress";
import { FHV_GROWTH_LAW_REPORT_FILENAME } from "@/lib/trader/observability/fhv-growth-law";
import { qualifyFhvThroughputHost } from "@/lib/trader/observability/fhv-throughput-qualification";
import {
  FHV_THROUGHPUT_EVIDENCE_INVALID_CLASSIFICATION,
  FHV_THROUGHPUT_NOT_QUALIFIED_CLASSIFICATION,
} from "@/lib/trader/observability/fhv-throughput-receipt";
import { FhvT4CheckoutIdentityError } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import type { FhvFullHistoricalProgressV1 } from "@/lib/trader/observability/fhv-full-historical-progress";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function makeRepo(): { repo: string; headSha: string } {
  const repo = mkdtempSync(join(tmpdir(), "fhv-qual-repo-"));
  roots.push(repo);
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "test"]);
  writeFileSync(join(repo, "README"), "bound\n");
  git(repo, ["add", "README"]);
  git(repo, ["commit", "-m", "init"]);
  return { repo, headSha: git(repo, ["rev-parse", "HEAD"]) };
}

function progressLine(
  overrides: Partial<FhvFullHistoricalProgressV1> & {
    globalEventSequence: number;
    sqliteDatabaseBytes: number;
  },
): FhvFullHistoricalProgressV1 {
  return {
    schemaVersion: "fhv-full-historical-progress/v1",
    capturedAtUtc: "2026-08-15T00:00:00.000Z",
    elapsedSeconds: overrides.globalEventSequence / 1_000,
    sourceProgressPct: 1,
    currentEpochId: Math.floor(overrides.globalEventSequence / 1_000),
    currentCycleCount: overrides.globalEventSequence,
    effectiveBarsPerSecond: 1_000,
    lastCheckpointDurationMs: 5,
    cumulativeCheckpointDurationMs: 5,
    checkpointCount: Math.max(1, Math.floor(overrides.globalEventSequence / 1_000)),
    evidenceBytesWritten: null,
    rssBytes: 1,
    heapUsedBytes: 1,
    estimatedRemainingSeconds: null,
    targetCycleCount: 6_312_960,
    rollingBarsPerSecond: 1_000,
    windowBarsPerSecond: 1_000,
    checkpointExcludedBarsPerSecond: 1_000,
    windowCheckpointExcludedBarsPerSecond: 1_000,
    estimatedRemainingSecondsLifetimeAverage: null,
    projectedTotalRuntimeSecondsRolling: null,
    lastCheckpointBytes: overrides.sqliteDatabaseBytes,
    checkpointBytesPerSecond: 1_000,
    sessionDatabaseGrowthBytesPerCycle: 0,
    ficloneSucceeded: true,
    ...overrides,
  };
}

function writeProgress(
  runDir: string,
  points: readonly (readonly [number, number, number?])[],
): void {
  mkdirSync(runDir, { recursive: true });
  const lines = points.map(([cycle, bytes, hotCps], index) =>
    JSON.stringify(
      progressLine({
        globalEventSequence: cycle,
        sqliteDatabaseBytes: bytes,
        windowCheckpointExcludedBarsPerSecond: hotCps ?? 1_800,
        checkpointExcludedBarsPerSecond: hotCps ?? 1_800,
        lastCheckpointDurationMs: index === 0 ? null : 5,
        lastCheckpointBytes: index === 0 ? null : bytes,
        checkpointCount: index === 0 ? 0 : Math.max(1, Math.floor(cycle / 1_000)),
      }),
    ),
  );
  writeFileSync(join(runDir, FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME), `${lines.join("\n")}\n`);
}

function boundedPoints(): (readonly [number, number, number?])[] {
  return [
    [0, 256_000, 1_800],
    [500, 1_200_000, 1_810],
    [1_000, 2_662_400, 1_790],
    [1_500, 2_662_400, 1_805],
    [2_000, 2_662_400, 1_800],
    [2_500, 2_662_400, 1_795],
    [3_000, 2_662_400, 1_802],
    [3_500, 2_662_400, 1_798],
  ];
}

describe("FHV growth-law report identity binding", () => {
  it("accepts an exact clean checkout", () => {
    const { repo, headSha } = makeRepo();
    const runDir = join(repo, "run");
    writeProgress(runDir, boundedPoints());
    const report = buildFhvGrowthLawReportV2({ runDir, repoPath: repo, expectedHeadSha: headSha });
    expect(report.checkout.headSha).toBe(headSha);
    expect(report.progressBytesSha256).toHaveLength(64);
    expect(report.reportDigest).toHaveLength(64);
    expect(report.checkpointSamples).toBeGreaterThan(0);
    expect(report.checkpointSamples).not.toBe(report.progressSamples);
  });

  it("rejects a dirty tracked checkout for official evidence", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    writeProgress(runDir, boundedPoints());
    writeFileSync(join(repo, "README"), "dirty\n");
    expect(() => buildFhvGrowthLawReportV2({ runDir, repoPath: repo })).toThrow(
      FhvT4CheckoutIdentityError,
    );
  });

  it("rejects claimed release SHA != HEAD", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    writeProgress(runDir, boundedPoints());
    expect(() =>
      buildFhvGrowthLawReportV2({
        runDir,
        repoPath: repo,
        expectedHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).toThrow(FhvT4CheckoutIdentityError);
  });

  it("rejects progress byte mutation after report creation", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    writeProgress(runDir, boundedPoints());
    const report = buildFhvGrowthLawReportV2({ runDir, repoPath: repo });
    const reportPath = join(runDir, FHV_GROWTH_LAW_REPORT_FILENAME);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    writeProgress(runDir, [...boundedPoints(), [4_000, 2_662_400, 1_800]]);
    try {
      assertFhvGrowthLawReportV2({ reportPath, runDir, expectedHeadSha: report.checkout.headSha });
      throw new Error("expected digest mismatch");
    } catch (error) {
      expect((error as FhvGrowthLawReportError).code).toBe(
        "FHV_GROWTH_LAW_PROGRESS_DIGEST_MISMATCH",
      );
    }
  });

  it("rejects a mutated report self-digest", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    writeProgress(runDir, boundedPoints());
    const report = buildFhvGrowthLawReportV2({ runDir, repoPath: repo });
    const reportPath = join(runDir, FHV_GROWTH_LAW_REPORT_FILENAME);
    writeFileSync(
      reportPath,
      `${JSON.stringify({ ...report, progressSamples: report.progressSamples + 1 }, null, 2)}\n`,
    );
    try {
      assertFhvGrowthLawReportV2({ reportPath, runDir });
      throw new Error("expected digest mismatch");
    } catch (error) {
      expect((error as FhvGrowthLawReportError).code).toBe("FHV_GROWTH_LAW_REPORT_DIGEST_MISMATCH");
    }
  });
});

describe("FHV throughput qualification classification", () => {
  it("classifies insufficient stability evidence as EVIDENCE_INVALID, not host NOT_QUALIFIED", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    writeProgress(runDir, [
      [0, 2_662_400, 1_800],
      [1_000, 2_662_400, 1_800],
      [2_000, 2_662_400, 1_800],
    ]);
    const report = buildFhvGrowthLawReportV2({ runDir, repoPath: repo });
    writeFileSync(
      join(runDir, FHV_GROWTH_LAW_REPORT_FILENAME),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const receipt = qualifyFhvThroughputHost({ runDir, repoPath: repo });
    expect(receipt.classification).toBe(FHV_THROUGHPUT_EVIDENCE_INVALID_CLASSIFICATION);
    expect(receipt.evidence.hotPathDecayVerdict).toBe("INSUFFICIENT_SAMPLES");
  });

  it("classifies valid unbounded evidence as NOT_QUALIFIED rather than invalid", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    const points = [0, 1, 2, 3, 4, 5, 6, 7].map((step) => {
      const cycle = step * 500;
      return [cycle, 100_000 + 320 * cycle, 1_800] as const;
    });
    writeProgress(runDir, points);
    const report = buildFhvGrowthLawReportV2({ runDir, repoPath: repo });
    writeFileSync(
      join(runDir, FHV_GROWTH_LAW_REPORT_FILENAME),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const receipt = qualifyFhvThroughputHost({ runDir, repoPath: repo });
    expect(receipt.classification).toBe(FHV_THROUGHPUT_NOT_QUALIFIED_CLASSIFICATION);
    expect(receipt.evidence.boundednessClassification).toBe("UNBOUNDED");
    expect(receipt.evidence.checkpointSamples).not.toBe(receipt.evidence.progressSamples);
    expect(receipt.releaseSha).toBe(report.checkout.headSha);
    expect(receipt.evidence.checkoutHeadSha).toBe(receipt.releaseSha);
  });
});
