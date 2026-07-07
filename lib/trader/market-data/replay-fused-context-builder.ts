import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import { fuseContextV1 } from "@/lib/trader/market-data/fusion/context-fusion-v1";
import { buildCrossVenueTriangulation } from "@/lib/trader/market-data/fusion/cross-venue-triangulation";
import {
  normalizeOhlcvBarsObservation,
  normalizeQuoteObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import { resampleReplayMtfBars } from "@/lib/trader/market-data/mtf/replay-mtf-resampler";
import type {
  FusedMarketContext,
  SourceProvenanceRef,
} from "@/lib/trader/market-data/observation-types";
import { MTF_BAR_INTERVALS } from "@/lib/trader/market-data/observation-types";
import {
  buildObservationsFromSidecarV1,
  buildObservationsFromSidecarV2,
} from "@/lib/trader/market-data/replay/replay-lane-normalizer";
import {
  isReplayProviderSidecarV1,
  isReplayProviderSidecarV2,
  type ReplayProviderSidecar,
  type ReplayProviderSidecarEntryV1,
  type ReplayProviderSidecarV1,
  type ReplayProviderSidecarV2,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { assertResearchRuntime } from "@/lib/trader/research/assert-research-runtime";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import { buildProvenanceRef } from "@/lib/trader/market-data/normalization/normalize-observation";

export type {
  ReplayProviderSidecar,
  ReplayProviderSidecarEntryV1,
  ReplayProviderSidecarV1,
  ReplayProviderSidecarV2,
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

export function buildReplayFusedContext(input: {
  bars: readonly Bar[];
  quote: Quote;
  evaluatedAt: string;
  instrumentId: string;
  providerSidecar?: ReplayProviderSidecar;
}): FusedMarketContext {
  assertResearchRuntime("buildReplayFusedContext");

  const degradationReasons: string[] = [];
  const mtfBarsByInterval = resampleReplayMtfBars({ bars1m: input.bars });

  const mtfObservations: Partial<
    Record<string, import("@/lib/trader/market-data/observation-types").NormalizedObservation[]>
  > = {};
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

  const primaryLast = input.quote.last;
  let orderBookSnapshot: FusedMarketContext["orderBookSnapshot"];
  let marketTradesSnapshot: FusedMarketContext["marketTradesSnapshot"];
  let crossExchangeConfirmation: FusedMarketContext["crossExchangeConfirmation"];
  let fearGreedObservation: FusedMarketContext["fearGreed"];
  let globalMarketObservation: FusedMarketContext["globalMarket"];
  let macroEvidence: FusedMarketContext["macroEvidence"] = [];
  let newsEvidence: FusedMarketContext["newsEvidence"] = [];
  let blockchainEvidence: FusedMarketContext["blockchainEvidence"] = [];
  let regulatoryEvidence: FusedMarketContext["regulatoryEvidence"] = [];
  let protocolEvidence: FusedMarketContext["protocolEvidence"] = [];
  let binanceObs: ReturnType<typeof buildObservationsFromSidecarV2>["binanceObs"];
  let bybitObs: ReturnType<typeof buildObservationsFromSidecarV2>["bybitObs"];

  if (input.providerSidecar && isReplayProviderSidecarV2(input.providerSidecar)) {
    const laneObs = buildObservationsFromSidecarV2({
      lanes: input.providerSidecar.lanes,
      instrumentId: input.instrumentId,
      primaryLast,
      evaluatedAt: input.evaluatedAt,
      captureAsOfUtc: input.providerSidecar.captureAsOfUtc,
      degradationReasons,
    });
    orderBookSnapshot = laneObs.orderBookSnapshot;
    marketTradesSnapshot = laneObs.marketTradesSnapshot;
    crossExchangeConfirmation = laneObs.crossExchangeConfirmation;
    fearGreedObservation = laneObs.fearGreed;
    globalMarketObservation = laneObs.globalMarket;
    macroEvidence = laneObs.macroEvidence;
    newsEvidence = laneObs.newsEvidence;
    blockchainEvidence = laneObs.blockchainEvidence;
    regulatoryEvidence = laneObs.regulatoryEvidence;
    protocolEvidence = laneObs.protocolEvidence;
    binanceObs = laneObs.binanceObs;
    bybitObs = laneObs.bybitObs;
  } else if (input.providerSidecar && isReplayProviderSidecarV1(input.providerSidecar)) {
    const sidecarEntry = findSidecarEntryV1(input.providerSidecar, input.evaluatedAt);
    const laneObs = buildObservationsFromSidecarV1({
      sidecar: input.providerSidecar,
      sidecarEntry,
      instrumentId: input.instrumentId,
      primaryLast,
      evaluatedAt: input.evaluatedAt,
      degradationReasons,
    });
    crossExchangeConfirmation = laneObs.crossExchangeConfirmation;
    fearGreedObservation = laneObs.fearGreed;
    globalMarketObservation = laneObs.globalMarket;
    binanceObs = laneObs.binanceObs;
    bybitObs = laneObs.bybitObs;
    macroEvidence = [];
    newsEvidence = [];
    blockchainEvidence = [];
    regulatoryEvidence = [];
    protocolEvidence = [];
  } else {
    macroEvidence = [];
    newsEvidence = [];
    blockchainEvidence = [];
    regulatoryEvidence = [];
    protocolEvidence = [];
  }

  const crossVenueTriangulation = buildCrossVenueTriangulation({
    binance: binanceObs,
    bybit: bybitObs,
  });

  return fuseContextV1({
    instrumentId: input.instrumentId,
    fusedAtUtc: input.evaluatedAt,
    mtfBars: mtfObservations,
    primaryQuote,
    orderBookSnapshot,
    marketTradesSnapshot,
    crossExchangeConfirmation,
    crossVenueTriangulation,
    fearGreed: fearGreedObservation,
    globalMarket: globalMarketObservation,
    macroEvidence,
    newsEvidence,
    blockchainEvidence,
    regulatoryEvidence,
    protocolEvidence,
    degradationReasons,
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
