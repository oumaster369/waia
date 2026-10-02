import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Bar } from "@/lib/trader/intelligence/types";
import { barToFhvBarsV2Record, serializeFhvBarsV2Record } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import {
  FHV_PRE_HOLDOUT_HOLDOUT_STATUS,
  FHV_PRE_HOLDOUT_QUALIFICATION_MODE,
  FHV_PRE_HOLDOUT_QUALIFICATION_SCHEMA,
  type FhvPreHoldoutQualificationReceiptV1,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import {
  FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA,
  type FhvPreHoldoutRuntimeRequalificationV1,
} from "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";
import { fhvOfficialPartitionFileRelativePath } from
  "@/lib/trader/market-data/fhv-partition-boundaries";
import {
  qualifyHtxKlineVolumeAuthority,
  type HtxVolumeQualificationReceiptV1,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { computePayloadDigest } from
  "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

const DEFAULT_ORGANIZATION_ID = "3c50b4e9-1138-43a5-a29f-e65088124cfc";
const DEFAULT_RELEASE_SHA = "d".repeat(40);
const DEVELOPMENT_START_MS = Date.parse("2020-01-01T00:00:00.000Z");
const ONE_MINUTE_MS = 60_000;

export type ResearchDevelopmentSourceFixtureV1 = Readonly<{
  rootDir: string;
  datasetRoot: string;
  qualificationReceiptPath: string;
  runtimeRequalificationReceiptPath: string;
  htxVolumeQualificationReceiptPath: string;
  releaseSha: string;
  organizationId: string;
  rawBytes: Buffer;
  bars: readonly Bar[];
  qualificationReceipt: FhvPreHoldoutQualificationReceiptV1;
  volumeQualificationReceipt: HtxVolumeQualificationReceiptV1;
  runtimeRequalificationReceipt: FhvPreHoldoutRuntimeRequalificationV1 | null;
  cleanup(): void;
}>;

/**
 * Compact fixture for the official-layout DEVELOPMENT loader. The self-digested
 * upstream receipt is synthetic test scaffolding, not source provenance or
 * scientific qualification.
 */
export function createResearchDevelopmentSourceFixtureV1(input: Readonly<{
  barCount?: number;
  /** Optional deterministic close series for execution-engine integration tests. */
  closes?: readonly number[];
  organizationId?: string;
  sourceReleaseSha?: string;
  releaseSha?: string;
}> = {}): ResearchDevelopmentSourceFixtureV1 {
  const barCount = input.closes?.length ?? input.barCount ?? 8;
  if (!Number.isSafeInteger(barCount) || barCount < 6 || barCount > 10_000) {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_FIXTURE_BAR_COUNT_INVALID");
  }
  if (input.closes && ((input.barCount !== undefined && input.barCount !== input.closes.length) ||
      input.closes.some(close => !Number.isFinite(close) || close <= 0))) {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_FIXTURE_CLOSES_INVALID");
  }
  const organizationId = input.organizationId ?? DEFAULT_ORGANIZATION_ID;
  const sourceReleaseSha = input.sourceReleaseSha ?? DEFAULT_RELEASE_SHA;
  const releaseSha = input.releaseSha ?? sourceReleaseSha;
  if (!/^[a-f0-9]{40}$/.test(sourceReleaseSha) || !/^[a-f0-9]{40}$/.test(releaseSha)) {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_FIXTURE_RELEASE_INVALID");
  }

  const rootDir = mkdtempSync(join(tmpdir(), "waia-research-development-source-v1-"));
  try {
    const datasetRoot = rootDir;
    const bars: Bar[] = input.closes
      ? input.closes.map((close, index) => {
        const openMs = DEVELOPMENT_START_MS + index * ONE_MINUTE_MS;
        const open = index === 0 ? close : input.closes![index - 1]!;
        return {
          symbol: "BTC/USDT", interval: "1m", open: String(open),
          high: String(Math.max(open, close) + 1), low: String(Math.min(open, close) - 1),
          close: String(close), volume: String(index + 2),
          barOpenTime: new Date(openMs).toISOString(),
          barCloseTime: new Date(openMs + ONE_MINUTE_MS).toISOString(),
        };
      })
      : Array.from({ length: barCount }, (_, index) => {
        const openMs = DEVELOPMENT_START_MS + index * ONE_MINUTE_MS;
        const open = 100 + index;
        const close = open + (index % 2 === 0 ? 1 : -0.5);
        return {
          symbol: "BTC/USDT",
          interval: "1m",
          open: String(open),
          high: String(Math.max(open, close) + 1),
          low: String(Math.min(open, close) - 1),
          close: String(close),
          volume: String(index + 2),
          barOpenTime: new Date(openMs).toISOString(),
          barCloseTime: new Date(openMs + ONE_MINUTE_MS).toISOString(),
        };
      });
    const rawBytes = Buffer.from(
      bars.map((bar) => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join(""),
      "utf8",
    );
    const relativePath = fhvOfficialPartitionFileRelativePath({
      partition: "development",
      symbol: "BTCUSDT",
    });
    const developmentFile = join(datasetRoot, relativePath);
    mkdirSync(join(datasetRoot, "partitions", "development", "BTCUSDT"), { recursive: true });
    writeFileSync(developmentFile, rawBytes, { flag: "wx" });

    const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
    const firstBarOpen = bars[0]!.barOpenTime;
    const lastBarClose = bars.at(-1)!.barCloseTime;
    const rawSha256 = sha(rawBytes);
    const semanticContentDigest = computeStableJsonDigest(bars);
    const capabilityDigest = sha("synthetic research source capability fixture");
    const acquisitionDigest = sha("synthetic acquisition receipt fixture");
    const otherDigest = (label: string) => sha("synthetic " + label + " digest");
    const qualificationBody: Omit<FhvPreHoldoutQualificationReceiptV1, "qualificationReceiptDigest"> = {
      schemaVersion: FHV_PRE_HOLDOUT_QUALIFICATION_SCHEMA,
      qualificationMode: FHV_PRE_HOLDOUT_QUALIFICATION_MODE,
      classification: "PRE_HOLDOUT_QUALIFICATION=PASS",
      releaseSha: sourceReleaseSha,
      organizationId,
      operatorId: "dee-1211-synthetic-upstream-fixture",
      sourceCapabilityEvidenceDigest: capabilityDigest,
      canonicalBoundaries: {
        development: { startUtc: "2020-01-01T00:00:00.000Z", endUtc: "2023-01-01T00:00:00.000Z" },
        walkForward: { startUtc: "2023-01-01T00:00:00.000Z", endUtc: "2025-01-01T00:00:00.000Z" },
        wfPredictive: { startUtc: "2023-01-01T00:00:00.000Z", endUtc: "2024-01-01T00:00:00.000Z" },
        wfEconomic: { startUtc: "2024-01-01T00:00:00.000Z", endUtc: "2025-01-01T00:00:00.000Z" },
      },
      interval: "1m",
      symbols: ["BTCUSDT", "ETHUSDT"],
      acquisitionReceiptDigests: [acquisitionDigest],
      partitions: [{
        partition: "development",
        symbol: "BTCUSDT",
        acquisitionReceiptDigest: acquisitionDigest,
        rawSha256,
        semanticContentDigest,
        barCount,
        expectedBarCount: barCount,
        firstBarOpen,
        lastBarClose,
        gapDuplicateIntegrity: "PASS",
        normalizationIdentity: "dee-1211-synthetic-fixture",
        pageCount: 1,
        retryCount: 0,
      }],
      scientificSubpartitions: [],
      developmentContentDigest: otherDigest("development"),
      wfPredictiveContentDigest: otherDigest("wf-predictive"),
      wfEconomicContentDigest: otherDigest("wf-economic"),
      developmentWalkForwardContentDigest: otherDigest("development-walk-forward"),
      walkForwardUnionCompatibilityDigest: otherDigest("walk-forward-union"),
      holdout: {
        canonicalBoundary: { startUtc: "2025-01-01T00:00:00.000Z", endUtc: "2026-01-01T00:00:00.000Z" },
        status: FHV_PRE_HOLDOUT_HOLDOUT_STATUS,
        sourceCapabilityEvidenceDigest: capabilityDigest,
      },
      revisionRiskEvidence: [],
      revisionRiskDisposition: "SAME",
      qualifiedAtUtc: firstBarOpen,
    };
    const qualificationReceipt: FhvPreHoldoutQualificationReceiptV1 = {
      ...qualificationBody,
      qualificationReceiptDigest: computeStableJsonDigest(qualificationBody),
    };
    const qualificationReceiptPath = join(rootDir, "qualification.json");
    writeFileSync(qualificationReceiptPath, JSON.stringify(qualificationReceipt) + "\n", { flag: "wx" });

    const volumeRows = bars.slice(0, Math.min(4, bars.length)).map((bar, index) => ({
      id: index + 1,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      amount: index + 1,
      vol: Number(bar.close) * (index + 1),
      count: index + 1,
    }));
    const volumeQualificationReceipt = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: volumeRows,
      qualifiedAtUtc: firstBarOpen,
    });
    const htxVolumeQualificationReceiptPath = join(rootDir, "htx-volume-qualification.json");
    writeFileSync(htxVolumeQualificationReceiptPath,
      JSON.stringify(volumeQualificationReceipt) + "\n", { flag: "wx" });

    const runtimeRequalificationReceiptPath = join(rootDir, "runtime-requalification.json");
    let runtimeRequalificationReceipt: FhvPreHoldoutRuntimeRequalificationV1 | null = null;
    if (sourceReleaseSha !== releaseSha) {
      const runtimeBody = {
        schemaVersion: FHV_PRE_HOLDOUT_RUNTIME_REQUALIFICATION_SCHEMA,
        classification: "RUNTIME_REQUALIFICATION=PASS" as const,
        sourceQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
        sourceReleaseSha,
        targetReleaseSha: releaseSha,
        datasetContentDigest: qualificationReceipt.developmentWalkForwardContentDigest,
        organizationId,
        operatorId: "dee-1211-synthetic-runtime-requalification-fixture",
        verifiedAtUtc: firstBarOpen,
      };
      runtimeRequalificationReceipt = {
        ...runtimeBody,
        requalificationReceiptDigest: computePayloadDigest(runtimeBody),
      };
      writeFileSync(runtimeRequalificationReceiptPath,
        JSON.stringify(runtimeRequalificationReceipt) + "\n", { flag: "wx" });
    }

    let cleaned = false;
    return Object.freeze({
      rootDir,
      datasetRoot,
      qualificationReceiptPath,
      runtimeRequalificationReceiptPath,
      htxVolumeQualificationReceiptPath,
      releaseSha,
      organizationId,
      rawBytes,
      bars: Object.freeze(bars),
      qualificationReceipt: Object.freeze(qualificationReceipt),
      volumeQualificationReceipt: Object.freeze(volumeQualificationReceipt),
      runtimeRequalificationReceipt: runtimeRequalificationReceipt === null
        ? null
        : Object.freeze(runtimeRequalificationReceipt),
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        rmSync(rootDir, { recursive: true, force: true });
      },
    });
  } catch (error) {
    rmSync(rootDir, { recursive: true, force: true });
    throw error;
  }
}
