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
import { FHV_GAP_POLICY_V1 } from "@/lib/trader/market-data/dataset/fhv-gap-policy";
import { runIngressManifestEvidenceHarness } from "@/lib/trader/market-data/dataset/ingress-manifest-evidence-harness";
import { assertIngestBarsIntegrity } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

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

export type FhvDatasetQualificationReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_DATASET_QUALIFICATION_RECEIPT_SCHEMA_VERSION;
  classification: "DATASET_QUALIFICATION=PASS" | "DATASET_QUALIFICATION=FAIL";
  datasetRoot: string;
  manifestPath: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  partitionsDigest: string;
  gapPolicyId: string;
  qualifiedAtUtc: string;
  qualificationReceiptDigest: string;
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
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { bars?: Bar[] };
  if (!Array.isArray(parsed.bars) || parsed.bars.length === 0) {
    throw new FhvDatasetQualificationError(
      "PARTITION_BARS_EMPTY",
      `Partition bars file has no bars: ${path}`,
    );
  }
  const expectedSymbol = symbolToBarFormat(symbol);
  return parsed.bars.map((bar) => ({
    ...bar,
    symbol: expectedSymbol,
    interval: "1m" as const,
  }));
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

export function qualifyFhvOfficialDataset(input: {
  datasetRoot: string;
  manifestPath: string;
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

  const allBars: Bar[] = [];
  for (const partition of FHV_OFFICIAL_PARTITION_NAMES) {
    const interval = resolvePartitionInterval(partition);
    for (const symbol of FHV_OFFICIAL_SYMBOLS) {
      const barsPath = join(datasetRoot, "partitions", partition, symbol, "bars.v1.json");
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
      allBars.push(...bars);
    }
  }

  allBars.sort((left, right) => Date.parse(left.barOpenTime) - Date.parse(right.barOpenTime));
  const datasetContentDigest = computeBarSetDigest(allBars);
  const manifestSemanticDigest = manifest.manifestSemanticDigest;
  const partitionsDigest = computeStableJsonDigest(FHV_DATASET_PARTITIONS_V1);

  if (manifest.barSetDigest !== datasetContentDigest) {
    throw new FhvDatasetQualificationError(
      "DATASET_CONTENT_DIGEST_MISMATCH",
      "Manifest barSetDigest does not match computed datasetContentDigest.",
    );
  }

  return {
    schemaVersion: FHV_DATASET_QUALIFICATION_RECEIPT_SCHEMA_VERSION,
    classification: "DATASET_QUALIFICATION=PASS",
    datasetRoot,
    manifestPath,
    datasetContentDigest,
    manifestSemanticDigest,
    partitionsDigest,
    gapPolicyId: FHV_GAP_POLICY_V1.policyId,
  };
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
    datasetRoot: harness.fixturePath,
    manifestPath: harness.fixturePath,
    datasetContentDigest,
    manifestSemanticDigest,
    partitionsDigest,
    gapPolicyId: harness.gapPolicy.policyId,
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

export function writeFhvDatasetQualificationReceiptAtomic(input: {
  receiptDir: string;
  datasetRoot: string;
  manifestPath: string;
  boundedFixture?: boolean;
}): FhvDatasetQualificationReceiptV1 {
  mkdirSync(input.receiptDir, { recursive: true });
  const receiptPath = join(input.receiptDir, FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME);
  if (existsSync(receiptPath)) {
    return readFhvDatasetQualificationReceipt(receiptPath);
  }

  const body = input.boundedFixture
    ? qualifyFhvBoundedFixtureDataset()
    : qualifyFhvOfficialDataset({
        datasetRoot: input.datasetRoot,
        manifestPath: input.manifestPath,
      });

  const receipt = buildFhvDatasetQualificationReceipt({
    ...body,
    qualifiedAtUtc: new Date().toISOString(),
  });
  const json = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileAtomicExclusive(receiptPath, json);
  if (computeRawSha256(json) === receipt.qualificationReceiptDigest) {
    // raw sha256 differs from semantic digest; both are tracked where needed
  }
  return receipt;
}

export function loadOfficialDatasetBars(input: {
  datasetRoot: string;
  includeHoldout: boolean;
  replaySymbol?: (typeof FHV_OFFICIAL_SYMBOLS)[number];
}): Bar[] {
  const replaySymbol = input.replaySymbol ?? "BTCUSDT";
  const partitions = input.includeHoldout
    ? FHV_OFFICIAL_PARTITION_NAMES
    : (["development", "walk-forward"] as const);
  const bars: Bar[] = [];
  for (const partition of partitions) {
    const barsPath = join(input.datasetRoot, "partitions", partition, replaySymbol, "bars.v1.json");
    bars.push(...parsePartitionBarsFile(barsPath, replaySymbol));
  }
  bars.sort((left, right) => Date.parse(left.barOpenTime) - Date.parse(right.barOpenTime));
  return bars;
}
