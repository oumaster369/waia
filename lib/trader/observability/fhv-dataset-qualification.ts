import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import type { Bar } from "@/lib/trader/intelligence/types";
import {
  FHV_DATASET_MANIFEST_SCHEMA_VERSION,
  FHV_DATASET_PARTITIONS_V1,
  type FhvDatasetManifestV1,
  type FhvUtcHalfOpenInterval,
} from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import {
  FHV_GAP_POLICY_V1,
  evaluateGapPolicy,
} from "@/lib/trader/market-data/dataset/fhv-gap-policy";
import type { GapRecord } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { mergeFhvSharedPortfolioBarsChronologically } from "@/lib/trader/market-data/fhv-shared-portfolio-bar-replay-source";
import { runIngressManifestEvidenceHarness } from "@/lib/trader/market-data/dataset/ingress-manifest-evidence-harness";
import { assertIngestBarsIntegrity } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import {
  accumulateBarContentDigests,
  finalizeBarSetDigestFromBarDigests,
} from "@/lib/trader/market-data/research-dataset";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { FhvDatasetManifestV2PartitionEntry } from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import {
  resolveFhvDatasetManifestV2Path,
  resolveFhvDatasetSealReceiptV2Path,
} from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import {
  FhvDatasetSealError,
  validateFhvV2DatasetReadOnly,
} from "@/lib/trader/market-data/fhv-dataset-seal";
import {
  assertFhvPreHoldoutFilesMatchReceipt,
  FhvPreHoldoutQualificationError,
  FHV_PRE_HOLDOUT_QUALIFICATION_MODE,
  readFhvPreHoldoutQualificationReceipt,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import {
  buildFhvScientificPartitionReceiptSet,
  computeFhvScientificPartitionsDigest,
  type FhvPartitionReceiptSymbolEvidenceV1,
} from "@/lib/trader/observability/fhv-partition-receipt";
import {
  assertImmutableArtifactExactMatch,
  FhvImmutableArtifactCollisionError,
} from "@/lib/trader/observability/fhv-immutable-artifact-guard";

export const FHV_DATASET_QUALIFICATION_RECEIPT_SCHEMA_VERSION =
  "fhv-dataset-qualification-receipt/v1" as const;
export const FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME =
  "fhv-dataset-qualification-receipt.v1.json" as const;

export const FHV_OFFICIAL_PARTITION_NAMES = [
  "development",
  "walk-forward",
  "blind-holdout",
] as const;
export const FHV_OFFICIAL_SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;

export const FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT = join(
  process.cwd(),
  "tests/fixtures/trader/fhv-official-real-schema",
);

export type FhvQualificationMode =
  | "OFFICIAL_MULTI_YEAR"
  | "OFFICIAL_PRE_HOLDOUT_REAL_DATA"
  | "SCHEMA_INTEGRATION_FIXTURE"
  | "BOUNDED_INGRESS_FIXTURE";

export type FhvPartitionBarEvidenceV1 = Readonly<{
  partition: (typeof FHV_OFFICIAL_PARTITION_NAMES)[number];
  symbol: (typeof FHV_OFFICIAL_SYMBOLS)[number];
  filePath: string;
  fileContentDigest: string;
  barCount: number;
  firstBarOpenTime: string;
  lastBarOpenTime: string;
}>;

export type FhvDatasetQualificationReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_DATASET_QUALIFICATION_RECEIPT_SCHEMA_VERSION;
  classification: "DATASET_QUALIFICATION=PASS" | "DATASET_QUALIFICATION=FAIL";
  qualificationMode: FhvQualificationMode;
  datasetRoot: string;
  manifestPath: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  partitionsDigest: string;
  gapPolicyId: string;
  qualifiedAtUtc: string;
  qualificationReceiptDigest: string;
  releaseSha?: string;
  releaseTag?: string;
  organizationId?: string;
  operatorId?: string;
  fixtureClassification?: "SCHEMA_INTEGRATION_FIXTURE";
  partitionEvidence?: readonly FhvPartitionBarEvidenceV1[];
  symbolDigests?: Readonly<Record<(typeof FHV_OFFICIAL_SYMBOLS)[number], string>>;
  holdoutSealDigest?: string;
  partitionReceipts?: Readonly<
    Partial<
      Record<
        import("@/lib/trader/observability/fhv-partition-receipt").FhvScientificPartitionName,
        import("@/lib/trader/observability/fhv-partition-receipt").FhvPartitionReceiptV1
      >
    >
  >;
  scientificPartitionsDigest?: string;
  failureReason?: string;
}>;

export class FhvDatasetQualificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvDatasetQualificationError";
  }
}

function buildPartitionSymbolEvidenceFromManifestEntries(input: {
  entries: readonly {
    partition: (typeof FHV_OFFICIAL_PARTITION_NAMES)[number];
    symbol: (typeof FHV_OFFICIAL_SYMBOLS)[number];
    rawSha256: string;
    actualBarCount: number;
    firstBarOpen: string;
    lastBarClose: string;
  }[];
  targetPartition: (typeof FHV_OFFICIAL_PARTITION_NAMES)[number];
}): FhvPartitionReceiptSymbolEvidenceV1[] {
  return FHV_OFFICIAL_SYMBOLS.flatMap((symbol) => {
    const entry = input.entries.find(
      (candidate) => candidate.partition === input.targetPartition && candidate.symbol === symbol,
    );
    if (!entry) {
      return [];
    }
    return [
      {
        symbol,
        barCount: entry.actualBarCount,
        contentDigest: entry.rawSha256,
        firstBarOpenTime: entry.firstBarOpen,
        lastBarCloseTime: entry.lastBarClose,
        dataAccess: "READ" as const,
      },
    ];
  });
}

