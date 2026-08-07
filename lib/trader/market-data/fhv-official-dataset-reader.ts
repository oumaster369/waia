import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { join, resolve } from "node:path";

import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import {
  fhvBarsV2RecordToBar,
  parseFhvBarsV2Line,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { assertFhvDatasetSealed } from "@/lib/trader/market-data/fhv-dataset-seal";
import type { FhvDatasetManifestV2 } from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import type { FhvOfficialDatasetCursorV2 } from "@/lib/trader/market-data/fhv-official-dataset-cursor";
import { FHV_OFFICIAL_DATASET_CURSOR_SCHEMA_VERSION } from "@/lib/trader/market-data/fhv-official-dataset-cursor";
import {
  fhvSymbolRank,
  type FhvOfficialPartitionName,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import {
  buildFhvSourceFrontier,
  type FhvSourceFrontier,
} from "@/lib/trader/market-data/fhv-source-frontier";
import type { BarReplayNextResult, BarReplaySource } from "@/lib/trader/market-data/types";
import type { Bar } from "@/lib/trader/intelligence/types";

export const FHV_READER_MAX_LINE_BYTES = 65_536;
export const FHV_READER_BUFFER_BYTES = 65_536;
export const FHV_READER_MAX_OPEN_FDS = 16;

export type FhvHoldoutAccessPurpose =
  | "CUSTODY_ACQUISITION"
  | "INTEGRITY_QUALIFICATION"
  | "CONTROL_REPLAY_STRATEGY"
  | "FULL_VALIDATION_STRATEGY";

export type FhvHoldoutAccessCounters = Readonly<{
  custodyBytesRead: number;
  integrityBytesRead: number;
  controlReplayStrategyBytesRead: number;
  fullStrategyBytesRead: number;
}>;

export class FhvOfficialDatasetReaderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvOfficialDatasetReaderError";
  }
}

function quoteFromBar(bar: Bar) {
  return {
    symbol: bar.symbol,
    bid: bar.close,
    ask: bar.close,
    last: bar.close,
    timestamp: bar.barCloseTime,
  };
}

type StreamState = {
  fd: number;
  fileRelativePath: string;
  byteOffset: number;
  lineNumber: number;
  recordIndex: number;
  lookahead: Bar | null;
  lookaheadDigest: string | null;
  rollingWindow: Bar[];
  eof: boolean;
  lineRemainder: string;
};

function openStream(datasetRoot: string, fileRelativePath: string): StreamState {
  const absolute = join(datasetRoot, fileRelativePath);
  if (!existsSync(absolute)) {
    throw new FhvOfficialDatasetReaderError(
      "FILE_MISSING",
      `partition file missing: ${fileRelativePath}`,
    );
  }
  return {
    fd: openSync(absolute, "r"),
    fileRelativePath,
    byteOffset: 0,
    lineNumber: 0,
    recordIndex: 0,
    lookahead: null,
    lookaheadDigest: null,
    rollingWindow: [],
    eof: false,
    lineRemainder: "",
  };
}

function readNextLine(state: StreamState): string | null {
  if (state.eof) {
    return null;
  }
  const buffer = Buffer.alloc(FHV_READER_BUFFER_BYTES);
  while (true) {
    if (state.lineRemainder.includes("\n")) {
      const index = state.lineRemainder.indexOf("\n");
      const line = state.lineRemainder.slice(0, index);
      state.lineRemainder = state.lineRemainder.slice(index + 1);
      state.lineNumber += 1;
      if (line.length > FHV_READER_MAX_LINE_BYTES) {
        throw new FhvOfficialDatasetReaderError(
          "LINE_TOO_LONG",
          `line exceeds max bytes at ${state.fileRelativePath}`,
        );
      }
      return line;
    }
    const bytesRead = readSync(state.fd, buffer, 0, buffer.length, state.byteOffset);
    if (bytesRead <= 0) {
      state.eof = true;
      if (state.lineRemainder.length > 0) {
        const tail = state.lineRemainder;
        state.lineRemainder = "";
        state.lineNumber += 1;
        return tail;
      }
      return null;
    }
    state.byteOffset += bytesRead;
    state.lineRemainder += buffer.subarray(0, bytesRead).toString("utf8");
  }
}

