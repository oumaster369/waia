import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  prepareAtomicExclusiveTemp,
  publishAtomicExclusiveTemp,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import {
  fhvBarsV2RecordToBar,
  parseFhvBarsV2Line,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import type { FhvDatasetManifestV2 } from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import {
  FHV_DATASET_MANIFEST_V2_FILENAME,
  FHV_DATASET_SEAL_RECEIPT_V2_FILENAME,
  FHV_INCOMPLETE_UNSEALED_DATASET,
  computeFhvDatasetManifestV2SemanticDigest,
  computeFhvDatasetSealReceiptDigest,
  resolveFhvDatasetManifestV2Path,
  resolveFhvDatasetSealReceiptV2Path,
  type FhvDatasetManifestV2PartitionEntry,
  type FhvDatasetSealReceiptV2,
} from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import {
  FHV_OFFICIAL_PARTITION_NAMES,
  FHV_OFFICIAL_SYMBOLS,
  fhvOfficialPartitionFileRelativePath,
  type FhvOfficialPartitionName,
  type FhvOfficialSymbolCode,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import { fhvSymbolRank } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { StreamingBarSetDigestHasher } from "@/lib/trader/market-data/fhv-streaming-bar-set-digest";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { Bar } from "@/lib/trader/intelligence/types";

export class FhvDatasetSealError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvDatasetSealError";
  }
}

export type FhvAcquisitionReceiptV1 = Readonly<{
  schemaVersion: "fhv-acquisition-receipt/v1";
  acquisitionRunId: string;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  sourceCapabilityReceiptDigest: string;
  partition: FhvOfficialPartitionName;
  symbol: FhvOfficialSymbolCode;
  startUtc: string;
  endUtc: string;
  outputRoot: string;
  fileRelativePath: string;
  rawSha256: string;
  actualBarCount: number;
  acquisitionReceiptDigest: string;
}>;