function buildScientificPartitionReceipts(input: {
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  partitionsDigest: string;
  holdoutSealDigest: string;
  developmentEvidence: readonly FhvPartitionReceiptSymbolEvidenceV1[];
  wfPredictiveEvidence: readonly FhvPartitionReceiptSymbolEvidenceV1[];
  wfEconomicEvidence: readonly FhvPartitionReceiptSymbolEvidenceV1[];
}) {
  return buildFhvScientificPartitionReceiptSet({
    datasetContentDigest: input.datasetContentDigest,
    manifestSemanticDigest: input.manifestSemanticDigest,
    partitionsDigest: input.partitionsDigest,
    developmentEvidence: input.developmentEvidence,
    wfPredictiveEvidence: input.wfPredictiveEvidence,
    wfEconomicEvidence: input.wfEconomicEvidence,
    holdoutSealDigest: input.holdoutSealDigest,
  });
}

function buildPartitionReceiptsFromV1Evidence(input: {
  partitionEvidence: readonly FhvPartitionBarEvidenceV1[];
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  partitionsDigest: string;
  holdoutSealDigest: string;
}) {
  const toSymbolEvidence = (
    partition: (typeof FHV_OFFICIAL_PARTITION_NAMES)[number],
  ): FhvPartitionReceiptSymbolEvidenceV1[] =>
    FHV_OFFICIAL_SYMBOLS.flatMap((symbol) => {
      const entry = input.partitionEvidence.find(
        (candidate) => candidate.partition === partition && candidate.symbol === symbol,
      );
      if (!entry) {
        return [];
      }
      return [
        {
          symbol,
          barCount: entry.barCount,
          contentDigest: entry.fileContentDigest,
          firstBarOpenTime: entry.firstBarOpenTime,
          lastBarCloseTime: entry.lastBarOpenTime,
          dataAccess: "READ" as const,
        },
      ];
    });

  const walkForward = toSymbolEvidence("walk-forward");
  return buildScientificPartitionReceipts({
    datasetContentDigest: input.datasetContentDigest,
    manifestSemanticDigest: input.manifestSemanticDigest,
    partitionsDigest: input.partitionsDigest,
    holdoutSealDigest: input.holdoutSealDigest,
    developmentEvidence: toSymbolEvidence("development"),
    wfPredictiveEvidence: walkForward,
    wfEconomicEvidence: walkForward,
  });
}

function computeQualificationReceiptDigest(
  receipt: Omit<FhvDatasetQualificationReceiptV1, "qualificationReceiptDigest">,
): string {
  return computePayloadDigest(receipt);
}

function computeRawSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function symbolToBarFormat(symbol: (typeof FHV_OFFICIAL_SYMBOLS)[number]): string {
  if (symbol === "BTCUSDT") {
    return "BTC/USDT";
  }
  return "ETH/USDT";
}

function parsePartitionBarsFile(
  path: string,
  symbol: (typeof FHV_OFFICIAL_SYMBOLS)[number],
): Bar[] {
  if (!existsSync(path)) {
    throw new FhvDatasetQualificationError(
      "PARTITION_FILE_MISSING",
      `Partition bars file missing: ${path}`,
    );
  }
  const rawContent = readFileSync(path, "utf8");
  const parsed = JSON.parse(rawContent) as { bars?: Bar[] };
  if (!Array.isArray(parsed.bars) || parsed.bars.length === 0) {
    throw new FhvDatasetQualificationError(
      "PARTITION_BARS_EMPTY",
      `Partition bars file has no bars: ${path}`,
    );
  }
  const expectedSymbol = symbolToBarFormat(symbol);
  for (const bar of parsed.bars) {
    if (bar.symbol !== expectedSymbol) {
      throw new FhvDatasetQualificationError(
        "PARTITION_BAR_SYMBOL_MISMATCH",
        `Bar symbol mismatch in ${path}: expected ${expectedSymbol}, got ${bar.symbol}`,
      );
    }
    if (bar.interval !== "1m") {
      throw new FhvDatasetQualificationError(
        "PARTITION_BAR_INTERVAL_MISMATCH",
        `Bar interval mismatch in ${path}: expected 1m, got ${bar.interval}`,
      );
    }
  }
  return parsed.bars;
}

function assertBarWithinHalfOpenInterval(
  bar: Bar,
  interval: FhvUtcHalfOpenInterval,
  context: string,
): void {
  const openMs = Date.parse(bar.barOpenTime);
  const startMs = Date.parse(interval.startUtc);
  const endMs = Date.parse(interval.endUtc);
  if (openMs < startMs || openMs >= endMs) {
    throw new FhvDatasetQualificationError(
      "PARTITION_BAR_OUT_OF_RANGE",
      `Bar ${bar.barOpenTime} outside half-open interval for ${context}`,
    );
  }
}

