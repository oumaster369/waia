import type { Bar } from "@/lib/trader/intelligence/types";
import type { FhvOfficialPartitionName } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

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

/** Stable digest over replay-resumable cursor fields (excludes host/path noise). */
export function computeFhvOfficialDatasetCursorDigest(cursor: FhvOfficialDatasetCursorV2): string {
  return computeStableJsonDigest({
    schemaVersion: cursor.schemaVersion,
    datasetContentDigest: cursor.datasetContentDigest,
    manifestSemanticDigest: cursor.manifestSemanticDigest,
    activePartition: cursor.activePartition,
    globalEventSequence: cursor.globalEventSequence,
    cycleIndex: cursor.cycleIndex,
    btc: {
      partitionIndex: cursor.btc.partitionIndex,
      fileRelativePath: cursor.btc.fileRelativePath,
      byteOffset: cursor.btc.byteOffset,
      lineNumber: cursor.btc.lineNumber,
      recordIndex: cursor.btc.recordIndex,
      lineRemainder: cursor.btc.lineRemainder,
      lookaheadRecordDigest: cursor.btc.lookaheadRecordDigest,
      rollingWindowLength: cursor.btc.rollingWindow.length,
      rollingWindowTailDigest:
        cursor.btc.rollingWindow.length > 0
          ? computeStableJsonDigest(
              cursor.btc.rollingWindow.slice(-Math.min(3, cursor.btc.rollingWindow.length)),
            )
          : null,
    },
    eth: {
      partitionIndex: cursor.eth.partitionIndex,
      fileRelativePath: cursor.eth.fileRelativePath,
      byteOffset: cursor.eth.byteOffset,
      lineNumber: cursor.eth.lineNumber,
      recordIndex: cursor.eth.recordIndex,
      lineRemainder: cursor.eth.lineRemainder,
      lookaheadRecordDigest: cursor.eth.lookaheadRecordDigest,
      rollingWindowLength: cursor.eth.rollingWindow.length,
      rollingWindowTailDigest:
        cursor.eth.rollingWindow.length > 0
          ? computeStableJsonDigest(
              cursor.eth.rollingWindow.slice(-Math.min(3, cursor.eth.rollingWindow.length)),
            )
          : null,
    },
  });
}
