import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import type { MtfView } from "@/lib/trader/market-data/canvas/incremental-mtf";
import type { HtfInterval } from "@/lib/trader/market-data/canvas/incremental-mtf";
import type { MarketCanvasView } from "@/lib/trader/market-data/canvas/market-canvas.types";
import { fuseContextV1 } from "@/lib/trader/market-data/fusion/context-fusion-v1";
import { buildCrossVenueTriangulation } from "@/lib/trader/market-data/fusion/cross-venue-triangulation";
import {
  normalizeOhlcvBarsObservation,
  normalizeQuoteObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import { resampleReplayMtfBars } from "@/lib/trader/market-data/mtf/replay-mtf-resampler";
import { collectIncrementalClosedBars } from "@/lib/trader/market-data/canvas/incremental-mtf";
import type {
  FusedMarketContext,
  SourceProvenanceRef,
} from "@/lib/trader/market-data/observation-types";
import { MTF_BAR_INTERVALS } from "@/lib/trader/market-data/observation-types";
import {
  buildObservationsFromSidecarAtPit,
  markAbsentEvidenceLanes,
  type SidecarObservationBundle,
} from "@/lib/trader/market-data/replay/replay-lane-normalizer";
import {
  isReplayProviderSidecarV1,
  type ReplayProviderSidecar,
  type ReplayProviderSidecarEntryV1,
  type ReplayProviderSidecarV1,
  type ReplayProviderSidecarV2,
  type ReplayProviderSidecarV3,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { assertResearchRuntime } from "@/lib/trader/research/assert-research-runtime";
import { recordFullHistoryRescan } from "@/lib/trader/backtest/replay-runtime-metrics";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import { buildProvenanceRef } from "@/lib/trader/market-data/normalization/normalize-observation";

export type {
  ReplayProviderSidecar,
  ReplayProviderSidecarEntryV1,
  ReplayProviderSidecarV1,
  ReplayProviderSidecarV2,
  ReplayProviderSidecarV3,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";

/** @deprecated use ReplayProviderSidecarEntryV1 */
export type ReplayProviderSidecarEntry = ReplayProviderSidecarEntryV1;

function replayProvenance(input: {
  providerId: SourceProvenanceRef["providerId"];
  venue: string;
  feedKind: string;
  symbol: string;
  eventTimeUtc: string;
  evaluatedAt: string;
  captureAsOfUtc?: string;
}): SourceProvenanceRef {
  return buildProvenanceRef({
    providerId: input.providerId,
    venue: input.venue,
    feedKind: input.feedKind,
    symbol: input.symbol,
    eventTimeUtc: input.eventTimeUtc,
    ingestTimeUtc: input.captureAsOfUtc ?? input.evaluatedAt,
  });
}

function findSidecarEntryV1(
  sidecar: ReplayProviderSidecarV1,
  evaluatedAt: string,
): ReplayProviderSidecarEntryV1 | undefined {
  return sidecar.entries.find((entry) => entry.evaluatedAt === evaluatedAt);
}

function mtfViewToIntervalBars(view: MtfView): Partial<Record<string, Bar[]>> {
  const mapInterval = (interval: HtfInterval, tailKey: "_15m" | "_1h" | "_4h" | "_1d"): Bar[] => {
    const stats = view.closedStats[tailKey];
    const tail = view.closedTail[tailKey];
    if (stats.count === 0 || tail.length === 0) {
      return [];
    }
    const last = tail.at(-1)!;
    if (stats.count === 1) {
      return [last];
    }
    const first = stats.first ?? tail[0]!;
    if (stats.count === 2) {
      return [first, last];
    }
    return [first, ...Array.from({ length: stats.count - 2 }, () => last), last];
  };

  return {
    "15m": mapInterval("15m", "_15m"),
    "1h": mapInterval("1h", "_1h"),
    "4h": mapInterval("4h", "_4h"),
    "1d": mapInterval("1d", "_1d"),
  };
}

function buildMtfObservationsFromIntervalBars(input: {
  mtfBarsByInterval: Partial<Record<string, Bar[]>>;
  instrumentId: string;
  evaluatedAt: string;
}): Partial<
  Record<string, import("@/lib/trader/market-data/observation-types").NormalizedObservation[]>
> {
  const mtfObservations: Partial<
    Record<string, import("@/lib/trader/market-data/observation-types").NormalizedObservation[]>
  > = {};
  for (const interval of MTF_BAR_INTERVALS) {
    const bars = input.mtfBarsByInterval[interval];
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
  return mtfObservations;
}

function buildSidecarLanes(input: {
  providerSidecar?: ReplayProviderSidecar;
  instrumentId: string;
  evaluatedAt: string;
  primaryLast: string;
}): {
  degradationReasons: string[];
  orderBookSnapshot: FusedMarketContext["orderBookSnapshot"];
  marketTradesSnapshot: FusedMarketContext["marketTradesSnapshot"];
  crossExchangeConfirmation: FusedMarketContext["crossExchangeConfirmation"];
  fearGreedObservation: FusedMarketContext["fearGreed"];
  globalMarketObservation: FusedMarketContext["globalMarket"];
  macroEvidence: FusedMarketContext["macroEvidence"];
  newsEvidence: FusedMarketContext["newsEvidence"];
  blockchainEvidence: FusedMarketContext["blockchainEvidence"];
  regulatoryEvidence: FusedMarketContext["regulatoryEvidence"];
  protocolEvidence: FusedMarketContext["protocolEvidence"];
  binanceObs: SidecarObservationBundle["binanceObs"];
  bybitObs: SidecarObservationBundle["bybitObs"];
} {
  const degradationReasons: string[] = [];

  if (!input.providerSidecar) {
    const absent = markAbsentEvidenceLanes({
      evaluatedAt: input.evaluatedAt,
      instrumentId: input.instrumentId,
      degradationReasons,
      hasSidecar: false,
    }) as SidecarObservationBundle;

    return {
      degradationReasons,
      orderBookSnapshot: absent.orderBookSnapshot,
      marketTradesSnapshot: absent.marketTradesSnapshot,
      crossExchangeConfirmation: absent.crossExchangeConfirmation,
      fearGreedObservation: absent.fearGreed,
      globalMarketObservation: absent.globalMarket,
      macroEvidence: absent.macroEvidence,
      newsEvidence: absent.newsEvidence,
      blockchainEvidence: absent.blockchainEvidence,
      regulatoryEvidence: absent.regulatoryEvidence,
      protocolEvidence: absent.protocolEvidence,
      binanceObs: absent.binanceObs,
      bybitObs: absent.bybitObs,
    };
  }

  const sidecarEntry = isReplayProviderSidecarV1(input.providerSidecar)
    ? findSidecarEntryV1(input.providerSidecar, input.evaluatedAt)
    : undefined;

  const laneObs = buildObservationsFromSidecarAtPit({
    sidecar: input.providerSidecar,
    sidecarEntryV1: sidecarEntry,
    instrumentId: input.instrumentId,
    primaryLast: input.primaryLast,
    evaluatedAt: input.evaluatedAt,
    degradationReasons,
  });

  return {
    degradationReasons,
    orderBookSnapshot: laneObs.orderBookSnapshot,
    marketTradesSnapshot: laneObs.marketTradesSnapshot,
    crossExchangeConfirmation: laneObs.crossExchangeConfirmation,
    fearGreedObservation: laneObs.fearGreed,
    globalMarketObservation: laneObs.globalMarket,
    macroEvidence: laneObs.macroEvidence,
    newsEvidence: laneObs.newsEvidence,
    blockchainEvidence: laneObs.blockchainEvidence,
    regulatoryEvidence: laneObs.regulatoryEvidence,
    protocolEvidence: laneObs.protocolEvidence,
    binanceObs: laneObs.binanceObs,
    bybitObs: laneObs.bybitObs,
  };
}

function resampleClosedOnlyMtfBars(bars1m: readonly Bar[]): Partial<Record<string, Bar[]>> {
  recordFullHistoryRescan("resampleReplayMtfBars");
  const raw = resampleReplayMtfBars({ bars1m });
  const { finalState } = collectIncrementalClosedBars(bars1m);
  const closedOnly: Partial<Record<string, Bar[]>> = {};
  for (const interval of MTF_BAR_INTERVALS) {
    const series = raw[interval] ?? [];
    closedOnly[interval] =
      finalState.forming[interval as keyof typeof finalState.forming] && series.length > 0
        ? series.slice(0, -1)
        : series;
  }
  return closedOnly;
}

export function buildReplayFusedContextClosedOnlyLegacy(input: {
  bars: readonly Bar[];
  quote: Quote;
  evaluatedAt: string;
  instrumentId: string;
  providerSidecar?: ReplayProviderSidecar;
}): FusedMarketContext {
  assertResearchRuntime("buildReplayFusedContextClosedOnlyLegacy");

  const mtfObservations = buildMtfObservationsFromIntervalBars({
    mtfBarsByInterval: resampleClosedOnlyMtfBars(input.bars),
    instrumentId: input.instrumentId,
    evaluatedAt: input.evaluatedAt,
  });

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

  const sidecar = buildSidecarLanes({
    providerSidecar: input.providerSidecar,
    instrumentId: input.instrumentId,
    evaluatedAt: input.evaluatedAt,
    primaryLast: input.quote.last,
  });

  const crossVenueTriangulation = buildCrossVenueTriangulation({
    binance: sidecar.binanceObs,
    bybit: sidecar.bybitObs,
  });

  return fuseContextV1({
    instrumentId: input.instrumentId,
    fusedAtUtc: input.evaluatedAt,
    mtfBars: mtfObservations,
    primaryQuote,
    orderBookSnapshot: sidecar.orderBookSnapshot,
    marketTradesSnapshot: sidecar.marketTradesSnapshot,
    crossExchangeConfirmation: sidecar.crossExchangeConfirmation,
    crossVenueTriangulation,
    fearGreed: sidecar.fearGreedObservation,
    globalMarket: sidecar.globalMarketObservation,
    macroEvidence: sidecar.macroEvidence,
    newsEvidence: sidecar.newsEvidence,
    blockchainEvidence: sidecar.blockchainEvidence,
    regulatoryEvidence: sidecar.regulatoryEvidence,
    protocolEvidence: sidecar.protocolEvidence,
    degradationReasons: sidecar.degradationReasons,
  });
}

export function buildReplayFusedContext(input: {
  bars: readonly Bar[];
  quote: Quote;
  evaluatedAt: string;
  instrumentId: string;
  providerSidecar?: ReplayProviderSidecar;
}): FusedMarketContext {
  assertResearchRuntime("buildReplayFusedContext");

  recordFullHistoryRescan("resampleReplayMtfBars");
  const mtfBarsByInterval = resampleReplayMtfBars({ bars1m: input.bars });
  const mtfObservations = buildMtfObservationsFromIntervalBars({
    mtfBarsByInterval,
    instrumentId: input.instrumentId,
    evaluatedAt: input.evaluatedAt,
  });

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

  const sidecar = buildSidecarLanes({
    providerSidecar: input.providerSidecar,
    instrumentId: input.instrumentId,
    evaluatedAt: input.evaluatedAt,
    primaryLast: input.quote.last,
  });

  const crossVenueTriangulation = buildCrossVenueTriangulation({
    binance: sidecar.binanceObs,
    bybit: sidecar.bybitObs,
  });

  return fuseContextV1({
    instrumentId: input.instrumentId,
    fusedAtUtc: input.evaluatedAt,
    mtfBars: mtfObservations,
    primaryQuote,
    orderBookSnapshot: sidecar.orderBookSnapshot,
    marketTradesSnapshot: sidecar.marketTradesSnapshot,
    crossExchangeConfirmation: sidecar.crossExchangeConfirmation,
    crossVenueTriangulation,
    fearGreed: sidecar.fearGreedObservation,
    globalMarket: sidecar.globalMarketObservation,
    macroEvidence: sidecar.macroEvidence,
    newsEvidence: sidecar.newsEvidence,
    blockchainEvidence: sidecar.blockchainEvidence,
    regulatoryEvidence: sidecar.regulatoryEvidence,
    protocolEvidence: sidecar.protocolEvidence,
    degradationReasons: sidecar.degradationReasons,
  });
}

export function buildReplayFusedContextFromCanvasView(input: {
  canvasView: MarketCanvasView;
  quote: Quote;
  evaluatedAt: string;
  instrumentId: string;
  providerSidecar?: ReplayProviderSidecar;
  /** Closed 1m prefix for the 1m MTF observation lane (D-10 parity with legacy resampler). */
  bars1mPrefix: readonly Bar[];
}): FusedMarketContext {
  assertResearchRuntime("buildReplayFusedContextFromCanvasView");

  if (!input.canvasView.mtf) {
    throw new Error("[market-data] canvas view missing MTF domain for fused context");
  }

  const mtfBarsByInterval: Partial<Record<string, Bar[]>> = {
    "1m": [...input.bars1mPrefix],
    ...mtfViewToIntervalBars(input.canvasView.mtf),
  };

  const mtfObservations = buildMtfObservationsFromIntervalBars({
    mtfBarsByInterval,
    instrumentId: input.instrumentId,
    evaluatedAt: input.evaluatedAt,
  });

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

  const sidecar = buildSidecarLanes({
    providerSidecar: input.providerSidecar,
    instrumentId: input.instrumentId,
    evaluatedAt: input.evaluatedAt,
    primaryLast: input.quote.last,
  });

  const crossVenueTriangulation = buildCrossVenueTriangulation({
    binance: sidecar.binanceObs,
    bybit: sidecar.bybitObs,
  });

  return fuseContextV1({
    instrumentId: input.instrumentId,
    fusedAtUtc: input.evaluatedAt,
    mtfBars: mtfObservations,
    primaryQuote,
    orderBookSnapshot: sidecar.orderBookSnapshot,
    marketTradesSnapshot: sidecar.marketTradesSnapshot,
    crossExchangeConfirmation: sidecar.crossExchangeConfirmation,
    crossVenueTriangulation,
    fearGreed: sidecar.fearGreedObservation,
    globalMarket: sidecar.globalMarketObservation,
    macroEvidence: sidecar.macroEvidence,
    newsEvidence: sidecar.newsEvidence,
    blockchainEvidence: sidecar.blockchainEvidence,
    regulatoryEvidence: sidecar.regulatoryEvidence,
    protocolEvidence: sidecar.protocolEvidence,
    degradationReasons: sidecar.degradationReasons,
  });
}

export function buildReplayFusedContextFromSnapshot(
  snapshot: MarketSnapshot,
  providerSidecar?: ReplayProviderSidecar,
): FusedMarketContext {
  assertResearchRuntime("buildReplayFusedContextFromSnapshot");
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
