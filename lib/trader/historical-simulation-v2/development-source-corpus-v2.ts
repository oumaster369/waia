import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { fhvBarsV2RecordToBar, parseFhvBarsV2Line } from
  "@/lib/trader/market-data/fhv-bars-v2-ndjson";
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
  const filePath = join(input.datasetRoot, "partitions", "development", input.symbol,
    "bars.v2.ndjson");
  async function* bars(): AsyncGenerator<Bar> {
    const lines = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      yield fhvBarsV2RecordToBar(parseFhvBarsV2Line(line, lineNumber));
    }
  }
  return buildHistoricalDevelopmentSourceCorpusV2({ bars: bars(), symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes });
}
