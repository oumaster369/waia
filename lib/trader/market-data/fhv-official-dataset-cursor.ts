import type { Bar } from "@/lib/trader/intelligence/types";
import type { FhvOfficialPartitionName } from "@/lib/trader/market-data/fhv-partition-boundaries";

export const FHV_OFFICIAL_DATASET_CURSOR_SCHEMA_VERSION = "fhv-official-dataset-cursor/v2" as const;

export type FhvOfficialDatasetStreamCursor = Readonly<{
  partitionIndex: number;
  fileRelativePath: string;
  byteOffset: number;
  lineNumber: number;
  recordIndex: number;
  lineRemainder: string;
  lookaheadRecord: Bar | null;
  lookaheadRecordDigest: string | null;
  rollingWindow: readonly Bar[];
}>;

export type FhvOfficialDatasetCursorV2 = Readonly<{
  schemaVersion: typeof FHV_OFFICIAL_DATASET_CURSOR_SCHEMA_VERSION;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  activePartition: FhvOfficialPartitionName;
  globalEventSequence: number;
  cycleIndex: number;
  btc: FhvOfficialDatasetStreamCursor;
  eth: FhvOfficialDatasetStreamCursor;
}>;