function primeLookahead(state: StreamState): void {
  if (state.lookahead !== null) {
    return;
  }
  while (true) {
    const line = readNextLine(state);
    if (line === null) {
      return;
    }
    if (line.trim().length === 0) {
      continue;
    }
    const record = parseFhvBarsV2Line(line, state.lineNumber);
    const bar = fhvBarsV2RecordToBar(record);
    state.lookahead = bar;
    state.lookaheadDigest = computeBarContentDigest(bar);
    state.recordIndex += 1;
    return;
  }
}

export class FhvOfficialDatasetReader implements BarReplaySource {
  private readonly datasetRoot: string;
  private readonly manifest: FhvDatasetManifestV2;
  private readonly accessPurpose: FhvHoldoutAccessPurpose;
  private readonly includeHoldoutStrategy: boolean;
  private readonly cycleIdPrefix: string;
  private partitionIndex = 0;
  private readonly partitions: FhvOfficialPartitionName[];
  private btc: StreamState | null = null;
  private eth: StreamState | null = null;
  private globalEventSequence = 0;
  private cycleIndex = 0;
  private closed = false;
  private firstCycleGlobalEventSequence: number | null = null;
  private lastBarCloseTime = "";
  private readonly symbolHistories = new Map<string, Bar[]>();
  readonly holdoutCounters: {
    custodyBytesRead: number;
    integrityBytesRead: number;
    controlReplayStrategyBytesRead: number;
    fullStrategyBytesRead: number;
  } = {
    custodyBytesRead: 0,
    integrityBytesRead: 0,
    controlReplayStrategyBytesRead: 0,
    fullStrategyBytesRead: 0,
  };

  constructor(input: {
    datasetRoot: string;
    accessPurpose: FhvHoldoutAccessPurpose;
    includeHoldoutStrategy?: boolean;
    includeHoldoutPartitions?: boolean;
    cycleIdPrefix?: string;
  }) {
    this.datasetRoot = resolve(input.datasetRoot);
    const sealed = assertFhvDatasetSealed(this.datasetRoot);
    this.manifest = sealed.manifest;
    this.accessPurpose = input.accessPurpose;
    this.includeHoldoutStrategy = input.includeHoldoutStrategy ?? false;
    this.cycleIdPrefix = input.cycleIdPrefix ?? "fhv-official-v2";
    this.partitions =
      input.includeHoldoutPartitions === false
        ? (["development", "walk-forward"] as const)
        : (["development", "walk-forward", "blind-holdout"] as const);
    this.openCurrentPartitionStreams();
  }

  reset(): void {
    throw new FhvOfficialDatasetReaderError(
      "RESET_UNSUPPORTED",
      "official v2 reader reset is unsupported; use restoreCursor",
    );
  }

  private assertHoldoutAccessAllowed(partition: FhvOfficialPartitionName): void {
    if (partition !== "blind-holdout") {
      return;
    }
    if (this.accessPurpose === "CONTROL_REPLAY_STRATEGY") {
      throw new FhvOfficialDatasetReaderError(
        "HOLDOUT_STRATEGY_ACCESS_FORBIDDEN",
        "control replay must not access holdout strategy bytes",
      );
    }
    if (this.accessPurpose === "FULL_VALIDATION_STRATEGY" && !this.includeHoldoutStrategy) {
      throw new FhvOfficialDatasetReaderError(
        "HOLDOUT_STRATEGY_UNAUTHORIZED",
        "holdout strategy access requires authorization gate chain",
      );
    }
  }

  private recordHoldoutBytes(partition: FhvOfficialPartitionName, bytes: number): void {
    if (partition !== "blind-holdout" || bytes <= 0) {
      return;
    }
    switch (this.accessPurpose) {
      case "CUSTODY_ACQUISITION":
        this.holdoutCounters.custodyBytesRead += bytes;
        break;
      case "INTEGRITY_QUALIFICATION":
        this.holdoutCounters.integrityBytesRead += bytes;
        break;
      case "CONTROL_REPLAY_STRATEGY":
        this.holdoutCounters.controlReplayStrategyBytesRead += bytes;
        break;
      case "FULL_VALIDATION_STRATEGY":
        this.holdoutCounters.fullStrategyBytesRead += bytes;
        break;
      default:
        break;
    }
  }

