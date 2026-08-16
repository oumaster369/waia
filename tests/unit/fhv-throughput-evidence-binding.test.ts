import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

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
import {
  assertFhvThroughputProducerBinding,
  createFhvThroughputProducerBinding,
  FhvThroughputProducerBindingError,
  setFhvThroughputProducerHostIdentityForTests,
  stampFhvProgressProducerIdentity,
  type FhvThroughputProducerHostIdentityV1,
} from "@/lib/trader/observability/fhv-throughput-producer-binding";
import { buildFhvThroughputQualifierSamplerContract } from "@/lib/trader/observability/fhv-throughput-sampler";

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  setFhvThroughputProducerHostIdentityForTests(null);
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
  stamp?: ReturnType<typeof stampFhvProgressProducerIdentity>,
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
        ...(stamp ?? {}),
      }),
    ),
  );
  writeFileSync(join(runDir, FHV_FULL_HISTORICAL_PROGRESS_JSONL_FILENAME), `${lines.join("\n")}\n`);
}

function writeOfficialProgress(
  repo: string,
  runDir: string,
  points: readonly (readonly [number, number, number?])[],
  env: Readonly<Record<string, string | undefined>> = { FHV_IDHPS_PROGRESS_INTERVAL_MS: "0" },
) {
  mkdirSync(runDir, { recursive: true });
  const binding = createFhvThroughputProducerBinding({
    runDir,
    repoPath: repo,
    runId: "fhv-qual-test-run",
    samplerContract: buildFhvThroughputQualifierSamplerContract(env),
  });
  writeProgress(runDir, points, stampFhvProgressProducerIdentity(binding));
  return binding;
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
    writeOfficialProgress(repo, runDir, boundedPoints());
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
    writeOfficialProgress(repo, runDir, boundedPoints());
    writeFileSync(join(repo, "README"), "dirty\n");
    expect(() => buildFhvGrowthLawReportV2({ runDir, repoPath: repo })).toThrow(
      FhvT4CheckoutIdentityError,
    );
  });

  it("rejects claimed release SHA != HEAD", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    writeOfficialProgress(repo, runDir, boundedPoints());
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
    writeOfficialProgress(repo, runDir, boundedPoints());
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
    writeOfficialProgress(repo, runDir, boundedPoints());
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
    writeOfficialProgress(repo, runDir, [
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
    writeOfficialProgress(repo, runDir, points);
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
    expect(receipt.evidence.producerHeadSha).toBe(receipt.releaseSha);
    expect(receipt.runId).toBe("fhv-qual-test-run");
    expect(receipt.evidence.runId).toBe("fhv-qual-test-run");
    expect(receipt.evidence.producerBindingDigest).toHaveLength(64);
    expect(receipt.evidence.progressBytesSha256).toHaveLength(64);
    expect(receipt.evidence.growthLawReportDigest).toHaveLength(64);
  });
});

describe("FHV execution-time producer and sampler binding", () => {
  it("fails closed when SHA-A progress is re-labelled under clean SHA-B", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    writeOfficialProgress(repo, runDir, boundedPoints());
    writeFileSync(join(repo, "README"), "sha-b\n");
    git(repo, ["add", "README"]);
    git(repo, ["commit", "-m", "sha-b"]);
    try {
      buildFhvGrowthLawReportV2({ runDir, repoPath: repo });
      throw new Error("expected producer mismatch");
    } catch (error) {
      expect((error as FhvThroughputProducerBindingError).code).toBe(
        "FHV_THROUGHPUT_PRODUCER_HEAD_MISMATCH",
      );
    }
  });

  it("records the execution-time sampler interval, not a later inherited env", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    const binding = writeOfficialProgress(repo, runDir, boundedPoints(), {
      FHV_IDHPS_PROGRESS_INTERVAL_MS: "0",
    });
    expect(binding.samplerContract.appliedIntervalMs).toBe(0);
    const report = buildFhvGrowthLawReportV2({ runDir, repoPath: repo });
    expect(report.samplerContract.appliedIntervalMs).toBe(0);
    expect(report.producer.headSha).toBe(binding.producer.headSha);
    const later = buildFhvThroughputQualifierSamplerContract({
      FHV_IDHPS_PROGRESS_INTERVAL_MS: "60000",
    });
    expect(later.appliedIntervalMs).toBe(250);
    expect(report.samplerContract.appliedIntervalMs).not.toBe(later.appliedIntervalMs);
  });

  it("cannot qualify legacy progress with no execution-time producer/sampler identity", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    writeProgress(runDir, boundedPoints());
    try {
      buildFhvGrowthLawReportV2({ runDir, repoPath: repo });
      throw new Error("expected missing producer binding");
    } catch (error) {
      expect((error as FhvThroughputProducerBindingError).code).toBe(
        "FHV_THROUGHPUT_PRODUCER_BINDING_MISSING",
      );
    }
  });
});

function testHost(
  overrides: Partial<FhvThroughputProducerHostIdentityV1> = {},
): FhvThroughputProducerHostIdentityV1 {
  return {
    hostname: "host-a",
    platform: "linux",
    arch: "x64",
    cpuModel: "Ryzen 9 9950X",
    cpuCount: 32,
    nodeVersion: "v22.23.0",
    machineIdSha256: "a".repeat(64),
    bootId: "11111111-1111-1111-1111-111111111111",
    ...overrides,
  };
}

