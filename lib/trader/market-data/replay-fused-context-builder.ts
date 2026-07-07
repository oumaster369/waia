import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import { fuseContextV0 } from "@/lib/trader/market-data/fusion/context-fusion-v0";
import { buildCrossVenueTriangulation } from "@/lib/trader/market-data/fusion/cross-venue-triangulation";
import {
  buildProvenanceRef,
  normalizeCrossExchangeConfirmation,
  normalizeFearGreedObservation,
  normalizeGlobalMarketObservation,
  normalizeOhlcvBarsObservation,
  normalizeQuoteObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import { resampleReplayMtfBars } from "@/lib/trader/market-data/mtf/replay-mtf-resampler";
import type {
  FusedMarketContext,
  NormalizedObservation,
  SourceProvenanceRef,
} from "@/lib/trader/market-data/observation-types";
import { MTF_BAR_INTERVALS } from "@/lib/trader/market-data/observation-types";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";

export type ReplayProviderSidecarEntry = {
  evaluatedAt: string;
  fearGreed?: {
    value: number;
    classification: string;
  };
  globalMarket?: {
    btcDominance: number;
    marketCapUsd: number;
  };
  binanceConfirmLast?: string;
  bybitConfirmLast?: string;
};

export type ReplayProviderSidecar = {
  schemaVersion: "waia.trader.m9_provider_sidecar.v1";
  instrumentId: string;
  entries: ReplayProviderSidecarEntry[];
};

function findSidecarEntry(
  sidecar: ReplayProviderSidecar | undefined,
  evaluatedAt: string,
): ReplayProviderSidecarEntry | undefined {
  if (!sidecar) {
    return undefined;
  }
  return sidecar.entries.find((entry) => entry.evaluatedAt === evaluatedAt);
}

function replayProvenance(input: {
  providerId: SourceProvenanceRef["providerId"];
  venue: string;
  feedKind: string;
  symbol: string;
  eventTimeUtc: string;
  evaluatedAt: string;
}): SourceProvenanceRef {
  return buildProvenanceRef({
    ...input,
    ingestTimeUtc: input.evaluatedAt,
  });
}

export function buildReplayFusedContext(input: {
  bars: readonly Bar[];
  quote: Quote;
  evaluatedAt: string;
  instrumentId: string;
  providerSidecar?: ReplayProviderSidecar;
}): FusedMarketContext {
  const degradationReasons: string[] = [];
  const mtfBarsByInterval = resampleReplayMtfBars({ bars1m: input.bars });

  const mtfObservations: Partial<Record<string, NormalizedObservation[]>> = {};
  for (const interval of MTF_BAR_INTERVALS) {
    const bars = mtfBarsByInterval[interval];
    if (!bars || bars.length === 0) {
      continue;
    }
    mtfObservations[interval] = [
      normalizeOhlcvBarsObservation({
        bars,
        provenance: replayProvenance({
          providerId: "htx_spot",
          venue: "htx",
          feedKind: "ohlcv_bar",
          symbol: input.instrumentId,
          eventTimeUtc: bars.at(-1)!.barCloseTime,
          evaluatedAt: input.evaluatedAt,
        }),
        latencyMs: 0,
        evaluatedAt: input.evaluatedAt,
      }),
    ];
  }

  const primaryQuote = normalizeQuoteObservation({
    quote: input.quote,
    provenance: replayProvenance({
      providerId: "htx_spot",
      venue: "htx",
      feedKind: "quote_l1",
      symbol: input.instrumentId,
      eventTimeUtc: input.quote.timestamp,
      evaluatedAt: input.evaluatedAt,
    }),
    latencyMs: 0,
    evaluatedAt: input.evaluatedAt,
  });

  const sidecarEntry = findSidecarEntry(input.providerSidecar, input.evaluatedAt);
  const primaryLast = input.quote.last;

  let binanceObs: NormalizedObservation | undefined;
  let bybitObs: NormalizedObservation | undefined;

  if (sidecarEntry?.binanceConfirmLast) {
    binanceObs = normalizeCrossExchangeConfirmation({
      symbol: input.instrumentId,
      primaryLast,
      confirmLast: sidecarEntry.binanceConfirmLast,
      confirmVenue: "binance",
      provenance: replayProvenance({
        providerId: "binance_public",
        venue: "binance",
        feedKind: "cross_exchange_confirmation",
        symbol: input.instrumentId,
        eventTimeUtc: input.evaluatedAt,
        evaluatedAt: input.evaluatedAt,
      }),
      latencyMs: 0,
      evaluatedAt: input.evaluatedAt,
    });
  }

  if (sidecarEntry?.bybitConfirmLast) {
    bybitObs = normalizeCrossExchangeConfirmation({
      symbol: input.instrumentId,
      primaryLast,
      confirmLast: sidecarEntry.bybitConfirmLast,
      confirmVenue: "bybit",
      provenance: replayProvenance({
        providerId: "bybit_public",
        venue: "bybit",
        feedKind: "cross_exchange_confirmation",
        symbol: input.instrumentId,
        eventTimeUtc: input.evaluatedAt,
        evaluatedAt: input.evaluatedAt,
      }),
      latencyMs: 0,
      evaluatedAt: input.evaluatedAt,
    });
  }

  const crossVenueTriangulation = buildCrossVenueTriangulation({
    binance: binanceObs,
    bybit: bybitObs,
  });

  const crossExchangeConfirmation =
    binanceObs && bybitObs
      ? binanceObs.confidence >= bybitObs.confidence
        ? binanceObs
        : bybitObs
      : (binanceObs ?? bybitObs);

  let fearGreedObservation: NormalizedObservation | undefined;
  if (sidecarEntry?.fearGreed) {
    fearGreedObservation = normalizeFearGreedObservation({
      value: sidecarEntry.fearGreed.value,
      classification: sidecarEntry.fearGreed.classification,
      provenance: replayProvenance({
        providerId: "alternative_me",
        venue: "alternative_me",
        feedKind: "fear_greed_index",
        symbol: "GLOBAL",
        eventTimeUtc: input.evaluatedAt,
        evaluatedAt: input.evaluatedAt,
      }),
      latencyMs: 0,
      evaluatedAt: input.evaluatedAt,
      eventTimeUtc: input.evaluatedAt,
    });
  }

  let globalMarketObservation: NormalizedObservation | undefined;
  if (sidecarEntry?.globalMarket) {
    globalMarketObservation = normalizeGlobalMarketObservation({
      btcDominance: sidecarEntry.globalMarket.btcDominance,
      marketCapUsd: sidecarEntry.globalMarket.marketCapUsd,
      provenance: replayProvenance({
        providerId: "coingecko_global",
        venue: "coingecko",
        feedKind: "global_market_stats",
        symbol: "GLOBAL",
        eventTimeUtc: input.evaluatedAt,
        evaluatedAt: input.evaluatedAt,
      }),
      latencyMs: 0,
      evaluatedAt: input.evaluatedAt,
      eventTimeUtc: input.evaluatedAt,
    });
  }

  return fuseContextV0({
    instrumentId: input.instrumentId,
    fusedAtUtc: input.evaluatedAt,
    mtfBars: mtfObservations,
    primaryQuote,
    crossExchangeConfirmation,
    crossVenueTriangulation,
    fearGreed: fearGreedObservation,
    globalMarket: globalMarketObservation,
    degradationReasons,
  });
}

export function buildReplayFusedContextFromSnapshot(
  snapshot: MarketSnapshot,
  providerSidecar?: ReplayProviderSidecar,
): FusedMarketContext {
  const evaluatedAt =
    snapshot.evaluatedAt ?? snapshot.bars.at(-1)?.barCloseTime ?? snapshot.quote.timestamp;
  return buildReplayFusedContext({
    bars: snapshot.bars,
    quote: snapshot.quote,
    evaluatedAt,
    instrumentId: snapshot.bars[0]?.symbol ?? snapshot.quote.symbol,
    providerSidecar,
  });
}