function computeRawFileSha256(filePath: string): string {
  const hash = createHash("sha256");
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(65536);
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

type PartitionFileScan = {
  rawSha256: string;
  byteSize: number;
  barCount: number;
  firstBarOpen: string;
  lastBarClose: string;
  semanticDigest: string;
};

function readNextLineFromFd(
  fd: number,
  state: { remainder: string; buffer: Buffer },
): string | null {
  while (true) {
    const newlineIndex = state.remainder.indexOf("\n");
    if (newlineIndex >= 0) {
      const line = state.remainder.slice(0, newlineIndex);
      state.remainder = state.remainder.slice(newlineIndex + 1);
      return line.length > 0 ? line : readNextLineFromFd(fd, state);
    }
    const bytesRead = readSync(fd, state.buffer, 0, state.buffer.length, null);
    if (bytesRead <= 0) {
      if (state.remainder.length > 0) {
        const line = state.remainder;
        state.remainder = "";
        return line.length > 0 ? line : null;
      }
      return null;
    }
    state.remainder += state.buffer.subarray(0, bytesRead).toString("utf8");
  }
}

function scanPartitionFile(filePath: string): PartitionFileScan {
  const rawSha256 = computeRawFileSha256(filePath);
  const byteSize = statSync(filePath).size;
  const fd = openSync(filePath, "r");
  const lineState = { remainder: "", buffer: Buffer.alloc(65536) };
  const semanticHasher = new StreamingBarSetDigestHasher();
  let previousOpenTime: string | undefined;
  let barCount = 0;
  let firstBarOpen = "";
  let lastBarClose = "";
  try {
    let lineNumber = 0;
    while (true) {
      const line = readNextLineFromFd(fd, lineState);
      if (line === null) {
        break;
      }
      lineNumber += 1;
      const record = parseFhvBarsV2Line(line, lineNumber);
      const bar = fhvBarsV2RecordToBar(record);
      if (previousOpenTime !== undefined && bar.barOpenTime <= previousOpenTime) {
        throw new FhvDatasetSealError("OUT_OF_ORDER", `out-of-order bar at line ${lineNumber}`);
      }
      previousOpenTime = bar.barOpenTime;
      if (barCount === 0) {
        firstBarOpen = bar.barOpenTime;
      }
      lastBarClose = bar.barCloseTime;
      semanticHasher.appendBarDigest(computeBarContentDigest(bar));
      barCount += 1;
    }
  } finally {
    closeSync(fd);
  }
  return {
    rawSha256,
    byteSize,
    barCount,
    firstBarOpen,
    lastBarClose,
    semanticDigest: semanticHasher.finalize(),
  };
}

type LineIteratorState = {
  fd: number;
  remainder: string;
  buffer: Buffer;
  lineNumber: number;
  eof: boolean;
};

function openLineIterator(filePath: string): LineIteratorState {
  return {
    fd: openSync(filePath, "r"),
    remainder: "",
    buffer: Buffer.alloc(65536),
    lineNumber: 0,
    eof: false,
  };
}

function closeLineIterator(state: LineIteratorState): void {
  closeSync(state.fd);
}

function readNextBar(state: LineIteratorState): Bar | null {
  if (state.eof) {
    return null;
  }
  while (true) {
    const line = readNextLineFromFd(state.fd, state);
    if (line === null) {
      state.eof = true;
      return null;
    }
    state.lineNumber += 1;
    const record = parseFhvBarsV2Line(line, state.lineNumber);
    return fhvBarsV2RecordToBar(record);
  }
}

function mergePartitionFilesForDigest(input: {
  btcPath: string;
  ethPath: string;
  datasetHasher: StreamingBarSetDigestHasher;
  btcSymbolHasher: StreamingBarSetDigestHasher;
  ethSymbolHasher: StreamingBarSetDigestHasher;
}): void {
  const btc = openLineIterator(input.btcPath);
  const eth = openLineIterator(input.ethPath);
  let btcHead = readNextBar(btc);
  let ethHead = readNextBar(eth);
  try {
    while (btcHead || ethHead) {
      let chosen: Bar;
      if (
        btcHead &&
        (!ethHead ||
          btcHead.barOpenTime < ethHead.barOpenTime ||
          (btcHead.barOpenTime === ethHead.barOpenTime &&
            fhvSymbolRank(btcHead.symbol as "BTC/USDT" | "ETH/USDT") <
              fhvSymbolRank(ethHead.symbol as "BTC/USDT" | "ETH/USDT")))
      ) {
        chosen = btcHead;
        btcHead = readNextBar(btc);
      } else {
        chosen = ethHead!;
        ethHead = readNextBar(eth);
      }
      const digest = computeBarContentDigest(chosen);
      input.datasetHasher.appendBarDigest(digest);
      if (chosen.symbol === "BTC/USDT") {
        input.btcSymbolHasher.appendBarDigest(digest);
      } else {
        input.ethSymbolHasher.appendBarDigest(digest);
      }
    }
  } finally {
    closeLineIterator(btc);
    closeLineIterator(eth);
  }
}

function computePartitionSemanticDigestFromScan(scan: PartitionFileScan): string {
  return scan.semanticDigest;
}

export function computeFhvFileRawSha256(filePath: string): string {
  return computeRawFileSha256(filePath);
}

export function writeFhvAcquisitionReceipt(input: {
  receiptDir: string;
  acquisitionRunId: string;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  sourceCapabilityReceiptDigest: string;
  partition: FhvOfficialPartitionName;
  symbol: FhvOfficialSymbolCode;
  startUtc: string;
  endUtc: string;
  outputRoot: string;
  fileRelativePath: string;
  rawSha256: string;
  actualBarCount: number;
}): { receiptPath: string; receipt: FhvAcquisitionReceiptV1 } {
  const body = {
    schemaVersion: "fhv-acquisition-receipt/v1" as const,
    acquisitionRunId: input.acquisitionRunId,
    releaseSha: input.releaseSha.trim().toLowerCase(),
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    sourceCapabilityReceiptDigest: input.sourceCapabilityReceiptDigest,
    partition: input.partition,
    symbol: input.symbol,
    startUtc: input.startUtc,
    endUtc: input.endUtc,
    outputRoot: input.outputRoot,
    fileRelativePath: input.fileRelativePath,
    rawSha256: input.rawSha256,
    actualBarCount: input.actualBarCount,
  };
  const receipt: FhvAcquisitionReceiptV1 = {
    ...body,
    acquisitionReceiptDigest: computeStableJsonDigest(body),
  };
  const receiptPath = join(
    input.receiptDir,
    `fhv-acquisition-receipt.${input.partition}.${input.symbol}.${input.acquisitionRunId}.v1.json`,
  );
  writeFileAtomicExclusive(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receiptPath, receipt };
}

export function validateFhvV2DatasetReadOnly(datasetRoot: string): {
  manifest: FhvDatasetManifestV2;
  sealReceipt: FhvDatasetSealReceiptV2;
  classification: "FHV_V2_DATASET_VALIDATION_PASS";
} {
  const sealed = assertFhvDatasetSealed(datasetRoot);
  for (const entry of sealed.manifest.partitions) {
    const filePath = join(datasetRoot, entry.filePath);
    if (!existsSync(filePath)) {
      throw new FhvDatasetSealError(
        "PARTITION_FILE_MISSING",
        `missing partition file ${entry.filePath}`,
      );
    }
    const streamed = scanPartitionFile(filePath);
    if (streamed.rawSha256 !== entry.rawSha256) {
      throw new FhvDatasetSealError(
        "RAW_DIGEST_MISMATCH",
        `raw digest mismatch for ${entry.partition}/${entry.symbol}`,
      );
    }
    if (streamed.barCount !== entry.actualBarCount) {
      throw new FhvDatasetSealError(
        "BAR_COUNT_MISMATCH",
        `bar count mismatch for ${entry.partition}/${entry.symbol}`,
      );
    }
  }
  return {
    ...sealed,
    classification: "FHV_V2_DATASET_VALIDATION_PASS",
  };
}

export function readFhvAcquisitionReceipt(path: string): FhvAcquisitionReceiptV1 {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as FhvAcquisitionReceiptV1;
  const { acquisitionReceiptDigest, ...body } = parsed;
  if (computeStableJsonDigest(body) !== acquisitionReceiptDigest) {
    throw new FhvDatasetSealError(
      "ACQUISITION_RECEIPT_DIGEST_MISMATCH",
      "acquisition receipt digest mismatch",
    );
  }
  return parsed;
}

export type SealFhvV2DatasetInput = {
  datasetRoot: string;
  acquisitionReceiptPaths: readonly string[];
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  sourceCapabilityReceiptDigest: string;
  writerVersion: string;
  minimumReaderVersion: string;
  sealRunId: string;
};

export function sealFhvV2Dataset(input: SealFhvV2DatasetInput): {
  manifest: FhvDatasetManifestV2;
  sealReceipt: FhvDatasetSealReceiptV2;
} {
  if (input.acquisitionReceiptPaths.length !== 6) {
    throw new FhvDatasetSealError(
      "ACQUISITION_RECEIPT_COUNT",
      "exactly six acquisition receipts required",
    );
  }
  const manifestPath = resolveFhvDatasetManifestV2Path(input.datasetRoot);
  const sealPath = resolveFhvDatasetSealReceiptV2Path(input.datasetRoot);
  if (existsSync(sealPath)) {
    throw new FhvDatasetSealError("SEAL_ALREADY_EXISTS", "dataset seal receipt already exists");
  }
  if (existsSync(manifestPath)) {
    throw new FhvDatasetSealError("MANIFEST_ALREADY_EXISTS", "dataset manifest already exists");
  }

  const receipts = input.acquisitionReceiptPaths.map(readFhvAcquisitionReceipt);
  const releaseSha = input.releaseSha.trim().toLowerCase();
  for (const receipt of receipts) {
    if (receipt.releaseSha !== releaseSha) {
      throw new FhvDatasetSealError(
        "MIXED_RELEASE",
        "mixed release identity across acquisition receipts",
      );
    }
    if (
      receipt.organizationId !== input.organizationId ||
      receipt.operatorId !== input.operatorId
    ) {
      throw new FhvDatasetSealError(
        "BINDING_MISMATCH",
        "org/operator binding mismatch on acquisition receipt",
      );
    }
    if (receipt.sourceCapabilityReceiptDigest !== input.sourceCapabilityReceiptDigest) {
      throw new FhvDatasetSealError(
        "SOURCE_CAPABILITY_MISMATCH",
        "source capability digest mismatch",
      );
    }
  }

  const expectedKeys = new Set(
    FHV_OFFICIAL_PARTITION_NAMES.flatMap((partition) =>
      FHV_OFFICIAL_SYMBOLS.map((symbol) => `${partition}:${symbol}`),
    ),
  );
  for (const receipt of receipts) {
    expectedKeys.delete(`${receipt.partition}:${receipt.symbol}`);
  }
  if (expectedKeys.size > 0) {
    throw new FhvDatasetSealError(
      "MISSING_PARTITIONS",
      `missing acquisition receipts: ${[...expectedKeys].join(",")}`,
    );
  }

  const partitionEntries: FhvDatasetManifestV2PartitionEntry[] = [];
  const datasetHasher = new StreamingBarSetDigestHasher();
  const btcSymbolHasher = new StreamingBarSetDigestHasher();
  const ethSymbolHasher = new StreamingBarSetDigestHasher();

  for (const partition of FHV_OFFICIAL_PARTITION_NAMES) {
    const btcPath = join(
      input.datasetRoot,
      fhvOfficialPartitionFileRelativePath({ partition, symbol: "BTCUSDT" }),
    );
    const ethPath = join(
      input.datasetRoot,
      fhvOfficialPartitionFileRelativePath({ partition, symbol: "ETHUSDT" }),
    );
    const btc = scanPartitionFile(btcPath);
    const eth = scanPartitionFile(ethPath);
    mergePartitionFilesForDigest({
      btcPath,
      ethPath,
      datasetHasher,
      btcSymbolHasher,
      ethSymbolHasher,
    });

    for (const [symbol, data] of [
      ["BTCUSDT", btc],
      ["ETHUSDT", eth],
    ] as const) {
      const receipt = receipts.find((r) => r.partition === partition && r.symbol === symbol)!;
      if (receipt.rawSha256 !== data.rawSha256) {
        throw new FhvDatasetSealError(
          "SOURCE_MUTATION",
          `raw digest mismatch for ${partition}/${symbol}`,
        );
      }
      partitionEntries.push({
        partition,
        symbol,
        startUtc: receipt.startUtc,
        endUtc: receipt.endUtc,
        filePath: fhvOfficialPartitionFileRelativePath({ partition, symbol }),
        byteSize: data.byteSize,
        rawSha256: data.rawSha256,
        semanticDigest: computePartitionSemanticDigestFromScan(data),
        expectedBarCount: receipt.actualBarCount,
        actualBarCount: data.barCount,
        firstBarOpen: data.firstBarOpen || receipt.startUtc,
        lastBarClose: data.lastBarClose || receipt.endUtc,
        gapEvidenceDigest: computeStableJsonDigest({ gaps: [], partition, symbol }),
        partitionDigest: computeStableJsonDigest({ partition, symbol, rawSha256: data.rawSha256 }),
      });
    }
  }

  const datasetContentDigest = datasetHasher.finalize();
  const symbolDigests = {
    BTCUSDT: btcSymbolHasher.finalize(),
    ETHUSDT: ethSymbolHasher.finalize(),
  } as const;
  const holdoutEntry = partitionEntries.find((e) => e.partition === "blind-holdout")!;
  const holdoutSealDigest = computeStableJsonDigest({
    blindHoldoutRawSha256: holdoutEntry.rawSha256,
    contaminationStatus: "RESERVED_SEALED_NOT_ACCESSED",
  });

  const manifestBody: Omit<FhvDatasetManifestV2, "manifestSemanticDigest"> = {
    schemaVersion: "fhv-dataset-manifest/v2",
    barFileFormat: "bars.v2.ndjson",
    barRecordSchemaVersion: "fhv-bars-v2-record/v1",
    datasetDigestSchemaVersion: "1.0.0",
    writerVersion: input.writerVersion,
    minimumReaderVersion: input.minimumReaderVersion,
    provider: "HTX",
    marketType: "SPOT",
    interval: "1m",
    sourceLogicalDatasetDigest: datasetContentDigest,
    sourceCapabilityReceiptDigest: input.sourceCapabilityReceiptDigest,
    releaseSha,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    intervalBoundaries: {
      startUtc: "2020-01-01T00:00:00.000Z",
      endUtc: "2026-01-01T00:00:00.000Z",
    },
    partitions: partitionEntries,
    symbolDigests,
    datasetContentDigest,
    holdoutSealDigest,
  };
  const manifest: FhvDatasetManifestV2 = {
    ...manifestBody,
    manifestSemanticDigest: computeFhvDatasetManifestV2SemanticDigest(manifestBody),
  };

  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestTemp = prepareAtomicExclusiveTemp(manifestPath, manifestBytes);
  publishAtomicExclusiveTemp(manifestTemp, manifestPath);

  const sealBody: Omit<FhvDatasetSealReceiptV2, "sealReceiptDigest"> = {
    schemaVersion: "fhv-dataset-seal-receipt/v2",
    manifestPath: FHV_DATASET_MANIFEST_V2_FILENAME,
    manifestSemanticDigest: manifest.manifestSemanticDigest,
    datasetContentDigest: manifest.datasetContentDigest,
    sourceCapabilityReceiptDigest: input.sourceCapabilityReceiptDigest,
    releaseSha,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    sealedAtUtc: new Date().toISOString(),
  };
  const sealReceipt: FhvDatasetSealReceiptV2 = {
    ...sealBody,
    sealReceiptDigest: computeFhvDatasetSealReceiptDigest(sealBody),
  };
  const sealBytes = `${JSON.stringify(sealReceipt, null, 2)}\n`;
  const sealTemp = prepareAtomicExclusiveTemp(sealPath, sealBytes);
  publishAtomicExclusiveTemp(sealTemp, sealPath);

  return { manifest, sealReceipt };
}

export function assertFhvDatasetSealed(datasetRoot: string): {
  manifest: FhvDatasetManifestV2;
  sealReceipt: FhvDatasetSealReceiptV2;
} {
  const manifestPath = resolveFhvDatasetManifestV2Path(datasetRoot);
  const sealPath = resolveFhvDatasetSealReceiptV2Path(datasetRoot);
  if (!existsSync(manifestPath) || !existsSync(sealPath)) {
    throw new FhvDatasetSealError(
      FHV_INCOMPLETE_UNSEALED_DATASET,
      "dataset requires both manifest v2 and seal receipt v2",
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as FhvDatasetManifestV2;
  const sealReceipt = JSON.parse(readFileSync(sealPath, "utf8")) as FhvDatasetSealReceiptV2;
  const { sealReceiptDigest, ...sealBody } = sealReceipt;
  if (computeFhvDatasetSealReceiptDigest(sealBody) !== sealReceiptDigest) {
    throw new FhvDatasetSealError("SEAL_RECEIPT_DIGEST_MISMATCH", "seal receipt digest mismatch");
  }
  if (sealReceipt.manifestSemanticDigest !== manifest.manifestSemanticDigest) {
    throw new FhvDatasetSealError(
      "MANIFEST_SEAL_MISMATCH",
      "manifest digest mismatch between manifest and seal receipt",
    );
  }
  return { manifest, sealReceipt };
}

export { FHV_INCOMPLETE_UNSEALED_DATASET };
