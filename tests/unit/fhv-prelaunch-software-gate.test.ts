import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  FHV_CANONICAL_ONE_MINUTE_BAR_COUNTS,
  FhvCanonicalCoverageError,
  proveFhvNdjsonIntervalCoverage,
} from "@/lib/trader/market-data/fhv-canonical-coverage";
import {
  barToFhvBarsV2Record,
  serializeFhvBarsV2Record,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { committedByteLengthOf } from "@/lib/trader/market-data/fhv-ndjson-bounded-io";
import {
  acquireFhvRealHtxPartition,
  fhvRealHtxCursorPath,
  type FhvRealHtxPageFetcher,
} from "@/lib/trader/market-data/fhv-real-htx-acquisition";
import {
  assertCompletePreregisteredRevisionRiskEvidence,
  compareFhvRevisionRiskSample,
  digestHtxSampleWindow,
  digestOperationalRevisionRiskFromAcquiredFile,
  FHV_PREREGISTERED_REVISION_RISK_SAMPLES,
  FhvRevisionRiskError,
} from "@/lib/trader/market-data/fhv-revision-risk-evidence";
import {
  assertNoTypedDatasetDigestSubstitution,
  FhvPreHoldoutQualificationError,
  qualifyFhvPreHoldoutRealData,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import type { Bar } from "@/lib/trader/intelligence/types";
import { FHV_SCIENTIFIC_PARTITIONS_V1 } from "@/lib/trader/observability/fhv-partition-receipt";
import { assertPreHoldoutNotFullHistorical } from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import { FHV_PRE_HOLDOUT_QUALIFICATION_MODE } from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import { resolveFhvFullHistoricalTerminalClassification } from "@/lib/trader/observability/fhv-full-historical-launch";
import { FhvFullHistoricalLaunchError } from "@/lib/trader/observability/fhv-full-historical-launch";
import {
  DEE_594_DOWNSTREAM_PREREQUISITE_STATUS,
  runChronologicalControlReplayV2,
} from "@/lib/trader/observability/control-replay-chronological-v2-driver-v1";
import { CONTROL_REPLAY_AUTHORITY_IDENTITY } from "@/lib/trader/observability/control-replay-test-authority";
import { makeWp17QualifiedHtxVolumeAuthority } from "@/tests/unit/helpers/wp17-execution-fixtures";
import { resolveFhvOperatorStatusPath } from "@/lib/trader/observability/fhv-status-writer";
import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import { fhvOfficialPartitionFileRelativePath } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { resolveFhvRevisionRiskCliConfig } from "@/scripts/trader/fhv-revision-risk-cli";
import { resolveFhvPreHoldoutQualifyCliConfig } from "@/scripts/trader/fhv-pre-holdout-qualify-cli";
import { resolveFhvPreHoldoutVerifyCliConfig } from "@/scripts/trader/fhv-pre-holdout-verify-cli";
import { resolveFhvHostQualifyCliConfig } from "@/scripts/trader/fhv-host-qualify-cli";
import { resolveFhvRealHtxPreflightCliConfig } from "@/scripts/trader/fhv-real-htx-preflight-cli";
import { assertOfficialControlReplayDoesNotUseWholeCorpusLoader } from "@/lib/trader/market-data/fhv-bounded-bar-stream";
import { runPrelaunchPublicEntrypointFixture } from "@/lib/trader/observability/fhv-prelaunch-fixture-e2e";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const RELEASE = "a".repeat(40);
const ORG = "00000000-0000-4000-8000-000000000001";
const OPERATOR = "dee-537-operator";
const CAPABILITY = "c".repeat(64);

function barAt(openUtc: string, close: string, symbol: "BTC/USDT" | "ETH/USDT" = "BTC/USDT"): Bar {
  const openMs = Date.parse(openUtc);
  return {
    symbol,
    interval: "1m",
    open: close,
    high: close,
    low: close,
    close,
    volume: "100",
    barOpenTime: new Date(openMs).toISOString(),
    barCloseTime: new Date(openMs + 60_000).toISOString(),
  };
}

function consecutiveBars(
  startUtc: string,
  count: number,
  symbol: "BTC/USDT" | "ETH/USDT" = "BTC/USDT",
): Bar[] {
  const start = Date.parse(startUtc);
  return Array.from({ length: count }, (_, index) =>
    barAt(new Date(start + index * 60_000).toISOString(), String(10_000 + index), symbol),
  );
}

function writeBars(filePath: string, bars: readonly Bar[]): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(
    filePath,
    bars.map((bar) => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join(""),
  );
}

function kline(openSeconds: number, close: number): HtxKlineRow {
  return {
    id: openSeconds,
    open: close,
    close,
    low: close - 1,
    high: close + 1,
    amount: 1,
    vol: 2,
    count: 1,
  };
}

describe("canonical coverage proofs", () => {
  it("uses independent scientific 1m counts and fails closed on partial windows", () => {
    expect(FHV_CANONICAL_ONE_MINUTE_BAR_COUNTS.DEVELOPMENT).toBe(1_578_240);
    expect(FHV_CANONICAL_ONE_MINUTE_BAR_COUNTS.WF_PREDICTIVE).toBe(525_600);
    expect(FHV_CANONICAL_ONE_MINUTE_BAR_COUNTS.WF_ECONOMIC).toBe(527_040);
    expect(FHV_CANONICAL_ONE_MINUTE_BAR_COUNTS.WALK_FORWARD_UNION).toBe(1_052_640);
    expect(FHV_SCIENTIFIC_PARTITIONS_V1.WF_PREDICTIVE.endUtc).toBe(
      FHV_SCIENTIFIC_PARTITIONS_V1.WF_ECONOMIC.startUtc,
    );
    const root = mkdtempSync(join(tmpdir(), "fhv-cov-"));
    roots.push(root);
    const start = "2020-01-01T00:00:00.000Z";
    const filePath = join(root, "bars.v2.ndjson");
    writeBars(filePath, consecutiveBars(start, 5));
    const proof = proveFhvNdjsonIntervalCoverage({
      filePath,
      expectedStartUtc: start,
      expectedEndUtc: "2020-01-01T00:05:00.000Z",
      expectedSymbol: "BTC/USDT",
    });
    expect(proof.barCount).toBe(5);
    expect(proof.gapDuplicateIntegrity).toBe("PASS");

    writeBars(filePath, consecutiveBars("2020-01-01T00:01:00.000Z", 4));
    expect(() =>
      proveFhvNdjsonIntervalCoverage({
        filePath,
        expectedStartUtc: start,
        expectedEndUtc: "2020-01-01T00:05:00.000Z",
        expectedSymbol: "BTC/USDT",
      }),
    ).toThrow(FhvCanonicalCoverageError);

    const missingInternal = [
      ...consecutiveBars(start, 2),
      ...consecutiveBars("2020-01-01T00:03:00.000Z", 2),
    ];
    writeBars(filePath, missingInternal);
    try {
      proveFhvNdjsonIntervalCoverage({
        filePath,
        expectedStartUtc: start,
        expectedEndUtc: "2020-01-01T00:05:00.000Z",
        expectedSymbol: "BTC/USDT",
      });
      throw new Error("expected coverage failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "INTERNAL_GAP" });
    }

    writeBars(filePath, consecutiveBars(start, 4));
    try {
      proveFhvNdjsonIntervalCoverage({
        filePath,
        expectedStartUtc: start,
        expectedEndUtc: "2020-01-01T00:05:00.000Z",
        expectedSymbol: "BTC/USDT",
      });
      throw new Error("expected coverage failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "END_MISMATCH" });
    }

    const duped = consecutiveBars(start, 5);
    writeBars(filePath, [...duped.slice(0, 2), duped[1]!, ...duped.slice(2)]);
    try {
      proveFhvNdjsonIntervalCoverage({
        filePath,
        expectedStartUtc: start,
        expectedEndUtc: "2020-01-01T00:05:00.000Z",
        expectedSymbol: "BTC/USDT",
      });
      throw new Error("expected coverage failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "DUPLICATE" });
    }
  });

  it("keeps WF_PREDICTIVE and WF_ECONOMIC digests independent", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-wf-split-"));
    roots.push(root);
    const filePath = join(root, "wf.ndjson");
    const predictive = consecutiveBars("2023-12-31T23:58:00.000Z", 2);
    const economic = consecutiveBars("2024-01-01T00:00:00.000Z", 3);
    writeBars(filePath, [...predictive, ...economic]);
    const pred = proveFhvNdjsonIntervalCoverage({
      filePath,
      expectedStartUtc: "2023-12-31T23:58:00.000Z",
      expectedEndUtc: "2024-01-01T00:00:00.000Z",
      expectedSymbol: "BTC/USDT",
      hashWholeFile: false,
    });
    const econ = proveFhvNdjsonIntervalCoverage({
      filePath,
      expectedStartUtc: "2024-01-01T00:00:00.000Z",
      expectedEndUtc: "2024-01-01T00:03:00.000Z",
      expectedSymbol: "BTC/USDT",
      hashWholeFile: false,
    });
    expect(pred.semanticContentDigest).not.toBe(econ.semanticContentDigest);
    const mutatedPred = [{ ...predictive[0]!, close: "99999", high: "99999" }, predictive[1]!];
    writeBars(filePath, [...mutatedPred, ...economic]);
    const pred2 = proveFhvNdjsonIntervalCoverage({
      filePath,
      expectedStartUtc: "2023-12-31T23:58:00.000Z",
      expectedEndUtc: "2024-01-01T00:00:00.000Z",
      expectedSymbol: "BTC/USDT",
      hashWholeFile: false,
    });
    const econ2 = proveFhvNdjsonIntervalCoverage({
      filePath,
      expectedStartUtc: "2024-01-01T00:00:00.000Z",
      expectedEndUtc: "2024-01-01T00:03:00.000Z",
      expectedSymbol: "BTC/USDT",
      hashWholeFile: false,
    });
    expect(pred2.semanticContentDigest).not.toBe(pred.semanticContentDigest);
    expect(econ2.semanticContentDigest).toBe(econ.semanticContentDigest);
    writeBars(filePath, [
      ...predictive,
      { ...economic[0]!, close: "88888", high: "88888" },
      ...economic.slice(1),
    ]);
    const econ3 = proveFhvNdjsonIntervalCoverage({
      filePath,
      expectedStartUtc: "2024-01-01T00:00:00.000Z",
      expectedEndUtc: "2024-01-01T00:03:00.000Z",
      expectedSymbol: "BTC/USDT",
      hashWholeFile: false,
    });
    expect(econ3.semanticContentDigest).not.toBe(econ.semanticContentDigest);
  });
});

describe("bounded-memory acquisition pages and resume boundary", () => {
  it("canonicalizes unordered provider pages and records committedByteLength", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-page-"));
    roots.push(root);
    const startUtc = "2020-01-01T00:00:00.000Z";
    const endUtc = "2020-01-01T00:05:00.000Z";
    const start = Math.floor(Date.parse(startUtc) / 1000);
    const rows = [4, 3, 2, 1, 0].map((index) => kline(start + index * 60, 10_000 + index));
    const fetchPage: FhvRealHtxPageFetcher = async () => rows;
    const acquired = await acquireFhvRealHtxPartition({
      datasetRoot: root,
      partition: "development",
      symbol: "BTCUSDT",
      acquisitionRunId: "unordered",
      releaseSha: RELEASE,
      organizationId: ORG,
      operatorId: OPERATOR,
      sourceCapabilityReceiptDigest: CAPABILITY,
      fetchPage,
      pageSize: 10,
      intervalOverride: { startUtc, endUtc },
    });
    expect(acquired.receipt.firstBarOpen).toBe(startUtc);
    expect(acquired.receipt.actualBarCount).toBe(5);
    const cursorPath = fhvRealHtxCursorPath({
      datasetRoot: root,
      partition: "development",
      symbol: "BTCUSDT",
      acquisitionRunId: "unordered",
    });
    const cursor = JSON.parse(readFileSync(cursorPath, "utf8")) as { committedByteLength: number };
    expect(cursor.committedByteLength).toBeGreaterThan(0);
    expect(cursor.committedByteLength).toBe(
      committedByteLengthOf(
        join(
          root,
          fhvOfficialPartitionFileRelativePath({ partition: "development", symbol: "BTCUSDT" }),
        ),
      ),
    );
  });
});

describe("mandatory revision-risk evidence", () => {
  it("rejects empty and forged operational digests and accepts the complete set", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-rev-"));
    roots.push(root);
    try {
      assertCompletePreregisteredRevisionRiskEvidence({ datasetRoot: root, evidence: [] });
      throw new Error("expected empty rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "REVISION_RISK_EVIDENCE_EMPTY" });
    }
    const sample = FHV_PREREGISTERED_REVISION_RISK_SAMPLES[0];
    const wf = FHV_PREREGISTERED_REVISION_RISK_SAMPLES[1];
    const { mapHtxKlinesToBars } = await import("@/lib/trader/market-data/htx-kline-mapper");
    const sampleRows = Array.from({ length: 60 }, (_, index) =>
      kline(Math.floor(Date.parse(sample.startUtc) / 1000) + index * 60, 10_000 + index),
    );
    const wfRows = Array.from({ length: 60 }, (_, index) =>
      kline(Math.floor(Date.parse(wf.startUtc) / 1000) + index * 60, 10_000 + index),
    );
    writeBars(
      join(
        root,
        fhvOfficialPartitionFileRelativePath({
          partition: sample.partition,
          symbol: sample.symbol,
        }),
      ),
      mapHtxKlinesToBars("BTC/USDT", sampleRows, "1m"),
    );
    writeBars(
      join(
        root,
        fhvOfficialPartitionFileRelativePath({ partition: wf.partition, symbol: wf.symbol }),
      ),
      mapHtxKlinesToBars("ETH/USDT", wfRows, "1m"),
    );
    try {
      assertCompletePreregisteredRevisionRiskEvidence({
        datasetRoot: root,
        evidence: [
          {
            schemaVersion: "fhv-revision-risk-evidence/v1",
            sampleId: sample.sampleId,
            partition: sample.partition,
            scientificPartition: sample.scientificPartition,
            symbol: sample.symbol,
            startUtc: sample.startUtc,
            endUtc: sample.endUtc,
            operationalDigest: "a".repeat(64),
            refetchDigest: "b".repeat(64),
            operationalAcquiredAtUtc: "2026-08-16T00:00:00.000Z",
            refetchAcquiredAtUtc: "2026-08-16T00:01:00.000Z",
            comparison: "SAME",
          },
        ],
      });
      throw new Error("expected forged rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvRevisionRiskError);
    }
    const operationalDigest = digestOperationalRevisionRiskFromAcquiredFile({
      datasetRoot: root,
      sample,
    });
    const refetchSame = await compareFhvRevisionRiskSample({
      sample,
      operationalDigest,
      operationalAcquiredAtUtc: "2026-08-16T00:00:00.000Z",
      refetchAcquiredAtUtc: "2026-08-16T00:01:00.000Z",
      fetchPage: async ({ from, to, size }) =>
        sampleRows.filter((row) => row.id >= from && row.id <= to).slice(0, size),
    });
    const wfOperational = digestOperationalRevisionRiskFromAcquiredFile({
      datasetRoot: root,
      sample: wf,
    });
    const wfEvidence = await compareFhvRevisionRiskSample({
      sample: wf,
      operationalDigest: wfOperational,
      operationalAcquiredAtUtc: "2026-08-16T00:00:00.000Z",
      refetchAcquiredAtUtc: "2026-08-16T00:01:00.000Z",
      fetchPage: async ({ from, to, size }) =>
        wfRows.filter((row) => row.id >= from && row.id <= to).slice(0, size),
    });
    expect(
      assertCompletePreregisteredRevisionRiskEvidence({
        datasetRoot: root,
        evidence: [refetchSame, wfEvidence],
      }),
    ).toBe("SAME");
    const changed = await compareFhvRevisionRiskSample({
      sample,
      operationalDigest,
      operationalAcquiredAtUtc: "2026-08-16T00:00:00.000Z",
      refetchAcquiredAtUtc: "2026-08-16T00:02:00.000Z",
      fetchPage: async () => sampleRows.map((row) => ({ ...row, close: row.close + 50 })),
    });
    expect(changed.comparison).toBe("CHANGED");
    expect(
      assertCompletePreregisteredRevisionRiskEvidence({
        datasetRoot: root,
        evidence: [changed, wfEvidence],
      }),
    ).toBe("HUMAN_DECISION_REQUIRED");
    try {
      assertCompletePreregisteredRevisionRiskEvidence({
        datasetRoot: root,
        evidence: [
          { ...refetchSame, comparison: "SAME", refetchDigest: "f".repeat(64) },
          wfEvidence,
        ],
      });
      throw new Error("expected forged SAME rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "REVISION_RISK_COMPARISON_FORGED_SAME" });
    }
    const forwardDigest = await digestHtxSampleWindow({
      sample,
      fetchPage: async () => sampleRows,
    });
    const reverseDigest = await digestHtxSampleWindow({
      sample,
      fetchPage: async () => [...sampleRows].reverse(),
    });
    expect(reverseDigest).toBe(forwardDigest);
    try {
      await digestHtxSampleWindow({
        sample,
        fetchPage: async () => [sampleRows[0]!, sampleRows[5]!],
      });
      throw new Error("expected gapped refetch rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "REVISION_RISK_REFETCH_INTEGRITY_BLOCKED_GAP" });
    }
    expect(() =>
      qualifyFhvPreHoldoutRealData({
        datasetRoot: root,
        acquisitionReceiptPaths: [],
        releaseSha: RELEASE,
        organizationId: ORG,
        operatorId: OPERATOR,
        sourceCapabilityEvidenceDigest: CAPABILITY,
        revisionRiskEvidence: [],
      }),
    ).toThrow(/exactly four|REVISION_RISK_EVIDENCE_EMPTY/);
  });
});

describe("operator CLIs exist", () => {
  it("requires explicit identity arguments", () => {
    expect(resolveFhvRevisionRiskCliConfig(process.env, ["--real-htx"]).realHtx).toBe(true);
    expect(
      resolveFhvPreHoldoutQualifyCliConfig(process.env, ["--out-dir", "/tmp/out"]).outDir,
    ).toBe("/tmp/out");
    expect(
      resolveFhvPreHoldoutVerifyCliConfig(process.env, ["--receipt", "/tmp/r.json"]).receipt,
    ).toBe("/tmp/r.json");
    expect(
      resolveFhvHostQualifyCliConfig(process.env, [
        "--release-sha",
        "a".repeat(40),
        "--wp3b-receipt",
        "/tmp/wp3b.json",
        "--throughput-receipt",
        "/tmp/tp.json",
        "--t4-preflight",
        "/tmp/t4.json",
        "--out",
        "/tmp/host.json",
      ]).out,
    ).toBe("/tmp/host.json");
    expect(resolveFhvRealHtxPreflightCliConfig(["--fixture"]).fixture).toBe(true);
  });
});

describe("downstream fixture compatibility and DEE-594", () => {
  it("keeps PRE_HOLDOUT from authorizing FULL_HISTORICAL and does not satisfy DEE-594", () => {
    expect(DEE_594_DOWNSTREAM_PREREQUISITE_STATUS).toBe("NOT_SATISFIED_BY_DEE_537");
    expect(() => assertPreHoldoutNotFullHistorical(FHV_PRE_HOLDOUT_QUALIFICATION_MODE)).toThrow(
      /FULL_HISTORICAL/,
    );
    expect(() =>
      resolveFhvFullHistoricalTerminalClassification({
        qualificationReceipt: {
          schemaVersion: "fhv-dataset-qualification-receipt/v1",
          classification: "DATASET_QUALIFICATION=PASS",
          qualificationMode: FHV_PRE_HOLDOUT_QUALIFICATION_MODE,
          datasetRoot: "/tmp",
          manifestPath: "/tmp/pre.json",
          datasetContentDigest: "d".repeat(64),
          manifestSemanticDigest: "e".repeat(64),
          partitionsDigest: "f".repeat(64),
          gapPolicyId: "gap",
          qualifiedAtUtc: "2026-08-16T00:00:00.000Z",
          qualificationReceiptDigest: "1".repeat(64),
        },
      }),
    ).toThrow(FhvFullHistoricalLaunchError);
  });
});

describe("chronological V2 Control Replay", () => {
  it("walks historical time with observer, parity, checkpoint resume, and TEST_ONLY capital", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-chrono-"));
    roots.push(root);
    const bars: Bar[] = [];
    let close = 10_000;
    for (let index = 0; index < 400; index += 1) {
      const ret = 0.001 + (index % 12) * 0.00035;
      close *= Math.exp(ret);
      bars.push(
        barAt(
          new Date(Date.parse("2020-01-01T00:00:00.000Z") + index * 60_000).toISOString(),
          close.toFixed(8),
        ),
      );
    }
    const eth = bars.map((bar) => ({
      ...bar,
      symbol: "ETH/USDT" as const,
      close: (Number(bar.close) / 15).toFixed(8),
    }));
    const volumeBtc = makeWp17QualifiedHtxVolumeAuthority(bars[0]!);
    const volumeEth = makeWp17QualifiedHtxVolumeAuthority(eth[0]!);
    const runOne = await runChronologicalControlReplayV2({
      runId: "run-one",
      runDir: join(root, "run-one"),
      organizationId: ORG,
      releaseSha: RELEASE,
      developmentContentDigest: "c".repeat(64),
      developmentWalkForwardContentDigest: "d".repeat(64),
      executionBars: [...bars, ...eth],
      htxVolumeAuthorityByInstrument: {
        BTCUSDT: volumeBtc.htxVolumeAuthorityReceipt,
        ETHUSDT: volumeEth.htxVolumeAuthorityReceipt,
      },
      maxCycles: 40,
      checkpointEveryCycles: 10,
    });
    expect(runOne.capitalEligible).toBe(false);
    expect(runOne.authority).toEqual(CONTROL_REPLAY_AUTHORITY_IDENTITY);
    expect(runOne.cycleCount).toBe(40);
    expect(runOne.executionScope).toBe("PRE_HOLDOUT_SHARED_PORTFOLIO");
    expect(runOne.dee594Status).toBe("NOT_SATISFIED_BY_DEE_537");
    const status = JSON.parse(
      readFileSync(resolveFhvOperatorStatusPath(join(root, "run-one")), "utf8"),
    );
    expect(status.campaign.barsProcessed).toBe(40);
    expect(status.campaign.phase).toBe("CONTROL_REPLAY");
    expect(status.tradingSimulation.cash).toBe(runOne.cash);
    expect(status.tradingSimulation.guardianState).toBeTruthy();

    const runTwo = await runChronologicalControlReplayV2({
      runId: "run-two",
      runDir: join(root, "run-two"),
      organizationId: ORG,
      releaseSha: RELEASE,
      developmentContentDigest: "c".repeat(64),
      developmentWalkForwardContentDigest: "d".repeat(64),
      executionBars: [...bars, ...eth],
      htxVolumeAuthorityByInstrument: {
        BTCUSDT: volumeBtc.htxVolumeAuthorityReceipt,
        ETHUSDT: volumeEth.htxVolumeAuthorityReceipt,
      },
      maxCycles: 40,
      checkpointEveryCycles: 10,
    });
    expect(runTwo.normalizedParityDigest).toBe(runOne.normalizedParityDigest);
    expect(runTwo.runId).not.toBe(runOne.runId);

    const resumeDir = join(root, "resume");
    const interrupted = await runChronologicalControlReplayV2({
      runId: "resume",
      runDir: resumeDir,
      organizationId: ORG,
      releaseSha: RELEASE,
      developmentContentDigest: "c".repeat(64),
      developmentWalkForwardContentDigest: "d".repeat(64),
      executionBars: [...bars, ...eth],
      htxVolumeAuthorityByInstrument: {
        BTCUSDT: volumeBtc.htxVolumeAuthorityReceipt,
        ETHUSDT: volumeEth.htxVolumeAuthorityReceipt,
      },
      interruptAfterCycles: 20,
      checkpointEveryCycles: 10,
    });
    expect(interrupted.interrupted).toBe(true);
    expect(interrupted.cycleCount).toBe(20);
    const interruptedStatus = JSON.parse(
      readFileSync(resolveFhvOperatorStatusPath(resumeDir), "utf8"),
    );
    expect(interruptedStatus.campaign.terminalState).not.toBe("COMPLETED");
    const resumed = await runChronologicalControlReplayV2({
      runId: "resume",
      runDir: resumeDir,
      organizationId: ORG,
      releaseSha: RELEASE,
      developmentContentDigest: "c".repeat(64),
      developmentWalkForwardContentDigest: "d".repeat(64),
      executionBars: [...bars, ...eth],
      htxVolumeAuthorityByInstrument: {
        BTCUSDT: volumeBtc.htxVolumeAuthorityReceipt,
        ETHUSDT: volumeEth.htxVolumeAuthorityReceipt,
      },
      maxCycles: 40,
      checkpointEveryCycles: 10,
      resumeFromCheckpoint: true,
    });
    expect(resumed.interrupted).toBe(false);
    expect(resumed.normalizedParityDigest).toBe(runOne.normalizedParityDigest);

    const mutated = bars.map((bar, index) =>
      index === 5 ? { ...bar, close: "99999", high: "99999" } : bar,
    );
    const mutatedRun = await runChronologicalControlReplayV2({
      runId: "mutated",
      runDir: join(root, "mutated"),
      organizationId: ORG,
      releaseSha: RELEASE,
      developmentContentDigest: "c".repeat(64),
      developmentWalkForwardContentDigest: "d".repeat(64),
      executionBars: [...mutated, ...eth],
      htxVolumeAuthorityByInstrument: {
        BTCUSDT: volumeBtc.htxVolumeAuthorityReceipt,
        ETHUSDT: volumeEth.htxVolumeAuthorityReceipt,
      },
      maxCycles: 40,
    });
    expect(mutatedRun.normalizedParityDigest).not.toBe(runOne.normalizedParityDigest);
    expect(runOne.normalizedParityDigest).toHaveLength(64);
    await expect(
      runChronologicalControlReplayV2({
        runId: "substituted",
        runDir: join(root, "substituted"),
        organizationId: ORG,
        releaseSha: RELEASE,
        developmentContentDigest: "d".repeat(64),
        developmentWalkForwardContentDigest: "d".repeat(64),
        executionBars: bars.slice(0, 40),
        htxVolumeAuthorityByInstrument: {
          BTCUSDT: volumeBtc.htxVolumeAuthorityReceipt,
          ETHUSDT: volumeEth.htxVolumeAuthorityReceipt,
        },
        maxCycles: 5,
      }),
    ).rejects.toThrow(/TYPED_DATASET_IDENTITY_SUBSTITUTION/);
    const vetoed = await runChronologicalControlReplayV2({
      runId: "veto",
      runDir: join(root, "veto"),
      organizationId: ORG,
      releaseSha: RELEASE,
      developmentContentDigest: "c".repeat(64),
      developmentWalkForwardContentDigest: "d".repeat(64),
      executionBars: [...bars.slice(0, 30), ...eth.slice(0, 30)],
      htxVolumeAuthorityByInstrument: {
        BTCUSDT: volumeBtc.htxVolumeAuthorityReceipt,
        ETHUSDT: volumeEth.htxVolumeAuthorityReceipt,
      },
      maxCycles: 20,
      riskScenario: "veto",
    });
    expect(vetoed.orderCount).toBe(0);
  }, 180_000);
});

describe("typed dataset identity substitution", () => {
  it("rejects combined digest in DEVELOPMENT-only or WF swap slots", () => {
    expect(() =>
      assertNoTypedDatasetDigestSubstitution({
        developmentContentDigest: "a".repeat(64),
        wfPredictiveContentDigest: "b".repeat(64),
        wfEconomicContentDigest: "c".repeat(64),
        developmentWalkForwardContentDigest: "a".repeat(64),
        walkForwardUnionCompatibilityDigest: "e".repeat(64),
      }),
    ).toThrow(FhvPreHoldoutQualificationError);
  });
});

describe("official Control Replay bounded entry", () => {
  it("does not call the whole-corpus loader", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/trader/observability/fhv-control-replay-execution.ts"),
      "utf8",
    );
    expect(() => assertOfficialControlReplayDoesNotUseWholeCorpusLoader(source)).not.toThrow();
  });
});

describe("prelaunch fixture public entrypoints", () => {
  it("emits PRELAUNCH_FIXTURE_END_TO_END=PASS", async () => {
    await expect(runPrelaunchPublicEntrypointFixture()).resolves.toBe(
      "PRELAUNCH_FIXTURE_END_TO_END=PASS",
    );
  });
});
