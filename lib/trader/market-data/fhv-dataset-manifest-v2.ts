import { join } from "node:path";

import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type {
  FhvOfficialPartitionName,
  FhvOfficialSymbolCode,
  FhvUtcHalfOpenInterval,
} from "@/lib/trader/market-data/fhv-partition-boundaries";

export const FHV_DATASET_MANIFEST_V2_SCHEMA_VERSION = "fhv-dataset-manifest/v2" as const;
export const FHV_DATASET_MANIFEST_V2_FILENAME = "fhv-dataset-manifest.v2.json" as const;
export const FHV_DATASET_SEAL_RECEIPT_V2_FILENAME = "fhv-dataset-seal-receipt.v2.json" as const;
export const FHV_BAR_FILE_FORMAT_V2 = "bars.v2.ndjson" as const;
export const FHV_BAR_RECORD_SCHEMA_VERSION = "fhv-bars-v2-record/v1" as const;
export const FHV_DATASET_DIGEST_SCHEMA_VERSION = "1.0.0" as const;

export type FhvDatasetManifestV2PartitionEntry = Readonly<{
  partition: FhvOfficialPartitionName;
  symbol: FhvOfficialSymbolCode;
  startUtc: string;
  endUtc: string;
  filePath: string;
  byteSize: number;
  rawSha256: string;
  semanticDigest: string;
  expectedBarCount: number;
  actualBarCount: number;
  firstBarOpen: string;
  lastBarClose: string;
  gapEvidenceDigest: string;
  partitionDigest: string;
}>;

export type FhvDatasetManifestV2 = Readonly<{
  schemaVersion: typeof FHV_DATASET_MANIFEST_V2_SCHEMA_VERSION;
  barFileFormat: typeof FHV_BAR_FILE_FORMAT_V2;
  barRecordSchemaVersion: typeof FHV_BAR_RECORD_SCHEMA_VERSION;
  datasetDigestSchemaVersion: typeof FHV_DATASET_DIGEST_SCHEMA_VERSION;
  writerVersion: string;
  minimumReaderVersion: string;
  provider: "HTX";
  marketType: "SPOT";
  interval: "1m";
  sourceLogicalDatasetDigest: string;
  supersedesManifestDigest?: string;
  sourceCapabilityReceiptDigest: string;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  intervalBoundaries: FhvUtcHalfOpenInterval;
  partitions: readonly FhvDatasetManifestV2PartitionEntry[];
  symbolDigests: Readonly<Record<FhvOfficialSymbolCode, string>>;
  datasetContentDigest: string;
  holdoutSealDigest: string;
  manifestSemanticDigest: string;
}>;

export type FhvDatasetSealReceiptV2 = Readonly<{
  schemaVersion: "fhv-dataset-seal-receipt/v2";
  manifestPath: string;
  manifestSemanticDigest: string;
  datasetContentDigest: string;
  sourceCapabilityReceiptDigest: string;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  sealedAtUtc: string;
  sealReceiptDigest: string;
}>;

export function computeFhvDatasetManifestV2SemanticDigest(
  manifest: Omit<FhvDatasetManifestV2, "manifestSemanticDigest">,
): string {
  return computeStableJsonDigest(manifest);
}

export function computeFhvDatasetSealReceiptDigest(
  receipt: Omit<FhvDatasetSealReceiptV2, "sealReceiptDigest">,
): string {
  return computeStableJsonDigest(receipt);
}

export function resolveFhvDatasetManifestV2Path(datasetRoot: string): string {
  return join(datasetRoot, FHV_DATASET_MANIFEST_V2_FILENAME);
}

export function resolveFhvDatasetSealReceiptV2Path(datasetRoot: string): string {
  return join(datasetRoot, FHV_DATASET_SEAL_RECEIPT_V2_FILENAME);
}

export const FHV_INCOMPLETE_UNSEALED_DATASET = "INCOMPLETE_UNSEALED_DATASET" as const;