function resolvePartitionInterval(partition: (typeof FHV_OFFICIAL_PARTITION_NAMES)[number]) {
  if (partition === "development") {
    return FHV_DATASET_PARTITIONS_V1.development;
  }
  if (partition === "walk-forward") {
    return FHV_DATASET_PARTITIONS_V1.walkForward;
  }
  return FHV_DATASET_PARTITIONS_V1.blindHoldout;
}

function validateOfficialManifest(manifest: FhvDatasetManifestV1, manifestPath: string): void {
  if (manifest.schemaVersion !== FHV_DATASET_MANIFEST_SCHEMA_VERSION) {
    throw new FhvDatasetQualificationError(
      "MANIFEST_SCHEMA_MISMATCH",
      `Manifest schema mismatch at ${manifestPath}`,
    );
  }
  if (manifest.venueScope !== "HTX_ONLY" || manifest.marketType !== "SPOT") {
    throw new FhvDatasetQualificationError(
      "MANIFEST_VENUE_SCOPE_MISMATCH",
      "Manifest must declare HTX_ONLY SPOT.",
    );
  }
  if (
    manifest.symbols.length !== 2 ||
    manifest.symbols[0] !== "BTCUSDT" ||
    manifest.symbols[1] !== "ETHUSDT"
  ) {
    throw new FhvDatasetQualificationError(
      "MANIFEST_SYMBOLS_MISMATCH",
      "Manifest symbols must be BTCUSDT and ETHUSDT.",
    );
  }
  if (manifest.baseInterval !== "1m") {
    throw new FhvDatasetQualificationError(
      "MANIFEST_INTERVAL_MISMATCH",
      "Manifest baseInterval must be 1m.",
    );
  }
  const expectedStart = FHV_DATASET_PARTITIONS_V1.development.startUtc;
  const expectedEnd = FHV_DATASET_PARTITIONS_V1.blindHoldout.endUtc;
  if (
    manifest.intervalBoundaries.startUtc !== expectedStart ||
    manifest.intervalBoundaries.endUtc !== expectedEnd
  ) {
    throw new FhvDatasetQualificationError(
      "MANIFEST_INTERVAL_BOUNDARIES_MISMATCH",
      "Manifest intervalBoundaries must be [2020-01-01, 2026-01-01) half-open.",
    );
  }
  if (manifest.holdoutSeal.contaminationStatus !== "RESERVED_SEALED_NOT_ACCESSED") {
    throw new FhvDatasetQualificationError(
      "HOLDOUT_CONTAMINATION",
      "Holdout seal must be RESERVED_SEALED_NOT_ACCESSED before authorization.",
    );
  }
}

const ONE_MINUTE_MS = 60_000;

function computePartitionTimelineGaps(
  bars: readonly Bar[],
  interval: FhvUtcHalfOpenInterval,
): GapRecord[] {
  const sorted = [...bars].sort(
    (left, right) => Date.parse(left.barOpenTime) - Date.parse(right.barOpenTime),
  );
  const gaps: GapRecord[] = [];
  let previousOpenMs: number | null = null;
  const startMs = Date.parse(interval.startUtc);
  const endMs = Date.parse(interval.endUtc);
  const expectedBarCount = (endMs - startMs) / ONE_MINUTE_MS;

  for (const bar of sorted) {
    const openMs = Date.parse(bar.barOpenTime);
    if (previousOpenMs === null) {
      if (openMs > startMs) {
        gaps.push({
          fromBarOpenUtc: interval.startUtc,
          toBarOpenUtc: bar.barOpenTime,
          missingBarCount: Math.round((openMs - startMs) / ONE_MINUTE_MS),
          durationMs: openMs - startMs,
        });
      }
    } else {
      const expectedNext = previousOpenMs + ONE_MINUTE_MS;
      if (openMs > expectedNext) {
        gaps.push({
          fromBarOpenUtc: new Date(expectedNext).toISOString(),
          toBarOpenUtc: bar.barOpenTime,
          missingBarCount: Math.round((openMs - expectedNext) / ONE_MINUTE_MS),
          durationMs: openMs - expectedNext,
        });
      }
    }
    previousOpenMs = openMs;
  }

  if (sorted.length > 0 && sorted.length < expectedBarCount) {
    const last = sorted.at(-1)!;
    const lastCloseMs = Date.parse(last.barCloseTime);
    if (lastCloseMs < endMs) {
      gaps.push({
        fromBarOpenUtc: last.barCloseTime,
        toBarOpenUtc: interval.endUtc,
        missingBarCount: Math.round((endMs - lastCloseMs) / ONE_MINUTE_MS),
        durationMs: endMs - lastCloseMs,
      });
    }
  }

  return gaps;
}

