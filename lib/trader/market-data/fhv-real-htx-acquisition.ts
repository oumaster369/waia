import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  writeFileAtomic,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { HtxApiError } from "@/lib/trader/connectors/htx/client";
import { HTX_MARKET_HISTORY_CANDLES_MAX_SIZE } from "@/lib/trader/connectors/htx/config";
import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import {
  FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA,
  FHV_ACQUISITION_RECEIPT_SCHEMA_V2,
} from "@/lib/trader/market-data/fhv-acquisition-evidence-class";
import { assertPathDoesNotAccessBlindHoldoutPayload } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import {
  barToFhvBarsV2Record,
  fhvBarsV2RecordToBar,
  parseFhvBarsV2Line,
  serializeFhvBarsV2Record,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import {
  FhvCanonicalCoverageError,
  proveFhvNdjsonIntervalCoverage,
} from "@/lib/trader/market-data/fhv-canonical-coverage";
import {
  committedByteLengthOf,
  FhvNdjsonBoundedIoError,
  readLastNdjsonRecordAtByteLength,
  truncateFileToCommittedByteLength,
} from "@/lib/trader/market-data/fhv-ndjson-bounded-io";
import { mapHtxKlinesToBars } from "@/lib/trader/market-data/htx-kline-mapper";
import {
  fhvOfficialPartitionFileRelativePath,
  FHV_SYMBOL_CODE_TO_INSTRUMENT,
  resolveFhvCanonicalPartitionInterval,
  type FhvOfficialPartitionName,
  type FhvOfficialSymbolCode,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { Bar } from "@/lib/trader/intelligence/types";

export const FHV_REAL_HTX_ACQUISITION_CURSOR_SCHEMA = "fhv-real-htx-acquisition-cursor/v2" as const;
export const FHV_REAL_BLIND_HOLDOUT_ACQUISITION_NOT_AUTHORIZED =
  "FHV_REAL_BLIND_HOLDOUT_ACQUISITION_NOT_AUTHORIZED" as const;
export const FHV_REAL_HTX_PROVIDER_IDENTITY = "HTX" as const;
export const FHV_REAL_HTX_NORMALIZATION_IDENTITY =
  "htx-kline-mapper/v1+fhv-bars-v2-record/v1" as const;

const ONE_MINUTE_SECONDS = 60;
const ONE_MINUTE_MS = 60_000;

export class FhvRealHtxAcquisitionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvRealHtxAcquisitionError";
  }
}

export type FhvRealHtxPageFetcher = (input: {
  symbol: string;
  period: "1min";
  size: number;
  from: number;
  to: number;
}) => Promise<HtxKlineRow[]>;

export type FhvRealHtxAcquisitionCursorV1 = Readonly<{
  schemaVersion: typeof FHV_REAL_HTX_ACQUISITION_CURSOR_SCHEMA;
  acquisitionRunId: string;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  partition: FhvOfficialPartitionName;
  symbol: FhvOfficialSymbolCode;
  nextProviderTimestampSeconds: number;
  lastCommittedBarOpenTime: string | null;
  lastCommittedBarContentDigest: string | null;
  pageCount: number;
  retryCount: number;
  committedBarCount: number;
  committedByteLength: number;
  status: "IN_PROGRESS" | "COMPLETED" | "BLOCKED";
  blockedReason?: string;
}>;

export type FhvAcquisitionReceiptV2 = Readonly<{
  schemaVersion: typeof FHV_ACQUISITION_RECEIPT_SCHEMA_V2;
  evidenceClass: typeof FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA;
  providerIdentity: typeof FHV_REAL_HTX_PROVIDER_IDENTITY;
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
  semanticContentDigest: string;
  actualBarCount: number;
  firstBarOpen: string;
  lastBarClose: string;
  gapDuplicateIntegrity: "PASS";
  normalizationIdentity: typeof FHV_REAL_HTX_NORMALIZATION_IDENTITY;
  pageCount: number;
  retryCount: number;
  acquisitionReceiptDigest: string;
}>;

function blocked(code: string, message: string): never {
  throw new FhvRealHtxAcquisitionError(`QUALIFICATION_BLOCKED_${code}`, message);
}

export function assertRealHtxPartitionAuthorized(partition: FhvOfficialPartitionName): void {
  if (partition === "blind-holdout") {
    throw new FhvRealHtxAcquisitionError(
      FHV_REAL_BLIND_HOLDOUT_ACQUISITION_NOT_AUTHORIZED,
      "Real HTX blind-holdout acquisition is not authorized in this task.",
    );
  }
}