  private openCurrentPartitionStreams(): void {
    this.closeStreams();
    const partition = this.partitions[this.partitionIndex]!;
    this.assertHoldoutAccessAllowed(partition);
    const btcEntry = this.manifest.partitions.find(
      (entry) => entry.partition === partition && entry.symbol === "BTCUSDT",
    )!;
    const ethEntry = this.manifest.partitions.find(
      (entry) => entry.partition === partition && entry.symbol === "ETHUSDT",
    )!;
    this.btc = openStream(this.datasetRoot, btcEntry.filePath);
    this.eth = openStream(this.datasetRoot, ethEntry.filePath);
    primeLookahead(this.btc);
    primeLookahead(this.eth);
  }

  private closeStreams(): void {
    if (this.btc) {
      closeSync(this.btc.fd);
      this.btc = null;
    }
    if (this.eth) {
      closeSync(this.eth.fd);
      this.eth = null;
    }
  }

  private popNextMergedBar(): Bar | null {
    while (this.partitionIndex < this.partitions.length) {
      if (!this.btc || !this.eth) {
        this.openCurrentPartitionStreams();
      }
      const btc = this.btc!;
      const eth = this.eth!;
      primeLookahead(btc);
      primeLookahead(eth);
      const b = btc.lookahead;
      const e = eth.lookahead;
      if (!b && !e) {
        this.partitionIndex += 1;
        if (this.partitionIndex < this.partitions.length) {
          this.openCurrentPartitionStreams();
        }
        continue;
      }
      let chosen: Bar;
      let stream: StreamState;
      if (
        b &&
        (!e ||
          b.barOpenTime < e.barOpenTime ||
          (b.barOpenTime === e.barOpenTime &&
            fhvSymbolRank(b.symbol as "BTC/USDT" | "ETH/USDT") <
              fhvSymbolRank(e.symbol as "BTC/USDT" | "ETH/USDT")))
      ) {
        chosen = b;
        stream = btc;
      } else {
        chosen = e!;
        stream = eth;
      }
      const partition = this.partitions[this.partitionIndex]!;
      this.recordHoldoutBytes(partition, Buffer.byteLength(chosen.symbol, "utf8"));
      stream.lookahead = null;
      stream.lookaheadDigest = null;
      stream.rollingWindow.push(chosen);
      if (stream.rollingWindow.length > EXPAND_MIN_BARS) {
        stream.rollingWindow.shift();
      }
      primeLookahead(stream);
      this.globalEventSequence += 1;
      this.lastBarCloseTime = chosen.barCloseTime;
      return chosen;
    }
    return null;
  }

  next(): BarReplayNextResult {
    if (this.closed) {
      throw new FhvOfficialDatasetReaderError("READER_CLOSED", "reader is closed");
    }
    while (true) {
      const bar = this.popNextMergedBar();
      if (!bar) {
        return { done: true };
      }
      const history = this.symbolHistories.get(bar.symbol) ?? [];
      history.push(bar);
      if (history.length > EXPAND_MIN_BARS) {
        history.splice(0, history.length - EXPAND_MIN_BARS);
      }
      this.symbolHistories.set(bar.symbol, history);
      if (history.length >= EXPAND_MIN_BARS) {
        const window = history.slice(-EXPAND_MIN_BARS);
        const snapshot = buildMarketSnapshot(
          window,
          quoteFromBar(bar),
          this.cycleIndex,
          this.cycleIdPrefix,
        );
        if (this.cycleIndex === 0 && this.firstCycleGlobalEventSequence === null) {
          this.firstCycleGlobalEventSequence = this.globalEventSequence;
        }
        this.cycleIndex += 1;
        return { done: false, snapshot };
      }
    }
  }