function assertOfficialMultiYearPartitionCoverage(input: {
  partition: (typeof FHV_OFFICIAL_PARTITION_NAMES)[number];
  symbol: (typeof FHV_OFFICIAL_SYMBOLS)[number];
  bars: readonly Bar[];
}): void {
  const interval = resolvePartitionInterval(input.partition);
  const sorted = [...input.bars].sort(
    (left, right) => Date.parse(left.barOpenTime) - Date.parse(right.barOpenTime),
  );
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) {
    throw new FhvDatasetQualificationError(
      "PARTITION_COVERAGE_EMPTY",
      `Partition ${input.partition}/${input.symbol} has no bars.`,
    );
  }
  if (first.barOpenTime !== interval.startUtc) {
    throw new FhvDatasetQualificationError(
      "PARTITION_COVERAGE_START_MISMATCH",
      `First bar for ${input.partition}/${input.symbol} must open at ${interval.startUtc}.`,
    );
  }
  if (last.barCloseTime !== interval.endUtc) {
    throw new FhvDatasetQualificationError(
      "PARTITION_COVERAGE_END_MISMATCH",
      `Last bar for ${input.partition}/${input.symbol} must close at ${interval.endUtc}.`,
    );
  }

  const startMs = Date.parse(interval.startUtc);
  const endMs = Date.parse(interval.endUtc);
  const expectedBarCount = (endMs - startMs) / ONE_MINUTE_MS;
  if (sorted.length !== expectedBarCount) {
    throw new FhvDatasetQualificationError(
      "PARTITION_INCOMPLETE",
      `Partition ${input.partition}/${input.symbol} is incomplete: expected ${expectedBarCount} bars, observed ${sorted.length}.`,
    );
  }

  const gaps = computePartitionTimelineGaps(sorted, interval);
  const gapResult = evaluateGapPolicy(gaps);
  if (gapResult !== "PASS") {
    throw new FhvDatasetQualificationError(
      "PARTITION_GAP_POLICY_FAIL",
      `Gap policy failed for ${input.partition}/${input.symbol}.`,
    );
  }
}

function resolveQualificationMode(input: {
  datasetRoot: string;
  qualificationMode?: FhvQualificationMode;
}): FhvQualificationMode {
  if (input.qualificationMode) {
    return input.qualificationMode;
  }
  const normalizedRoot = input.datasetRoot.replace(/\\/g, "/");
  if (normalizedRoot.includes("tests/fixtures/trader/fhv-official-real-schema")) {
    return "SCHEMA_INTEGRATION_FIXTURE";
  }
  return "OFFICIAL_MULTI_YEAR";
}

function rethrowDatasetSealError(error: unknown): never {
  if (error instanceof FhvDatasetSealError) {
    throw new FhvDatasetQualificationError(error.code, error.message);
  }
  throw error;
}

function assertOfficialMultiYearPartitionEntryCoverage(
  entry: FhvDatasetManifestV2PartitionEntry,
): void {
  const interval = resolvePartitionInterval(entry.partition);
  if (entry.firstBarOpen !== interval.startUtc) {
    throw new FhvDatasetQualificationError(
      "PARTITION_COVERAGE_START_MISMATCH",
      `First bar for ${entry.partition}/${entry.symbol} must open at ${interval.startUtc}.`,
    );
  }
  if (entry.lastBarClose !== interval.endUtc) {
    throw new FhvDatasetQualificationError(
      "PARTITION_COVERAGE_END_MISMATCH",
      `Last bar for ${entry.partition}/${entry.symbol} must close at ${interval.endUtc}.`,
    );
  }
  const startMs = Date.parse(interval.startUtc);
  const endMs = Date.parse(interval.endUtc);
  const expectedBarCount = (endMs - startMs) / ONE_MINUTE_MS;
  if (entry.actualBarCount !== expectedBarCount) {
    throw new FhvDatasetQualificationError(
      "PARTITION_INCOMPLETE",
      `Partition ${entry.partition}/${entry.symbol} is incomplete: expected ${expectedBarCount} bars, observed ${entry.actualBarCount}.`,
    );
  }
  if (entry.actualBarCount !== entry.expectedBarCount) {
    throw new FhvDatasetQualificationError(
      "PARTITION_BAR_COUNT_MISMATCH",
      `Partition ${entry.partition}/${entry.symbol} actualBarCount does not match expectedBarCount.`,
    );
  }
}

function assertOfficialV2HoldoutSeal(manifest: {
  holdoutSealDigest: string;
  partitions: readonly FhvDatasetManifestV2PartitionEntry[];
}): void {
  const holdoutEntry = manifest.partitions.find((entry) => entry.partition === "blind-holdout");
  if (!holdoutEntry) {
    throw new FhvDatasetQualificationError(
      "HOLDOUT_PARTITION_MISSING",
      "blind-holdout partition entry missing from manifest v2.",
    );
  }
  const expectedHoldoutSealDigest = computeStableJsonDigest({
    blindHoldoutRawSha256: holdoutEntry.rawSha256,
    contaminationStatus: "RESERVED_SEALED_NOT_ACCESSED",
  });
  if (manifest.holdoutSealDigest !== expectedHoldoutSealDigest) {
    throw new FhvDatasetQualificationError(
      "HOLDOUT_CONTAMINATION",
      "Holdout seal must be RESERVED_SEALED_NOT_ACCESSED before authorization.",
    );
  }
}