function writeReport(repo: string, runDir: string) {
  const report = buildFhvGrowthLawReportV2({ runDir, repoPath: repo });
  writeFileSync(
    join(runDir, FHV_GROWTH_LAW_REPORT_FILENAME),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

describe("FHV execution-time host and run identity", () => {
  afterEach(() => {
    setFhvThroughputProducerHostIdentityForTests(null);
  });

  it("cannot issue a Host-B qualified receipt over Host-A producer evidence", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    setFhvThroughputProducerHostIdentityForTests(testHost({ hostname: "host-a" }));
    writeOfficialProgress(repo, runDir, boundedPoints());
    writeReport(repo, runDir);
    setFhvThroughputProducerHostIdentityForTests(testHost({ hostname: "host-b" }));
    try {
      qualifyFhvThroughputHost({ runDir, repoPath: repo });
      throw new Error("expected host mismatch");
    } catch (error) {
      expect((error as FhvThroughputProducerBindingError).code).toBe(
        "FHV_THROUGHPUT_PRODUCER_HOST_MISMATCH",
      );
    }
  });

  it("cannot re-label producer Node version A as receipt runtime Node version B", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    setFhvThroughputProducerHostIdentityForTests(testHost({ nodeVersion: "v22.23.0" }));
    writeOfficialProgress(repo, runDir, boundedPoints());
    writeReport(repo, runDir);
    setFhvThroughputProducerHostIdentityForTests(testHost({ nodeVersion: "v22.24.0" }));
    try {
      qualifyFhvThroughputHost({ runDir, repoPath: repo });
      throw new Error("expected runtime mismatch");
    } catch (error) {
      expect((error as FhvThroughputProducerBindingError).code).toBe(
        "FHV_THROUGHPUT_PRODUCER_RUNTIME_MISMATCH",
      );
    }
  });

  it("cannot silently replace producer CPU/arch identity at receipt time", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    setFhvThroughputProducerHostIdentityForTests(
      testHost({ arch: "x64", cpuModel: "Ryzen 9 9950X" }),
    );
    writeOfficialProgress(repo, runDir, boundedPoints());
    writeReport(repo, runDir);
    setFhvThroughputProducerHostIdentityForTests(
      testHost({ arch: "arm64", cpuModel: "Ampere Altra" }),
    );
    try {
      qualifyFhvThroughputHost({ runDir, repoPath: repo });
      throw new Error("expected host mismatch");
    } catch (error) {
      expect((error as FhvThroughputProducerBindingError).code).toBe(
        "FHV_THROUGHPUT_PRODUCER_HOST_MISMATCH",
      );
    }
  });

  it("copies execution-time producer host identity into the receipt", () => {
    const { repo } = makeRepo();
    const runDir = join(repo, "run");
    const host = testHost();
    setFhvThroughputProducerHostIdentityForTests(host);
    const binding = writeOfficialProgress(repo, runDir, boundedPoints());
    writeReport(repo, runDir);
    const receipt = qualifyFhvThroughputHost({ runDir, repoPath: repo });
    expect(receipt.host).toEqual(host);
    expect(receipt.host).toEqual(binding.host);
    expect(receipt.evidence.producerHost).toEqual(binding.host);
    expect(receipt.runId).toBe(binding.runId);
    expect(receipt.evidence.runId).toBe(binding.runId);
    expect(receipt.evidence.runDir).toBe(binding.runDir);
    expect(receipt.evidence.producerBindingDigest).toBe(binding.bindingDigest);
  });

  it("fails closed when producer binding runDir is not the analyzed runDir", () => {
    const { repo } = makeRepo();
    const runA = join(repo, "run-a");
    writeOfficialProgress(repo, runA, boundedPoints());
    const copyRoot = mkdtempSync(join(tmpdir(), "fhv-copied-run-"));
    roots.push(copyRoot);
    const runB = join(copyRoot, "run-b");
    cpSync(runA, runB, { recursive: true });
    try {
      assertFhvThroughputProducerBinding({ runDir: runB });
      throw new Error("expected rundir mismatch");
    } catch (error) {
      expect((error as FhvThroughputProducerBindingError).code).toBe(
        "FHV_THROUGHPUT_PRODUCER_RUNDIR_MISMATCH",
      );
    }
  });

  it("cannot silently relabel run identity by copying an intact evidence tree", () => {
    const { repo } = makeRepo();
    const runA = join(repo, "run-a");
    const binding = writeOfficialProgress(repo, runA, boundedPoints());
    const report = writeReport(repo, runA);
    expect(report.runIdentity.runId).toBe(binding.runId);
    expect(report.runIdentity.runDir).toBe(resolve(runA));
    const copyRoot = mkdtempSync(join(tmpdir(), "fhv-copied-tree-"));
    roots.push(copyRoot);
    const runB = join(copyRoot, "run-b");
    cpSync(runA, runB, { recursive: true });
    try {
      buildFhvGrowthLawReportV2({ runDir: runB, repoPath: repo });
      throw new Error("expected copied rundir rejection");
    } catch (error) {
      expect((error as FhvThroughputProducerBindingError).code).toBe(
        "FHV_THROUGHPUT_PRODUCER_RUNDIR_MISMATCH",
      );
    }
    try {
      qualifyFhvThroughputHost({ runDir: runB, repoPath: repo });
      throw new Error("expected copied rundir qualification rejection");
    } catch (error) {
      expect((error as FhvThroughputProducerBindingError).code).toBe(
        "FHV_THROUGHPUT_PRODUCER_RUNDIR_MISMATCH",
      );
    }
  });
});