  captureSourceFrontier(input: { sourceExhausted: boolean }): FhvSourceFrontier {
    const cursor = this.captureCursor();
    return buildFhvSourceFrontier({
      globalEventSequence: this.globalEventSequence,
      emittedCycleCount: this.cycleIndex,
      warmupEventCount: this.firstCycleGlobalEventSequence ?? this.globalEventSequence,
      sourceExhausted: input.sourceExhausted,
      cursor,
      lastBarCloseTime: this.lastBarCloseTime,
    });
  }

  captureCursor(): FhvOfficialDatasetCursorV2 {
    const partition = this.partitions[this.partitionIndex] ?? "blind-holdout";
    const toStreamCursor = (state: StreamState | null) => ({
      partitionIndex: this.partitionIndex,
      fileRelativePath: state?.fileRelativePath ?? "",
      byteOffset: state?.byteOffset ?? 0,
      lineNumber: state?.lineNumber ?? 0,
      recordIndex: state?.recordIndex ?? 0,
      lineRemainder: state?.lineRemainder ?? "",
      lookaheadRecord: state?.lookahead ?? null,
      lookaheadRecordDigest: state?.lookaheadDigest ?? null,
      rollingWindow: [...(state?.rollingWindow ?? [])],
    });
    return {
      schemaVersion: FHV_OFFICIAL_DATASET_CURSOR_SCHEMA_VERSION,
      datasetContentDigest: this.manifest.datasetContentDigest,
      manifestSemanticDigest: this.manifest.manifestSemanticDigest,
      activePartition: partition,
      globalEventSequence: this.globalEventSequence,
      cycleIndex: this.cycleIndex,
      btc: toStreamCursor(this.btc),
      eth: toStreamCursor(this.eth),
    };
  }

  restoreCursor(cursor: FhvOfficialDatasetCursorV2): void {
    if (this.closed) {
      throw new FhvOfficialDatasetReaderError("READER_CLOSED", "cannot restore closed reader");
    }
    this.partitionIndex = cursor.btc.partitionIndex;
    this.globalEventSequence = cursor.globalEventSequence;
    this.cycleIndex = cursor.cycleIndex;
    this.openCurrentPartitionStreams();
    const restoreStream = (state: StreamState, snapshot: FhvOfficialDatasetCursorV2["btc"]) => {
      state.byteOffset = snapshot.byteOffset;
      state.lineNumber = snapshot.lineNumber;
      state.recordIndex = snapshot.recordIndex;
      state.lineRemainder = snapshot.lineRemainder;
      state.eof = false;
      state.rollingWindow = [...snapshot.rollingWindow];
      state.lookahead = snapshot.lookaheadRecord;
      state.lookaheadDigest = snapshot.lookaheadRecordDigest;
      if (
        snapshot.lookaheadRecord &&
        snapshot.lookaheadRecordDigest &&
        computeBarContentDigest(snapshot.lookaheadRecord) !== snapshot.lookaheadRecordDigest
      ) {
        throw new FhvOfficialDatasetReaderError(
          "LOOKAHEAD_DIGEST_MISMATCH",
          "restored lookahead digest mismatch",
        );
      }
      if (!state.lookahead && snapshot.lookaheadRecordDigest) {
        primeLookahead(state);
      }
    };
    restoreStream(this.btc!, cursor.btc);
    restoreStream(this.eth!, cursor.eth);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closeStreams();
    this.closed = true;
  }

  getManifest(): FhvDatasetManifestV2 {
    return this.manifest;
  }

  get currentCycleIndex(): number {
    return this.cycleIndex;
  }
}

export interface CheckpointableBarReplaySource extends BarReplaySource {
  captureCursor(): FhvOfficialDatasetCursorV2;
  captureSourceFrontier(input: { sourceExhausted: boolean }): FhvSourceFrontier;
  restoreCursor(cursor: FhvOfficialDatasetCursorV2): void;
  close(): void;
}

export function createCheckpointableOfficialDatasetReader(input: {
  datasetRoot: string;
  accessPurpose: FhvHoldoutAccessPurpose;
  includeHoldoutStrategy?: boolean;
  cycleIdPrefix?: string;
}): CheckpointableBarReplaySource {
  return new FhvOfficialDatasetReader(input);
}