function qualifyFhvOfficialDatasetV1IntegrationFixture(input: {
  datasetRoot: string;
  manifestPath: string;
  qualificationMode: "SCHEMA_INTEGRATION_FIXTURE";
  releaseSha?: string;
  releaseTag?: string;
  organizationId?: string;
  operatorId?: string;
}): Omit<FhvDatasetQualificationReceiptV1, "qualificationReceiptDigest" | "qualifiedAtUtc"> {
  const datasetRoot = input.datasetRoot.trim();
  const manifestPath = input.manifestPath.trim();
  if (!existsSync(manifestPath)) {
    throw new FhvDatasetQualificationError(
      "MANIFEST_PATH_MISSING",
      `Manifest not found: ${manifestPath}`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as FhvDatasetManifestV1;
  validateOfficialManifest(manifest, manifestPath);

  const datasetBarDigestEntries: Array<{ openTimeMs: number; digest: string }> = [];
  const btcBarDigests: string[] = [];
  const ethBarDigests: string[] = [];
  const partitionEvidence: FhvPartitionBarEvidenceV1[] = [];

  for (const partition of FHV_OFFICIAL_PARTITION_NAMES) {
    const interval = resolvePartitionInterval(partition);
    for (const symbol of FHV_OFFICIAL_SYMBOLS) {
      const barsPath = join(datasetRoot, "partitions", partition, symbol, "bars.v1.json");
      const rawContent = readFileSync(barsPath, "utf8");
      const bars = parsePartitionBarsFile(barsPath, symbol);
      const integrity = assertIngestBarsIntegrity({
        bars,
        expectedSymbol: symbolToBarFormat(symbol),
        expectedInterval: "1m",
      });
      if (!integrity.ok) {
        throw new FhvDatasetQualificationError(
          integrity.reason,
          `Partition integrity failed for ${partition}/${symbol}: ${integrity.detail}`,
        );
      }
      for (const bar of bars) {
        assertBarWithinHalfOpenInterval(bar, interval, `${partition}/${symbol}`);
      }
      const sortedBars = [...bars].sort(
        (left, right) => Date.parse(left.barOpenTime) - Date.parse(right.barOpenTime),
      );
      partitionEvidence.push({
        partition,
        symbol,
        filePath: barsPath,
        fileContentDigest: computeRawSha256(rawContent),
        barCount: bars.length,
        firstBarOpenTime: sortedBars[0]!.barOpenTime,
        lastBarOpenTime: sortedBars.at(-1)!.barOpenTime,
      });
      for (const bar of bars) {
        datasetBarDigestEntries.push({
          openTimeMs: Date.parse(bar.barOpenTime),
          digest: computeBarContentDigest(bar),
        });
      }
      if (symbol === "BTCUSDT") {
        accumulateBarContentDigests(btcBarDigests, bars);
      } else {
        accumulateBarContentDigests(ethBarDigests, bars);
      }
    }
  }

  datasetBarDigestEntries.sort((left, right) => left.openTimeMs - right.openTimeMs);
  const datasetContentDigest = finalizeBarSetDigestFromBarDigests(
    datasetBarDigestEntries.map((entry) => entry.digest),
  );
  const manifestSemanticDigest = manifest.manifestSemanticDigest;
  const partitionsDigest = computeStableJsonDigest(FHV_DATASET_PARTITIONS_V1);
  const symbolDigests = {
    BTCUSDT: finalizeBarSetDigestFromBarDigests(btcBarDigests),
    ETHUSDT: finalizeBarSetDigestFromBarDigests(ethBarDigests),
  } as const;
  const holdoutSealDigest = computeStableJsonDigest(manifest.holdoutSeal);
  const partitionReceipts = buildPartitionReceiptsFromV1Evidence({
    partitionEvidence,
    datasetContentDigest,
    manifestSemanticDigest,
    partitionsDigest,
    holdoutSealDigest,
  });

  if (manifest.barSetDigest !== datasetContentDigest) {
    throw new FhvDatasetQualificationError(
      "DATASET_CONTENT_DIGEST_MISMATCH",
      "Manifest barSetDigest does not match computed datasetContentDigest.",
    );
  }

  return {
    schemaVersion: FHV_DATASET_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
    classification: "DATASET_QUALIFICATION=PASS",
    qualificationMode: input.qualificationMode,
    datasetRoot,
    manifestPath,
    datasetContentDigest,
    manifestSemanticDigest,
    partitionsDigest,
    gapPolicyId: FHV_GAP_POLICY_V1.policyId,
    ...(input.releaseSha ? { releaseSha: input.releaseSha.trim().toLowerCase() } : {}),
    ...(input.releaseTag ? { releaseTag: input.releaseTag.trim() } : {}),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    ...(input.operatorId ? { operatorId: input.operatorId } : {}),
    fixtureClassification: "SCHEMA_INTEGRATION_FIXTURE" as const,
    partitionEvidence,
    symbolDigests,
    holdoutSealDigest,
    partitionReceipts,
    scientificPartitionsDigest: computeFhvScientificPartitionsDigest(),
  };
}

export function qualifyFhvOfficialV2DatasetStreaming(input: {
  datasetRoot: string;
  manifestPath?: string;
  releaseSha?: string;
  releaseTag?: string;
  organizationId?: string;
  operatorId?: string;
}): Omit<FhvDatasetQualificationReceiptV1, "qualificationReceiptDigest" | "qualifiedAtUtc"> {
  const datasetRoot = input.datasetRoot.trim();
  let validated;
  try {
    validated = validateFhvV2DatasetReadOnly(datasetRoot);
  } catch (error) {
    rethrowDatasetSealError(error);
  }
  const { manifest, sealReceipt } = validated;
  const manifestPath = input.manifestPath?.trim() || resolveFhvDatasetManifestV2Path(datasetRoot);
  if (sealReceipt.datasetContentDigest !== manifest.datasetContentDigest) {
    throw new FhvDatasetQualificationError(
      "SEAL_DATASET_DIGEST_MISMATCH",
      "Seal receipt datasetContentDigest must match manifest v2.",
    );
  }
  const expectedStart = FHV_DATASET_PARTITIONS_V1.development.startUtc;
  const expectedEnd = FHV_DATASET_PARTITIONS_V1.blindHoldout.endUtc;
  if (
    manifest.intervalBoundaries.startUtc !== expectedStart ||
    manifest.intervalBoundaries.endUtc !== expectedEnd
  ) {
    throw new FhvDatasetQualificationError(
      "MANIFEST_INTERVAL_BOUNDARIES_MISMATCH",
      "Manifest intervalBoundaries must be [2020-01-01, 2026-01-01) half-open.",
    );
  }
  assertOfficialV2HoldoutSeal(manifest);

  const partitionEvidence: FhvPartitionBarEvidenceV1[] = manifest.partitions.map((entry) => ({
    partition: entry.partition,
    symbol: entry.symbol,
    filePath: join(datasetRoot, entry.filePath),
    fileContentDigest: entry.rawSha256,
    barCount: entry.actualBarCount,
    firstBarOpenTime: entry.firstBarOpen,
    lastBarOpenTime: entry.lastBarClose,
  }));
  for (const entry of manifest.partitions) {
    assertOfficialMultiYearPartitionEntryCoverage(entry);
  }

  const partitionsDigest = computeStableJsonDigest(FHV_DATASET_PARTITIONS_V1);
  const developmentEvidence = buildPartitionSymbolEvidenceFromManifestEntries({
    entries: manifest.partitions,
    targetPartition: "development",
  });
  const walkForwardEvidence = buildPartitionSymbolEvidenceFromManifestEntries({
    entries: manifest.partitions,
    targetPartition: "walk-forward",
  });
  const partitionReceipts = buildScientificPartitionReceipts({
    datasetContentDigest: manifest.datasetContentDigest,
    manifestSemanticDigest: manifest.manifestSemanticDigest,
    partitionsDigest,
    holdoutSealDigest: manifest.holdoutSealDigest,
    developmentEvidence,
    wfPredictiveEvidence: walkForwardEvidence,
    wfEconomicEvidence: walkForwardEvidence,
  });

  return {
    schemaVersion: FHV_DATASET_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
    classification: "DATASET_QUALIFICATION=PASS",
    qualificationMode: "OFFICIAL_MULTI_YEAR",
    datasetRoot,
    manifestPath,
    datasetContentDigest: manifest.datasetContentDigest,
    manifestSemanticDigest: manifest.manifestSemanticDigest,
    partitionsDigest,
    gapPolicyId: FHV_GAP_POLICY_V1.policyId,
    ...(input.releaseSha ? { releaseSha: input.releaseSha.trim().toLowerCase() } : {}),
    ...(input.releaseTag ? { releaseTag: input.releaseTag.trim() } : {}),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    ...(input.operatorId ? { operatorId: input.operatorId } : {}),
    partitionEvidence,
    symbolDigests: manifest.symbolDigests,
    holdoutSealDigest: manifest.holdoutSealDigest,
    partitionReceipts,
    scientificPartitionsDigest: computeFhvScientificPartitionsDigest(),
  };
}

export function qualifyFhvOfficialDataset(input: {
  datasetRoot: string;
  manifestPath: string;
  qualificationMode?: FhvQualificationMode;
  releaseSha?: string;
  releaseTag?: string;
  organizationId?: string;
  operatorId?: string;
}): Omit<FhvDatasetQualificationReceiptV1, "qualificationReceiptDigest" | "qualifiedAtUtc"> {
  const datasetRoot = input.datasetRoot.trim();
  const manifestPath = input.manifestPath.trim();
  const qualificationMode = resolveQualificationMode({
    datasetRoot,
    qualificationMode: input.qualificationMode,
  });

  if (qualificationMode === "SCHEMA_INTEGRATION_FIXTURE") {
    return qualifyFhvOfficialDatasetV1IntegrationFixture({
      datasetRoot,
      manifestPath,
      qualificationMode,
      releaseSha: input.releaseSha,
      releaseTag: input.releaseTag,
      organizationId: input.organizationId,
      operatorId: input.operatorId,
    });
  }

  if (qualificationMode === "OFFICIAL_PRE_HOLDOUT_REAL_DATA") {
    const preHoldoutPath =
      input.manifestPath.trim() ||
      join(datasetRoot, "control", "fhv-pre-holdout-qualification-receipt.v1.json");
    let preHoldout;
    try {
      preHoldout = readFhvPreHoldoutQualificationReceipt(preHoldoutPath);
      assertFhvPreHoldoutFilesMatchReceipt({
        datasetRoot,
        receipt: preHoldout,
      });
    } catch (error) {
      if (error instanceof FhvPreHoldoutQualificationError) {
        throw new FhvDatasetQualificationError(error.code, error.message);
      }
      throw error;
    }
    if (input.releaseSha && input.releaseSha.trim().toLowerCase() !== preHoldout.releaseSha) {
      throw new FhvDatasetQualificationError(
        "RELEASE_MISMATCH",
        "pre-holdout qualification releaseSha mismatch",
      );
    }
    if (input.organizationId && input.organizationId !== preHoldout.organizationId) {
      throw new FhvDatasetQualificationError(
        "ORGANIZATION_OPERATOR_MISMATCH",
        "pre-holdout qualification organizationId mismatch",
      );
    }
    if (input.operatorId && input.operatorId !== preHoldout.operatorId) {
      throw new FhvDatasetQualificationError(
        "ORGANIZATION_OPERATOR_MISMATCH",
        "pre-holdout qualification operatorId mismatch",
      );
    }
    return {
      schemaVersion: FHV_DATASET_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
      classification: "DATASET_QUALIFICATION=PASS",
      qualificationMode: FHV_PRE_HOLDOUT_QUALIFICATION_MODE,
      datasetRoot,
      manifestPath: preHoldoutPath,
      datasetContentDigest: preHoldout.developmentWalkForwardContentDigest,
      manifestSemanticDigest: preHoldout.qualificationReceiptDigest,
      partitionsDigest: computeStableJsonDigest(preHoldout.canonicalBoundaries),
      gapPolicyId: FHV_GAP_POLICY_V1.policyId,
      ...(input.releaseSha ? { releaseSha: input.releaseSha.trim().toLowerCase() } : {}),
      ...(input.releaseTag ? { releaseTag: input.releaseTag.trim() } : {}),
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      ...(input.operatorId ? { operatorId: input.operatorId } : {}),
      partitionEvidence: preHoldout.partitions.map((entry) => ({
        partition: entry.partition,
        symbol: entry.symbol,
        filePath: join(datasetRoot, "partitions", entry.partition, entry.symbol, "bars.v2.ndjson"),
        fileContentDigest: entry.rawSha256,
        barCount: entry.barCount,
        firstBarOpenTime: entry.firstBarOpen,
        lastBarOpenTime: entry.lastBarClose,
      })),
    };
  }

  if (qualificationMode === "OFFICIAL_MULTI_YEAR") {
    for (const partition of FHV_OFFICIAL_PARTITION_NAMES) {
      for (const symbol of FHV_OFFICIAL_SYMBOLS) {
        const barsPath = join(datasetRoot, "partitions", partition, symbol, "bars.v1.json");
        if (!existsSync(barsPath)) {
          continue;
        }
        const bars = parsePartitionBarsFile(barsPath, symbol);
        assertOfficialMultiYearPartitionCoverage({ partition, symbol, bars });
      }
    }
    const sealPath = resolveFhvDatasetSealReceiptV2Path(datasetRoot);
    if (!existsSync(sealPath)) {
      throw new FhvDatasetQualificationError(
        "V2_SEAL_REQUIRED",
        "OFFICIAL_MULTI_YEAR requires sealed v2 dataset (manifest v2 + seal receipt v2).",
      );
    }
    return qualifyFhvOfficialV2DatasetStreaming({
      datasetRoot,
      manifestPath: resolveFhvDatasetManifestV2Path(datasetRoot),
      releaseSha: input.releaseSha,
      releaseTag: input.releaseTag,
      organizationId: input.organizationId,
      operatorId: input.operatorId,
    });
  }

  throw new FhvDatasetQualificationError(
    "UNSUPPORTED_QUALIFICATION_MODE",
    `Unsupported qualification mode: ${qualificationMode}.`,
  );
}

export function qualifyFhvBoundedFixtureDataset(): Omit<
  FhvDatasetQualificationReceiptV1,
  "qualificationReceiptDigest" | "qualifiedAtUtc"
> {
  const harness = runIngressManifestEvidenceHarness();
  const partitionsDigest = computeStableJsonDigest(FHV_DATASET_PARTITIONS_V1);
  const manifestSemanticDigest = harness.manifest.manifestSemanticDigest;
  const datasetContentDigest = harness.manifest.barSetDigest;

  if (harness.manifest.holdoutSeal.contaminationStatus !== "RESERVED_SEALED_NOT_ACCESSED") {
    throw new FhvDatasetQualificationError(
      "HOLDOUT_CONTAMINATION",
      "Bounded fixture holdout seal must be RESERVED_SEALED_NOT_ACCESSED.",
    );
  }

  return {
    schemaVersion: FHV_DATASET_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
    classification: "DATASET_QUALIFICATION=PASS",
    qualificationMode: "BOUNDED_INGRESS_FIXTURE",
    datasetRoot: harness.fixturePath,
    manifestPath: harness.fixturePath,
    datasetContentDigest,
    manifestSemanticDigest,
    partitionsDigest,
    gapPolicyId: harness.gapPolicy.policyId,
    holdoutSealDigest: computeStableJsonDigest(harness.manifest.holdoutSeal),
  };
}

export function buildFhvDatasetQualificationReceipt(
  body: Omit<FhvDatasetQualificationReceiptV1, "qualificationReceiptDigest">,
): FhvDatasetQualificationReceiptV1 {
  return {
    ...body,
    qualificationReceiptDigest: computeQualificationReceiptDigest(body),
  };
}

export function readFhvDatasetQualificationReceipt(
  receiptPath: string,
): FhvDatasetQualificationReceiptV1 {
  const parsed = JSON.parse(readFileSync(receiptPath, "utf8")) as FhvDatasetQualificationReceiptV1;
  const { qualificationReceiptDigest, ...body } = parsed;
  const expected = computeQualificationReceiptDigest(body);
  if (expected !== qualificationReceiptDigest) {
    throw new FhvDatasetQualificationError(
      "QUALIFICATION_RECEIPT_DIGEST_MISMATCH",
      "Dataset qualification receipt digest mismatch.",
    );
  }
  return parsed;
}

const DATASET_QUALIFICATION_RECEIPT_COMPARE_KEYS = [
  "schemaVersion",
  "classification",
  "qualificationMode",
  "datasetRoot",
  "manifestPath",
  "datasetContentDigest",
  "manifestSemanticDigest",
  "partitionsDigest",
  "gapPolicyId",
  "releaseSha",
  "releaseTag",
  "organizationId",
  "operatorId",
  "fixtureClassification",
  "partitionEvidence",
  "symbolDigests",
  "holdoutSealDigest",
  "partitionReceipts",
  "scientificPartitionsDigest",
] as const satisfies readonly (keyof FhvDatasetQualificationReceiptV1)[];

export function writeFhvDatasetQualificationReceiptAtomic(input: {
  receiptDir: string;
  datasetRoot: string;
  manifestPath: string;
  boundedFixture?: boolean;
  qualificationMode?: FhvQualificationMode;
  releaseSha?: string;
  releaseTag?: string;
  organizationId?: string;
  operatorId?: string;
}): FhvDatasetQualificationReceiptV1 {
  mkdirSync(input.receiptDir, { recursive: true });
  const receiptPath = join(input.receiptDir, FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME);

  const body = input.boundedFixture
    ? {
        ...qualifyFhvBoundedFixtureDataset(),
        ...(input.releaseSha ? { releaseSha: input.releaseSha.trim().toLowerCase() } : {}),
        ...(input.releaseTag ? { releaseTag: input.releaseTag.trim() } : {}),
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.operatorId ? { operatorId: input.operatorId.trim() } : {}),
      }
    : qualifyFhvOfficialDataset({
        datasetRoot: input.datasetRoot,
        manifestPath: input.manifestPath,
        qualificationMode: input.qualificationMode,
        releaseSha: input.releaseSha,
        releaseTag: input.releaseTag,
        organizationId: input.organizationId,
        operatorId: input.operatorId,
      });

  if (existsSync(receiptPath)) {
    const existing = readFhvDatasetQualificationReceipt(receiptPath);
    const requested = buildFhvDatasetQualificationReceipt({
      ...body,
      qualifiedAtUtc: existing.qualifiedAtUtc,
    });
    assertImmutableArtifactExactMatch({
      artifactPath: receiptPath,
      artifactLabel: "Dataset qualification receipt",
      existing,
      requested,
      compareKeys: DATASET_QUALIFICATION_RECEIPT_COMPARE_KEYS,
    });
    return existing;
  }

  const receipt = buildFhvDatasetQualificationReceipt({
    ...body,
    qualifiedAtUtc: new Date().toISOString(),
  });
  writeFileAtomicExclusive(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export { FhvImmutableArtifactCollisionError };

export function loadOfficialSharedPortfolioBars(input: {
  datasetRoot: string;
  includeHoldout: boolean;
}): Bar[] {
  const partitions = input.includeHoldout
    ? FHV_OFFICIAL_PARTITION_NAMES
    : (["development", "walk-forward"] as const);
  const bars: Bar[] = [];
  for (const partition of partitions) {
    for (const symbol of FHV_OFFICIAL_SYMBOLS) {
      const barsPath = join(input.datasetRoot, "partitions", partition, symbol, "bars.v1.json");
      bars.push(...parsePartitionBarsFile(barsPath, symbol));
    }
  }
  return mergeFhvSharedPortfolioBarsChronologically(bars);
}

/** @deprecated Use loadOfficialSharedPortfolioBars for multi-symbol shared portfolio replay. */
export function loadOfficialDatasetBars(input: {
  datasetRoot: string;
  includeHoldout: boolean;
  replaySymbol?: (typeof FHV_OFFICIAL_SYMBOLS)[number];
}): Bar[] {
  return loadOfficialSharedPortfolioBars({
    datasetRoot: input.datasetRoot,
    includeHoldout: input.includeHoldout,
  });
}

export function recomputeFhvDatasetQualificationDigests(input: {
  datasetRoot: string;
  manifestPath: string;
  qualificationMode?: FhvQualificationMode;
}): Pick<
  FhvDatasetQualificationReceiptV1,
  "datasetContentDigest" | "manifestSemanticDigest" | "partitionsDigest" | "symbolDigests"
> {
  const body = qualifyFhvOfficialDataset({
    datasetRoot: input.datasetRoot,
    manifestPath: input.manifestPath,
    qualificationMode: input.qualificationMode,
  });
  return {
    datasetContentDigest: body.datasetContentDigest,
    manifestSemanticDigest: body.manifestSemanticDigest,
    partitionsDigest: body.partitionsDigest,
    symbolDigests: body.symbolDigests,
  };
}