export function fhvRealHtxCursorPath(input: {
  datasetRoot: string;
  partition: FhvOfficialPartitionName;
  symbol: FhvOfficialSymbolCode;
  acquisitionRunId: string;
}): string {
  return join(
    input.datasetRoot,
    "control",
    "acquisition",
    `fhv-real-htx-cursor.${input.partition}.${input.symbol}.${input.acquisitionRunId}.v1.json`,
  );
}

export function fhvRealHtxReceiptPath(input: {
  datasetRoot: string;
  partition: FhvOfficialPartitionName;
  symbol: FhvOfficialSymbolCode;
  acquisitionRunId: string;
}): string {
  return join(
    input.datasetRoot,
    "control",
    "acquisition",
    `fhv-acquisition-receipt.${input.partition}.${input.symbol}.${input.acquisitionRunId}.v2.json`,
  );
}

function writeCursorAtomic(path: string, cursor: FhvRealHtxAcquisitionCursorV1): void {
  mkdirSync(dirname(path), { recursive: true });
  const payload = `${JSON.stringify(cursor, null, 2)}\n`;
  if (existsSync(path)) {
    writeFileAtomic(path, payload);
    return;
  }
  writeFileAtomicExclusive(path, payload);
}

function readCursor(path: string): FhvRealHtxAcquisitionCursorV1 | null {
  if (!existsSync(path)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as FhvRealHtxAcquisitionCursorV1;
  if (parsed.schemaVersion !== FHV_REAL_HTX_ACQUISITION_CURSOR_SCHEMA) {
    blocked(
      "CURSOR_SCHEMA_UNSUPPORTED",
      `resume requires ${FHV_REAL_HTX_ACQUISITION_CURSOR_SCHEMA}`,
    );
  }
  if (typeof parsed.committedByteLength !== "number") {
    blocked("CURSOR_SCHEMA_UNSUPPORTED", "resume cursor missing committedByteLength");
  }
  return parsed;
}

function fsyncFile(path: string): void {
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function lastNdjsonLineAtCursor(filePath: string, committedByteLength: number): string | null {
  try {
    return readLastNdjsonRecordAtByteLength(filePath, committedByteLength);
  } catch (error) {
    if (error instanceof FhvNdjsonBoundedIoError) {
      blocked(error.code, error.message);
    }
    throw error;
  }
}

function restoreCommittedTail(filePath: string, cursor: FhvRealHtxAcquisitionCursorV1): void {
  try {
    truncateFileToCommittedByteLength(filePath, cursor.committedByteLength);
  } catch (error) {
    if (error instanceof FhvNdjsonBoundedIoError) {
      blocked(error.code, error.message);
    }
    throw error;
  }
  if (cursor.committedBarCount === 0) {
    if (cursor.committedByteLength !== 0) {
      blocked("CURSOR_FILE_DIVERGENCE", "zero bars but non-zero committed byte length");
    }
    return;
  }
  const lastLine = lastNdjsonLineAtCursor(filePath, cursor.committedByteLength);
  if (!lastLine) {
    blocked("CURSOR_FILE_DIVERGENCE", "committed tail is empty");
  }
  const bar = fhvBarsV2RecordToBar(parseFhvBarsV2Line(lastLine, cursor.committedBarCount));
  const digest = computeBarContentDigest(bar);
  if (bar.barOpenTime !== cursor.lastCommittedBarOpenTime) {
    blocked(
      "RESUME_TAIL_MISMATCH",
      `durable tail open ${bar.barOpenTime} != cursor ${String(cursor.lastCommittedBarOpenTime)}`,
    );
  }
  if (digest !== cursor.lastCommittedBarContentDigest) {
    blocked("RESUME_TAIL_MISMATCH", "durable tail content digest does not match cursor");
  }
}

export function readFhvAcquisitionReceiptV2(path: string): FhvAcquisitionReceiptV2 {
  assertPathDoesNotAccessBlindHoldoutPayload(path);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as FhvAcquisitionReceiptV2;
  if (parsed.schemaVersion !== FHV_ACQUISITION_RECEIPT_SCHEMA_V2) {
    throw new FhvRealHtxAcquisitionError(
      "ACQUISITION_RECEIPT_SCHEMA_UNSUPPORTED",
      `schema ${String(parsed.schemaVersion)} != ${FHV_ACQUISITION_RECEIPT_SCHEMA_V2}`,
    );
  }
  if (parsed.evidenceClass !== FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA) {
    throw new FhvRealHtxAcquisitionError(
      "ACQUISITION_EVIDENCE_NOT_REAL_PROVIDER_DATA",
      `receipt evidenceClass ${parsed.evidenceClass} is not real provider data`,
    );
  }
  const { acquisitionReceiptDigest, ...body } = parsed;
  if (computeStableJsonDigest(body) !== acquisitionReceiptDigest) {
    throw new FhvRealHtxAcquisitionError(
      "ACQUISITION_RECEIPT_DIGEST_MISMATCH",
      "real acquisition receipt digest mismatch",
    );
  }
  return parsed;
}

function mapAndFilterPage(input: {
  rows: readonly HtxKlineRow[];
  instrument: "BTC/USDT" | "ETH/USDT";
  startMs: number;
  endMs: number;
}): Bar[] {
  const chronological = [...input.rows].sort((left, right) => left.id - right.id);
  const mapped = mapHtxKlinesToBars(input.instrument, chronological, "1m");
  return mapped.filter((bar) => {
    const openMs = Date.parse(bar.barOpenTime);
    if (!Number.isFinite(openMs)) {
      blocked("MALFORMED_RESPONSE", `non-finite barOpenTime ${bar.barOpenTime}`);
    }
    return openMs >= input.startMs && openMs < input.endMs;
  });
}

export async function acquireFhvRealHtxPartition(input: {
  datasetRoot: string;
  partition: Exclude<FhvOfficialPartitionName, "blind-holdout">;
  symbol: FhvOfficialSymbolCode;
  acquisitionRunId: string;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  sourceCapabilityReceiptDigest: string;
  fetchPage: FhvRealHtxPageFetcher;
  pageSize?: number;
  interruptAfterPages?: number;
  /**
   * Test/resume helper. Must lie inside the canonical partition interval.
   * Production CLI never passes this — it always acquires the canonical range.
   */
  intervalOverride?: { startUtc: string; endUtc: string };
}): Promise<{ receipt: FhvAcquisitionReceiptV2; receiptPath: string; fileRelativePath: string }> {
  assertRealHtxPartitionAuthorized(input.partition);
  const canonical = resolveFhvCanonicalPartitionInterval(input.partition);
  const interval = input.intervalOverride ?? canonical;
  if (
    Date.parse(interval.startUtc) < Date.parse(canonical.startUtc) ||
    Date.parse(interval.endUtc) > Date.parse(canonical.endUtc) ||
    Date.parse(interval.startUtc) >= Date.parse(interval.endUtc)
  ) {
    throw new FhvRealHtxAcquisitionError(
      "QUALIFICATION_BLOCKED_INTERVAL_OUTSIDE_PARTITION",
      "requested interval must be a non-empty subset of the canonical partition",
    );
  }
  const startMs = Date.parse(interval.startUtc);
  const endMs = Date.parse(interval.endUtc);
  const startSeconds = Math.floor(startMs / 1000);
  const endSeconds = Math.floor(endMs / 1000);
  const instrument = FHV_SYMBOL_CODE_TO_INSTRUMENT[input.symbol];
  const htxSymbol = internalSymbolToHtx(instrument);
  const relativePath = fhvOfficialPartitionFileRelativePath({
    partition: input.partition,
    symbol: input.symbol,
  });
  const absolutePath = join(input.datasetRoot, relativePath);
  assertPathDoesNotAccessBlindHoldoutPayload(absolutePath);
  const cursorPath = fhvRealHtxCursorPath(input);
  const receiptPath = fhvRealHtxReceiptPath(input);
  mkdirSync(dirname(absolutePath), { recursive: true });
  mkdirSync(dirname(cursorPath), { recursive: true });

  if (existsSync(receiptPath)) {
    const existing = readFhvAcquisitionReceiptV2(receiptPath);
    throw new FhvRealHtxAcquisitionError(
      "QUALIFICATION_BLOCKED_IMMUTABLE_COMPLETED_OVERWRITE",
      `completed acquisition receipt already exists for ${input.partition}/${input.symbol}: ${existing.rawSha256}`,
    );
  }

  let cursor = readCursor(cursorPath);
  if (cursor?.status === "COMPLETED") {
    throw new FhvRealHtxAcquisitionError(
      "QUALIFICATION_BLOCKED_IMMUTABLE_COMPLETED_OVERWRITE",
      "completed cursor cannot be silently overwritten",
    );
  }
  if (cursor?.status === "BLOCKED") {
    blocked(cursor.blockedReason ?? "PRIOR_BLOCK", "prior acquisition is blocked");
  }
  if (
    cursor &&
    (cursor.acquisitionRunId !== input.acquisitionRunId ||
      cursor.releaseSha !== input.releaseSha.trim().toLowerCase() ||
      cursor.organizationId !== input.organizationId ||
      cursor.operatorId !== input.operatorId ||
      cursor.partition !== input.partition ||
      cursor.symbol !== input.symbol)
  ) {
    blocked("ACQUISITION_IDENTITY_MISMATCH", "resume cursor identity does not match this run");
  }

  if (!cursor) {
    cursor = {
      schemaVersion: FHV_REAL_HTX_ACQUISITION_CURSOR_SCHEMA,
      acquisitionRunId: input.acquisitionRunId,
      releaseSha: input.releaseSha.trim().toLowerCase(),
      organizationId: input.organizationId,
      operatorId: input.operatorId,
      partition: input.partition,
      symbol: input.symbol,
      nextProviderTimestampSeconds: startSeconds,
      lastCommittedBarOpenTime: null,
      lastCommittedBarContentDigest: null,
      pageCount: 0,
      retryCount: 0,
      committedBarCount: 0,
      committedByteLength: 0,
      status: "IN_PROGRESS",
    };
    if (!existsSync(absolutePath)) {
      writeFileAtomicExclusive(absolutePath, "");
    }
    writeCursorAtomic(cursorPath, cursor);
  } else {
    if (cursor.schemaVersion !== FHV_REAL_HTX_ACQUISITION_CURSOR_SCHEMA) {
      blocked(
        "CURSOR_SCHEMA_UNSUPPORTED",
        `resume requires ${FHV_REAL_HTX_ACQUISITION_CURSOR_SCHEMA}`,
      );
    }
    restoreCommittedTail(absolutePath, cursor);
  }

  const pageSize = Math.min(
    input.pageSize ?? HTX_MARKET_HISTORY_CANDLES_MAX_SIZE,
    HTX_MARKET_HISTORY_CANDLES_MAX_SIZE,
  );
  let lastOpenMs =
    cursor.lastCommittedBarOpenTime != null ? Date.parse(cursor.lastCommittedBarOpenTime) : null;

  while (cursor.nextProviderTimestampSeconds < endSeconds) {
    if (input.interruptAfterPages != null && cursor.pageCount >= input.interruptAfterPages) {
      throw new FhvRealHtxAcquisitionError(
        "TEST_INTERRUPT",
        `interrupted after ${cursor.pageCount} pages`,
      );
    }
    let rows: HtxKlineRow[];
    try {
      rows = await input.fetchPage({
        symbol: htxSymbol,
        period: "1min",
        size: pageSize,
        from: cursor.nextProviderTimestampSeconds,
        to: endSeconds - 1,
      });
    } catch (error) {
      cursor = { ...cursor, retryCount: cursor.retryCount + 1 };
      writeCursorAtomic(cursorPath, cursor);
      if (error instanceof HtxApiError || error instanceof FhvRealHtxAcquisitionError) {
        blocked("RETRY_EXHAUSTED", error instanceof Error ? error.message : String(error));
      }
      blocked("MALFORMED_RESPONSE", error instanceof Error ? error.message : String(error));
    }
    cursor = { ...cursor, pageCount: cursor.pageCount + 1 };

    if (rows.length === 0) {
      cursor = {
        ...cursor,
        status: "BLOCKED",
        blockedReason: "SOURCE_EXHAUSTED",
      };
      writeCursorAtomic(cursorPath, cursor);
      blocked("SOURCE_EXHAUSTED", `empty provider page before ${interval.endUtc}`);
    }

    const ids = rows.map((row) => row.id);
    const maxId = Math.max(...ids);
    const minId = Math.min(...ids);
    if (minId < cursor.nextProviderTimestampSeconds - ONE_MINUTE_SECONDS) {
      blocked(
        "NON_MONOTONIC_PAGING",
        "provider page included timestamps before the requested cursor",
      );
    }
    if (maxId < cursor.nextProviderTimestampSeconds) {
      cursor = {
        ...cursor,
        status: "BLOCKED",
        blockedReason: "PAGING_STALL",
      };
      writeCursorAtomic(cursorPath, cursor);
      blocked("PAGING_STALL", "provider page did not advance the cursor");
    }

    const filtered = mapAndFilterPage({
      rows,
      instrument,
      startMs,
      endMs,
    });
    const committedLines: string[] = [];
    for (const bar of filtered) {
      if (bar.symbol !== instrument || bar.interval !== "1m") {
        blocked("MAPPING_IDENTITY", "mapped bar symbol/interval mismatch");
      }
      const openMs = Date.parse(bar.barOpenTime);
      const closeMs = Date.parse(bar.barCloseTime);
      if (closeMs !== openMs + ONE_MINUTE_MS) {
        blocked("UTC_OPEN_CLOSE", "bar close must be open+60s");
      }
      const digest = computeBarContentDigest(bar);
      if (lastOpenMs != null) {
        const delta = openMs - lastOpenMs;
        if (delta === 0) {
          if (digest === cursor.lastCommittedBarContentDigest) {
            continue;
          }
          blocked("CONFLICTING_DUPLICATE", `conflicting payload at ${bar.barOpenTime}`);
        }
        if (delta < 0) {
          blocked("NON_MONOTONIC_BARS", `bar open ${bar.barOpenTime} is not after last committed`);
        }
        if (delta !== ONE_MINUTE_MS) {
          blocked("GAP", `1m gap at ${bar.barOpenTime} (deltaMs=${delta})`);
        }
      }
      committedLines.push(serializeFhvBarsV2Record(barToFhvBarsV2Record(bar)));
      lastOpenMs = openMs;
      cursor = {
        ...cursor,
        lastCommittedBarOpenTime: bar.barOpenTime,
        lastCommittedBarContentDigest: digest,
        committedBarCount: cursor.committedBarCount + 1,
      };
    }

    if (committedLines.length > 0) {
      appendFileSync(absolutePath, committedLines.join(""), "utf8");
      fsyncFile(absolutePath);
      cursor = {
        ...cursor,
        committedByteLength: committedByteLengthOf(absolutePath),
      };
    }

    const nextFrom = maxId + ONE_MINUTE_SECONDS;
    if (nextFrom <= cursor.nextProviderTimestampSeconds) {
      cursor = {
        ...cursor,
        status: "BLOCKED",
        blockedReason: "PAGING_STALL",
      };
      writeCursorAtomic(cursorPath, cursor);
      blocked("PAGING_STALL", "cursor did not advance after a non-empty page");
    }
    cursor = {
      ...cursor,
      nextProviderTimestampSeconds: Math.min(nextFrom, endSeconds),
      status: "IN_PROGRESS",
    };
    writeCursorAtomic(cursorPath, cursor);
  }

  if (cursor.committedBarCount <= 0) {
    blocked("EMPTY_OUTPUT", "no bars committed for the requested interval");
  }

  let coverage;
  try {
    coverage = proveFhvNdjsonIntervalCoverage({
      filePath: absolutePath,
      expectedStartUtc: interval.startUtc,
      expectedEndUtc: interval.endUtc,
      expectedSymbol: instrument,
    });
  } catch (error) {
    if (error instanceof FhvCanonicalCoverageError) {
      blocked(error.code, error.message);
    }
    throw error;
  }
  if (coverage.barCount !== cursor.committedBarCount) {
    blocked(
      "EXACT_COUNT_MISMATCH",
      `cursor committed ${cursor.committedBarCount} but file proved ${coverage.barCount}`,
    );
  }
  const rawSha256 = coverage.rawSha256;
  if (!rawSha256) {
    blocked("EMPTY_OUTPUT", "raw digest missing after coverage proof");
  }

  const body = {
    schemaVersion: FHV_ACQUISITION_RECEIPT_SCHEMA_V2,
    evidenceClass: FHV_ACQUISITION_EVIDENCE_REAL_PROVIDER_DATA,
    providerIdentity: FHV_REAL_HTX_PROVIDER_IDENTITY,
    acquisitionRunId: input.acquisitionRunId,
    releaseSha: input.releaseSha.trim().toLowerCase(),
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    sourceCapabilityReceiptDigest: input.sourceCapabilityReceiptDigest,
    partition: input.partition,
    symbol: input.symbol,
    startUtc: interval.startUtc,
    endUtc: interval.endUtc,
    outputRoot: input.datasetRoot,
    fileRelativePath: relativePath,
    rawSha256,
    semanticContentDigest: coverage.semanticContentDigest,
    actualBarCount: coverage.barCount,
    firstBarOpen: coverage.firstBarOpen,
    lastBarClose: coverage.lastBarClose,
    gapDuplicateIntegrity: "PASS" as const,
    normalizationIdentity: FHV_REAL_HTX_NORMALIZATION_IDENTITY,
    pageCount: cursor.pageCount,
    retryCount: cursor.retryCount,
  };
  const receipt: FhvAcquisitionReceiptV2 = {
    ...body,
    acquisitionReceiptDigest: computeStableJsonDigest(body),
  };
  writeFileAtomicExclusive(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  writeCursorAtomic(cursorPath, { ...cursor, status: "COMPLETED" });
  return { receipt, receiptPath, fileRelativePath: relativePath };
}
