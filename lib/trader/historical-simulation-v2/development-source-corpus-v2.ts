import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { expectedOneMinuteBarCount } from
  "@/lib/trader/market-data/fhv-canonical-coverage";
import { fhvBarsV2RecordToBar, parseFhvBarsV2Line } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import {
  createStreamingBarSemanticHasher,
  finalizeStreamingBarSemanticDigest,
  updateStreamingBarSemanticHasher,
} from "@/lib/trader/market-data/fhv-streaming-bar-digest";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { materializeExecOppOutcome13dV1, type QualifiedDevelopmentBarV1 } from
  "@/lib/trader/intelligence/forecast-v2/exec-opp-outcome-materializer-v1";
import { canonicalizeSourceCorpusV1 } from
  "@/lib/trader/intelligence/forecast-v2/source-corpus-canonical-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import type { Bar } from "@/lib/trader/intelligence/types";

const ONE_MINUTE_MS = 60_000;
const FEATURE_WINDOW_BARS = 21;

type PendingAnchor = Readonly<{
  bar: Bar;
  closedBarEpochMs: number;
  realizedVol20m_1m: number;
}>;

function qualifiedBar(bar: Bar, closedBarEpochMs: number): QualifiedDevelopmentBarV1 {
  const close = Number(bar.close);
  const qualifiedBaseVolume = Number(bar.volume);
  if (!(close > 0) || !Number.isFinite(qualifiedBaseVolume) || qualifiedBaseVolume < 0) {
    throw new Error("HISTORICAL_DEVELOPMENT_CORPUS_REFUSED:INVALID_QUALIFIED_BAR");
  }
  return { closedBarEpochMs, close, qualifiedBaseVolume };
}

/**
 * Streaming, PIT-safe DEVELOPMENT corpus builder. Feature state at t is sealed when t arrives;
 * the resolved training outcome is attached only after every required t+k bar is visible.
 */
export async function buildHistoricalDevelopmentSourceCorpusV2(input: Readonly<{
  bars: AsyncIterable<Bar>;
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes?: 30 | 60;
}>): Promise<readonly SourceAnchor[]> {
  const horizon = input.primaryHorizonMinutes ?? 30;
  const futureOffset = horizon + 3;
  const history: Bar[] = [];
  const pending: PendingAnchor[] = [];
  const qualifiedByEpoch = new Map<number, QualifiedDevelopmentBarV1>();
  const anchors: SourceAnchor[] = [];
  let priorEpoch = -1;

  for await (const bar of input.bars) {
    const normalizedSymbol = bar.symbol.replace("/", "");
    const closedBarEpochMs = Date.parse(bar.barCloseTime);
    if (normalizedSymbol !== input.symbol || !Number.isFinite(closedBarEpochMs) ||
        closedBarEpochMs <= priorEpoch) {
      throw new Error("HISTORICAL_DEVELOPMENT_CORPUS_REFUSED:ORDER_OR_SYMBOL");
    }
    if (priorEpoch >= 0 && closedBarEpochMs !== priorEpoch + ONE_MINUTE_MS) {
      throw new Error("HISTORICAL_DEVELOPMENT_CORPUS_REFUSED:NON_CONTIGUOUS_BAR");
    }
    priorEpoch = closedBarEpochMs;
    history.push(bar);
    if (history.length > FEATURE_WINDOW_BARS) history.shift();
    qualifiedByEpoch.set(closedBarEpochMs, qualifiedBar(bar, closedBarEpochMs));

    const feature = computeFeatureSnapshot({
      bars: history,
      quote: { symbol: bar.symbol, bid: bar.close, ask: bar.close, last: bar.close,
        timestamp: bar.barCloseTime },
    });
    const realizedVol20m_1m = Number(feature.features.realizedVol20m_1m);
    if (Number.isFinite(realizedVol20m_1m)) {
      pending.push({ bar, closedBarEpochMs, realizedVol20m_1m });
    }

    while (pending[0] &&
      pending[0].closedBarEpochMs + futureOffset * ONE_MINUTE_MS <= closedBarEpochMs) {
      const candidate = pending.shift()!;
      const outcome = materializeExecOppOutcome13dV1({
        primaryHorizonMinutes: horizon,
        anchorClosedBarEpochMs: candidate.closedBarEpochMs,
        barsByCloseEpochMs: qualifiedByEpoch,
      });
      if (!outcome.eligible) {
        throw new Error(`HISTORICAL_DEVELOPMENT_CORPUS_REFUSED:${outcome.detail}`);
      }
      anchors.push({ venue: "htx", market: "spot", symbol: input.symbol,
        closedBarEpochMs: candidate.closedBarEpochMs,
        barContentDigest: computeBarContentDigest(candidate.bar),
        realizedVol20m_1m: candidate.realizedVol20m_1m,
        outcome13d: outcome.outcome13d });

      const earliestNeeded = pending[0]?.closedBarEpochMs ?? closedBarEpochMs;
      for (const epoch of qualifiedByEpoch.keys()) {
        if (epoch < earliestNeeded) qualifiedByEpoch.delete(epoch);
        else break;
      }
    }
  }
  if (anchors.length < 90) {
    throw new Error("HISTORICAL_DEVELOPMENT_CORPUS_REFUSED:INSUFFICIENT_SOURCE_ANCHORS");
  }
  return Object.freeze(canonicalizeSourceCorpusV1(anchors));
}

