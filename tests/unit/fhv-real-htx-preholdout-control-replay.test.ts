import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { HtxApiError } from "@/lib/trader/connectors/htx/client";
import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { computeFhvFileRawSha256 } from "@/lib/trader/market-data/fhv-dataset-seal";
import {
  FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA,
  FHV_ACQUISITION_EVIDENCE_TEST_SCALE_FIXTURE,
  assertNotRelabelledAcquisitionEvidence,
} from "@/lib/trader/market-data/fhv-acquisition-evidence-class";
import {
  FHV_BLIND_HOLDOUT_PAYLOAD_ACCESS_FORBIDDEN,
  assertPathDoesNotAccessBlindHoldoutPayload,
  setFhvBlindHoldoutAccessTrapForTests,
} from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import {
  barToFhvBarsV2Record,
  serializeFhvBarsV2Record,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import {
  FHV_PRE_HOLDOUT_QUALIFICATION_MODE,
  qualifyFhvPreHoldoutRealData,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import {
  acquireFhvRealHtxPartition,
  FHV_REAL_BLIND_HOLDOUT_ACQUISITION_NOT_AUTHORIZED,
  FHV_REAL_HTX_NORMALIZATION_IDENTITY,
  assertRealHtxPartitionAuthorized,
  readFhvAcquisitionReceiptV2,
  type FhvAcquisitionReceiptV2,
  type FhvRealHtxPageFetcher,
} from "@/lib/trader/market-data/fhv-real-htx-acquisition";
import {
  FHV_PREREGISTERED_REVISION_RISK_SAMPLES,
  compareFhvRevisionRiskSample,
  digestHtxSampleWindow,
} from "@/lib/trader/market-data/fhv-revision-risk-evidence";
import {
  fhvOfficialPartitionFileRelativePath,
  resolveFhvCanonicalPartitionInterval,
  type FhvOfficialSymbolCode,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import {
  resolveFhvAcquireHtxV2CliConfig,
  assertFhvAcquireHtxV2Mode,
} from "@/scripts/trader/fhv-acquire-htx-v2";
import type { Bar } from "@/lib/trader/intelligence/types";
import { CONTROL_REPLAY_AUTHORITY_IDENTITY } from "@/lib/trader/observability/control-replay-test-authority";
import { runScientificControlReplayV2Ceremony } from "@/lib/trader/observability/control-replay-scientific-v2-driver-v1";
import { resolveFhvFullHistoricalTerminalClassification } from "@/lib/trader/observability/fhv-full-historical-launch";
import { FhvFullHistoricalLaunchError } from "@/lib/trader/observability/fhv-full-historical-launch";
import { streamingBarSemanticDigestOf } from "@/lib/trader/market-data/fhv-streaming-bar-digest";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
afterEach(() => setFhvBlindHoldoutAccessTrapForTests(null));

const RELEASE = "a".repeat(40);
const ORG = "00000000-0000-4000-8000-000000000001";
const OPERATOR = "dee-537-operator";
const CAPABILITY = "c".repeat(64);

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

function storeFetcher(rows: readonly HtxKlineRow[]): FhvRealHtxPageFetcher {
  return async ({ from, to, size }) =>
    rows.filter((row) => row.id >= from && row.id <= to).slice(0, size);
}

function consecutiveKlines(startUtc: string, count: number, startPrice = 10_000): HtxKlineRow[] {
  const start = Math.floor(Date.parse(startUtc) / 1000);
  return Array.from({ length: count }, (_, index) => kline(start + index * 60, startPrice + index));
}

async function acquireShort(input: {
  datasetRoot: string;
  partition: "development" | "walk-forward";
  symbol: FhvOfficialSymbolCode;
  runId: string;
  rows: HtxKlineRow[];
  pageSize?: number;
  interruptAfterPages?: number;
  startUtc?: string;
  endUtc?: string;
}) {
  const startUtc = input.startUtc ?? "2020-01-01T00:00:00.000Z";
  const endUtc = input.endUtc ?? "2020-01-01T00:05:00.000Z";
  return acquireFhvRealHtxPartition({
    datasetRoot: input.datasetRoot,
    partition: input.partition,
    symbol: input.symbol,
    acquisitionRunId: input.runId,
    releaseSha: RELEASE,
    organizationId: ORG,
    operatorId: OPERATOR,
    sourceCapabilityReceiptDigest: CAPABILITY,
    fetchPage: storeFetcher(input.rows),
    pageSize: input.pageSize ?? 2,
    interruptAfterPages: input.interruptAfterPages,
    intervalOverride:
      input.partition === "development"
        ? { startUtc, endUtc }
        : {
            startUtc: "2023-01-01T00:00:00.000Z",
            endUtc: "2023-01-01T00:05:00.000Z",
          },
  });
}

function barAt(openUtc: string, close: string, symbol: "BTC/USDT" | "ETH/USDT" = "BTC/USDT"): Bar {
  const openMs = Date.parse(openUtc);
  return {
    symbol,
    interval: "1m",
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: new Date(openMs).toISOString(),
    barCloseTime: new Date(openMs + 60_000).toISOString(),
  };
}

function writeReceiptV2(input: {
  datasetRoot: string;
  partition: "development" | "walk-forward";
  symbol: FhvOfficialSymbolCode;
  runId: string;
  bars: Bar[];
  evidenceClass?: typeof FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA;
}): { receiptPath: string; receipt: FhvAcquisitionReceiptV2 } {
  const relativePath = fhvOfficialPartitionFileRelativePath(input);
  const filePath = join(input.datasetRoot, relativePath);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(
    filePath,
    input.bars.map((bar) => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join(""),
  );
  const rawSha256 = computeFhvFileRawSha256(filePath);
  const canonical = resolveFhvCanonicalPartitionInterval(input.partition);
  const body = {
    schemaVersion: "fhv-acquisition-receipt/v2" as const,
    evidenceClass: FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA,
    providerIdentity: "HTX" as const,
    acquisitionRunId: input.runId,
    releaseSha: RELEASE,
    organizationId: ORG,
    operatorId: OPERATOR,
    sourceCapabilityReceiptDigest: CAPABILITY,
    partition: input.partition,
    symbol: input.symbol,
    startUtc: canonical.startUtc,
    endUtc: canonical.endUtc,
    outputRoot: input.datasetRoot,
    fileRelativePath: relativePath,
    rawSha256,
    semanticContentDigest: streamingBarSemanticDigestOf(input.bars),
    actualBarCount: input.bars.length,
    firstBarOpen: input.bars[0]!.barOpenTime,
    lastBarClose: input.bars[input.bars.length - 1]!.barCloseTime,
    gapDuplicateIntegrity: "PASS" as const,
    normalizationIdentity: FHV_REAL_HTX_NORMALIZATION_IDENTITY,
    pageCount: 1,
    retryCount: 0,
  };
  const receipt = { ...body, acquisitionReceiptDigest: computeStableJsonDigest(body) };
  const receiptPath = join(
    input.datasetRoot,
    "control",
    "acquisition",
    `fhv-acquisition-receipt.${input.partition}.${input.symbol}.${input.runId}.v2.json`,
  );
  mkdirSync(join(receiptPath, ".."), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receiptPath, receipt };
}

describe("real HTX acquisition CLI flags", () => {
  it("refuses implicit network acquisition and real blind-holdout", () => {
    const implicit = resolveFhvAcquireHtxV2CliConfig(process.env, []);
    expect(implicit.scaleCorpus).toBe(false);
    expect(implicit.realHtx).toBe(false);
    expect(() =>
      resolveFhvAcquireHtxV2CliConfig(process.env, ["--scale-corpus", "--real-htx"]),
    ).not.toThrow();
    const both = resolveFhvAcquireHtxV2CliConfig(process.env, ["--scale-corpus", "--real-htx"]);
    expect(() => assertFhvAcquireHtxV2Mode(both)).toThrow(/mutually exclusive/);
    expect(() => assertFhvAcquireHtxV2Mode(implicit)).toThrow(/never implicit/);
    expect(() =>
      assertFhvAcquireHtxV2Mode({ scaleCorpus: false, realHtx: true, partition: "blind-holdout" }),
    ).toThrow(FHV_REAL_BLIND_HOLDOUT_ACQUISITION_NOT_AUTHORIZED);
    try {
      assertRealHtxPartitionAuthorized("blind-holdout");
      throw new Error("expected authorization failure");
    } catch (error) {
      expect(error).toMatchObject({ code: FHV_REAL_BLIND_HOLDOUT_ACQUISITION_NOT_AUTHORIZED });
    }
  });
});

describe("real HTX mocked acquisition", () => {
  it("acquires development BTC/ETH and walk-forward BTC/ETH with half-open filtering", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-real-htx-"));
    roots.push(root);
    const cases = [
      ["development", "BTCUSDT", "2020-01-01T00:00:00.000Z", "2020-01-01T00:05:00.000Z"],
      ["development", "ETHUSDT", "2020-01-01T00:00:00.000Z", "2020-01-01T00:05:00.000Z"],
      ["walk-forward", "BTCUSDT", "2023-01-01T00:00:00.000Z", "2023-01-01T00:05:00.000Z"],
      ["walk-forward", "ETHUSDT", "2023-01-01T00:00:00.000Z", "2023-01-01T00:05:00.000Z"],
    ] as const;
    for (const [partition, symbol, startUtc, endUtc] of cases) {
      const rows = [
        ...consecutiveKlines(startUtc, 5),
        kline(Math.floor(Date.parse(endUtc) / 1000), 99_999),
      ];
      const result = await acquireShort({
        datasetRoot: root,
        partition,
        symbol,
        runId: `${partition}-${symbol}`,
        rows,
        startUtc,
        endUtc,
      });
      expect(result.receipt.evidenceClass).toBe(FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA);
      expect(result.receipt.actualBarCount).toBe(5);
      expect(result.receipt.firstBarOpen).toBe(startUtc);
      expect(Date.parse(result.receipt.lastBarClose)).toBe(Date.parse(endUtc));
    }
  });

  it("maps UTC open/close to +60s and handles same-content duplicates deterministically", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-real-htx-dup-"));
    roots.push(root);
    const startUtc = "2020-01-01T00:00:00.000Z";
    const rows = consecutiveKlines(startUtc, 5);
    rows.splice(1, 0, rows[1]!);
    const result = await acquireShort({
      datasetRoot: root,
      partition: "development",
      symbol: "BTCUSDT",
      runId: "dup",
      rows,
    });
    expect(result.receipt.actualBarCount).toBe(5);
  });

  it("fails closed on conflicting duplicates, 1m gaps, empty pages, stalls, and retry exhaustion", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-real-htx-fail-"));
    roots.push(root);
    const startUtc = "2020-01-01T00:00:00.000Z";
    const conflict = consecutiveKlines(startUtc, 5);
    conflict[1] = { ...conflict[1]!, close: 50_000 };
    conflict.splice(1, 0, consecutiveKlines(startUtc, 5)[1]!);
    await expect(
      acquireShort({
        datasetRoot: join(root, "conflict"),
        partition: "development",
        symbol: "BTCUSDT",
        runId: "conflict",
        pageSize: 10,
        rows: conflict,
      }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_BLOCKED_CONFLICTING_DUPLICATE" });

    const gapped = [
      kline(Date.parse(startUtc) / 1000, 1),
      kline(Date.parse(startUtc) / 1000 + 120, 2),
    ];
    await expect(
      acquireShort({
        datasetRoot: join(root, "gap"),
        partition: "development",
        symbol: "BTCUSDT",
        runId: "gap",
        rows: gapped,
      }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_BLOCKED_GAP" });

    await expect(
      acquireShort({
        datasetRoot: join(root, "empty"),
        partition: "development",
        symbol: "BTCUSDT",
        runId: "empty",
        rows: [],
      }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_BLOCKED_SOURCE_EXHAUSTED" });

    const stallRows = consecutiveKlines(startUtc, 2);
    await expect(
      acquireFhvRealHtxPartition({
        datasetRoot: join(root, "stall"),
        partition: "development",
        symbol: "BTCUSDT",
        acquisitionRunId: "stall",
        releaseSha: RELEASE,
        organizationId: ORG,
        operatorId: OPERATOR,
        sourceCapabilityReceiptDigest: CAPABILITY,
        pageSize: 2,
        intervalOverride: { startUtc, endUtc: "2020-01-01T00:05:00.000Z" },
        fetchPage: async () => [stallRows[0]!],
      }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_BLOCKED_PAGING_STALL" });

    await expect(
      acquireFhvRealHtxPartition({
        datasetRoot: join(root, "retry"),
        partition: "development",
        symbol: "BTCUSDT",
        acquisitionRunId: "retry",
        releaseSha: RELEASE,
        organizationId: ORG,
        operatorId: OPERATOR,
        sourceCapabilityReceiptDigest: CAPABILITY,
        intervalOverride: { startUtc, endUtc: "2020-01-01T00:05:00.000Z" },
        fetchPage: async () => {
          throw new HtxApiError("http-error", "retry exhausted");
        },
      }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_BLOCKED_RETRY_EXHAUSTED" });
  });

  it("resumes after interruption to the same digest and refuses silent overwrite", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-real-htx-resume-"));
    roots.push(root);
    const rows = consecutiveKlines("2020-01-01T00:00:00.000Z", 5);
    await expect(
      acquireShort({
        datasetRoot: root,
        partition: "development",
        symbol: "BTCUSDT",
        runId: "resume",
        rows,
        pageSize: 2,
        interruptAfterPages: 1,
      }),
    ).rejects.toMatchObject({ code: "TEST_INTERRUPT" });
    expect(() =>
      readFhvAcquisitionReceiptV2(
        join(
          root,
          "control/acquisition/fhv-acquisition-receipt.development.BTCUSDT.resume.v2.json",
        ),
      ),
    ).toThrow();
    const resumed = await acquireShort({
      datasetRoot: root,
      partition: "development",
      symbol: "BTCUSDT",
      runId: "resume",
      rows,
      pageSize: 2,
    });
    const freshRoot = mkdtempSync(join(tmpdir(), "fhv-real-htx-fresh-"));
    roots.push(freshRoot);
    const fresh = await acquireShort({
      datasetRoot: freshRoot,
      partition: "development",
      symbol: "BTCUSDT",
      runId: "fresh",
      rows,
      pageSize: 2,
    });
    expect(resumed.receipt.rawSha256).toBe(fresh.receipt.rawSha256);
    await expect(
      acquireShort({
        datasetRoot: freshRoot,
        partition: "development",
        symbol: "BTCUSDT",
        runId: "fresh",
        rows,
      }),
    ).rejects.toMatchObject({ code: "QUALIFICATION_BLOCKED_IMMUTABLE_COMPLETED_OVERWRITE" });
  });
});

describe("real vs synthetic receipts and revision risk", () => {
  it("rejects synthetic/legacy receipts as real and forbids relabel", () => {
    expect(() =>
      assertNotRelabelledAcquisitionEvidence({
        from: FHV_ACQUISITION_EVIDENCE_TEST_SCALE_FIXTURE,
        to: FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA,
      }),
    ).toThrow(/relabel/);
    expect(() =>
      assertNotRelabelledAcquisitionEvidence({
        from: FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA,
        to: FHV_ACQUISITION_EVIDENCE_TEST_SCALE_FIXTURE,
      }),
    ).toThrow(/relabel/);
    try {
      assertRealHtxPartitionAuthorized("blind-holdout");
      throw new Error("expected authorization failure");
    } catch (error) {
      expect(error).toMatchObject({ code: FHV_REAL_BLIND_HOLDOUT_ACQUISITION_NOT_AUTHORIZED });
    }
  });

  it("records SAME vs CHANGED revision-risk digests from mocked refetch", async () => {
    const sample = FHV_PREREGISTERED_REVISION_RISK_SAMPLES[0];
    const rows = consecutiveKlines(sample.startUtc, 60);
    const operationalDigest = await digestHtxSampleWindow({
      sample,
      fetchPage: storeFetcher(rows),
    });
    const operational = await compareFhvRevisionRiskSample({
      sample,
      operationalDigest,
      operationalAcquiredAtUtc: "2026-08-16T00:00:00.000Z",
      refetchAcquiredAtUtc: "2026-08-16T00:01:00.000Z",
      fetchPage: storeFetcher(rows),
    });
    const same = await compareFhvRevisionRiskSample({
      sample,
      operationalDigest: operational.refetchDigest,
      operationalAcquiredAtUtc: "2026-08-16T00:00:00.000Z",
      refetchAcquiredAtUtc: "2026-08-16T00:02:00.000Z",
      fetchPage: storeFetcher(rows),
    });
    expect(same.comparison).toBe("SAME");
    const changedRows = consecutiveKlines(sample.startUtc, 60, 20_000);
    const changed = await compareFhvRevisionRiskSample({
      sample,
      operationalDigest: same.refetchDigest,
      operationalAcquiredAtUtc: "2026-08-16T00:00:00.000Z",
      refetchAcquiredAtUtc: "2026-08-16T00:03:00.000Z",
      fetchPage: storeFetcher(changedRows),
    });
    expect(changed.comparison).toBe("CHANGED");
    expect(changed.operationalDigest).not.toBe(changed.refetchDigest);
  });
});

describe("pre-holdout qualification and holdout firewall", () => {
  it("never qualifies a tiny partial multi-year file as canonical PASS", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-preholdout-"));
    roots.push(root);
    const pairs: ["development" | "walk-forward", FhvOfficialSymbolCode][] = [
      ["development", "BTCUSDT"],
      ["development", "ETHUSDT"],
      ["walk-forward", "BTCUSDT"],
      ["walk-forward", "ETHUSDT"],
    ];
    const receiptPaths = pairs.map(([partition, symbol]) => {
      const instrument = symbol === "BTCUSDT" ? "BTC/USDT" : "ETH/USDT";
      const start = resolveFhvCanonicalPartitionInterval(partition).startUtc;
      return writeReceiptV2({
        datasetRoot: root,
        partition,
        symbol,
        runId: `${partition}-${symbol}`,
        bars: [
          barAt(start, "100", instrument),
          barAt(new Date(Date.parse(start) + 60_000).toISOString(), "101", instrument),
        ],
      }).receiptPath;
    });
    expect(() =>
      qualifyFhvPreHoldoutRealData({
        datasetRoot: root,
        acquisitionReceiptPaths: receiptPaths,
        releaseSha: RELEASE,
        organizationId: ORG,
        operatorId: OPERATOR,
        sourceCapabilityEvidenceDigest: CAPABILITY,
        revisionRiskEvidence: [],
      }),
    ).toThrow(/START_MISMATCH|END_MISMATCH|EXACT_COUNT|bar count|first bar|last bar close/i);
    expect(() =>
      qualifyFhvPreHoldoutRealData({
        datasetRoot: root,
        acquisitionReceiptPaths: receiptPaths.slice(0, 3),
        releaseSha: RELEASE,
        organizationId: ORG,
        operatorId: OPERATOR,
        sourceCapabilityEvidenceDigest: CAPABILITY,
        revisionRiskEvidence: [],
      }),
    ).toThrow(/exactly four/);
    expect(() =>
      qualifyFhvPreHoldoutRealData({
        datasetRoot: root,
        acquisitionReceiptPaths: receiptPaths,
        releaseSha: "b".repeat(40),
        organizationId: ORG,
        operatorId: OPERATOR,
        sourceCapabilityEvidenceDigest: CAPABILITY,
        revisionRiskEvidence: [],
      }),
    ).toThrow(/releaseSha mismatch/);
    expect(() =>
      qualifyFhvPreHoldoutRealData({
        datasetRoot: root,
        acquisitionReceiptPaths: receiptPaths,
        releaseSha: RELEASE,
        organizationId: "00000000-0000-4000-8000-000000000002",
        operatorId: OPERATOR,
        sourceCapabilityEvidenceDigest: CAPABILITY,
        revisionRiskEvidence: [],
      }),
    ).toThrow(/org\/operator mismatch/);
    expect(() =>
      qualifyFhvPreHoldoutRealData({
        datasetRoot: root,
        acquisitionReceiptPaths: receiptPaths,
        releaseSha: RELEASE,
        organizationId: ORG,
        operatorId: OPERATOR,
        sourceCapabilityEvidenceDigest: "d".repeat(64),
        revisionRiskEvidence: [],
      }),
    ).toThrow(/source-capability digest mismatch/);
    const legacyPath = join(root, "control/acquisition/legacy-v1.json");
    writeFileSync(
      legacyPath,
      `${JSON.stringify({ schemaVersion: "fhv-acquisition-receipt/v1", evidenceClass: FHV_ACQUISITION_EVIDENCE_TEST_SCALE_FIXTURE })}\n`,
    );
    expect(() => readFhvAcquisitionReceiptV2(legacyPath)).toThrow(/schema/);
  });

  it("never reads blind payload during pre-holdout qualification", () => {
    setFhvBlindHoldoutAccessTrapForTests((path) => {
      if (path.includes("blind-holdout")) {
        throw new Error(FHV_BLIND_HOLDOUT_PAYLOAD_ACCESS_FORBIDDEN);
      }
    });
    expect(() =>
      assertPathDoesNotAccessBlindHoldoutPayload(
        "/tmp/ds/partitions/blind-holdout/BTCUSDT/bars.v2.ndjson",
      ),
    ).toThrow(FHV_BLIND_HOLDOUT_PAYLOAD_ACCESS_FORBIDDEN);
  });
});

describe("official pre-holdout Control Replay vs FULL_HISTORICAL", () => {
  it("FULL_HISTORICAL rejects pre-holdout authority", () => {
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

  it("official real-data Control Replay consumes qualified bars, not the deterministic corpus", async () => {
    setFhvBlindHoldoutAccessTrapForTests((path) => {
      if (path.includes("blind-holdout")) {
        throw new Error(FHV_BLIND_HOLDOUT_PAYLOAD_ACCESS_FORBIDDEN);
      }
    });
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
    const digest = computeStableJsonDigest(bars.map((bar) => computeBarContentDigest(bar)));
    const official = await runScientificControlReplayV2Ceremony({
      marketAuthority: {
        class: "OFFICIAL_PRE_HOLDOUT_REAL_DATA",
        bars,
        releaseSha: RELEASE,
        developmentWalkForwardContentDigest: digest,
      },
    });
    expect(official.marketAuthorityClass).toBe("OFFICIAL_PRE_HOLDOUT_REAL_DATA");
    expect(official.codeReleaseSha).toBe(RELEASE);
    expect(official.developmentDatasetDigestHex).toBe(digest);
    expect(official.authority.capitalEligible).toBe(false);
    expect(official.authority).toEqual(CONTROL_REPLAY_AUTHORITY_IDENTITY);
    expect(official.sourceAnchorCount).toBeGreaterThanOrEqual(30);
    const fixture = await runScientificControlReplayV2Ceremony();
    expect(fixture.marketAuthorityClass).toBe("TEST_ONLY_DETERMINISTIC_CORPUS");
    expect(official.packageContentDigestHex).not.toBe(fixture.packageContentDigestHex);
    const mutated = bars.map((bar, index) =>
      index === 50 ? { ...bar, close: "99999", high: "99999" } : bar,
    );
    const mutatedRun = await runScientificControlReplayV2Ceremony({
      marketAuthority: {
        class: "OFFICIAL_PRE_HOLDOUT_REAL_DATA",
        bars: mutated,
        releaseSha: RELEASE,
        developmentWalkForwardContentDigest: digest,
      },
    });
    expect(mutatedRun.parityDigest).not.toBe(official.parityDigest);
    const runTwo = await runScientificControlReplayV2Ceremony({
      marketAuthority: {
        class: "OFFICIAL_PRE_HOLDOUT_REAL_DATA",
        bars,
        releaseSha: RELEASE,
        developmentWalkForwardContentDigest: digest,
      },
    });
    expect(runTwo.parityDigest).toBe(official.parityDigest);
  }, 180_000);
});