export async function loadHistoricalDevelopmentSourceCorpusFromDatasetV2(input: Readonly<{
  datasetRoot: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes?: 30 | 60;
}>): Promise<readonly SourceAnchor[]> {
  const snapshot = await loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2(input);
  return snapshot.corpus;
}

export type HistoricalDevelopmentSourceCorpusSnapshotV2 = Readonly<{
  corpus: readonly SourceAnchor[];
  rawSha256Hex: string;
  /** Exact parsed scientific-window bars from the same byte-authenticated stream. */
  bars?: readonly Bar[];
  scientificWindowEvidence?: Readonly<{
    startUtc: string;
    endUtc: string;
    barCount: number;
    expectedBarCount: number;
    firstBarOpen: string;
    lastBarClose: string;
    semanticContentDigest: string;
    gapDuplicateIntegrity: "PASS";
  }>;
}>;

async function loadHistoricalSourceCorpusSnapshotFromFileV2(input: Readonly<{
  filePath: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes?: 30 | 60;
  startUtc?: string;
  endUtc?: string;
}>): Promise<HistoricalDevelopmentSourceCorpusSnapshotV2> {
  const startMs = input.startUtc === undefined ? null : Date.parse(input.startUtc);
  const endMs = input.endUtc === undefined ? null : Date.parse(input.endUtc);
  if ((startMs !== null && !Number.isFinite(startMs)) ||
      (endMs !== null && !Number.isFinite(endMs)) ||
      (startMs !== null && endMs !== null && startMs >= endMs)) {
    throw new Error("HISTORICAL_SOURCE_CORPUS_REFUSED:INVALID_BOUNDS");
  }
  const rawHasher = createHash("sha256");
  const semanticHasher = createStreamingBarSemanticHasher();
  let windowBarCount = 0;
  const windowBars: Bar[] = [];
  let firstBarOpen = "";
  let lastBarClose = "";
  const source = createReadStream(input.filePath);
  async function* authenticatedBytes(): AsyncGenerator<Buffer> {
    for await (const chunk of source) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      rawHasher.update(bytes);
      yield bytes;
    }
  }
  async function* bars(): AsyncGenerator<Bar> {
    const lines = createInterface({ input: Readable.from(authenticatedBytes()),
      crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      const bar = fhvBarsV2RecordToBar(parseFhvBarsV2Line(line, lineNumber));
      const openMs = Date.parse(bar.barOpenTime);
      if ((startMs === null || openMs >= startMs) && (endMs === null || openMs < endMs)) {
        updateStreamingBarSemanticHasher(semanticHasher, bar);
        if (windowBarCount === 0) firstBarOpen = bar.barOpenTime;
        lastBarClose = bar.barCloseTime;
        windowBarCount += 1;
        windowBars.push(bar);
        yield bar;
      }
    }
  }
  const corpus = await buildHistoricalDevelopmentSourceCorpusV2({ bars: bars(),
    symbol: input.symbol, primaryHorizonMinutes: input.primaryHorizonMinutes });
  const scientificWindowEvidence = input.startUtc !== undefined && input.endUtc !== undefined
    ? Object.freeze({
        startUtc: input.startUtc,
        endUtc: input.endUtc,
        barCount: windowBarCount,
        expectedBarCount: expectedOneMinuteBarCount(input.startUtc, input.endUtc),
        firstBarOpen,
        lastBarClose,
        semanticContentDigest: finalizeStreamingBarSemanticDigest(semanticHasher),
        gapDuplicateIntegrity: "PASS" as const,
      })
    : undefined;
  if (scientificWindowEvidence && (
    scientificWindowEvidence.barCount !== scientificWindowEvidence.expectedBarCount ||
    scientificWindowEvidence.firstBarOpen !== scientificWindowEvidence.startUtc ||
    scientificWindowEvidence.lastBarClose !== scientificWindowEvidence.endUtc
  )) {
    throw new Error("HISTORICAL_SOURCE_CORPUS_REFUSED:SCIENTIFIC_WINDOW_COVERAGE");
  }
  return Object.freeze({
    corpus,
    rawSha256Hex: rawHasher.digest("hex"),
    bars: Object.freeze(windowBars),
    ...(scientificWindowEvidence ? { scientificWindowEvidence } : {}),
  });
}

/**
 * Materializes the corpus and its raw digest from one byte stream. The digest therefore
 * authenticates the exact bytes consumed by the parser rather than a separate stat/read pass.
 */
export async function loadHistoricalDevelopmentSourceCorpusSnapshotFromDatasetV2(input: Readonly<{
  datasetRoot: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes?: 30 | 60;
}>): Promise<HistoricalDevelopmentSourceCorpusSnapshotV2> {
  const filePath = join(input.datasetRoot, "partitions", "development", input.symbol,
    "bars.v2.ndjson");
  return loadHistoricalSourceCorpusSnapshotFromFileV2({ ...input, filePath });
}

/** Exact WF_PREDICTIVE slice; hashes the complete WALK_FORWARD file consumed. */
export function loadHistoricalWalkForwardPredictiveSourceCorpusSnapshotFromDatasetV2(
  input: Readonly<{
    datasetRoot: string;
    symbol: "BTCUSDT" | "ETHUSDT";
    primaryHorizonMinutes: 30 | 60;
    startUtc: string;
    endUtc: string;
  }>,
): Promise<HistoricalDevelopmentSourceCorpusSnapshotV2> {
  return loadHistoricalSourceCorpusSnapshotFromFileV2({
    ...input,
    filePath: join(input.datasetRoot, "partitions", "walk-forward", input.symbol,
      "bars.v2.ndjson"),
  });
}
