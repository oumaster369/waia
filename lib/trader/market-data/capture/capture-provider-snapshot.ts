import type { GatewayPollResult } from "@/lib/trader/market-data/market-data-gateway";
import { MarketDataGateway } from "@/lib/trader/market-data/market-data-gateway";
import type { InformationAcquisitionSelectionV1 } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import type {
  MarketDataProviderId,
  NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
import { MARKET_DATA_PROVIDER_IDS } from "@/lib/trader/market-data/observation-types";
import {
  REPLAY_PROVIDER_SIDECAR_V2,
  type ProviderCaptureOutcome,
  type ReplayProviderSidecarLanesV2,
  type ReplayProviderSidecarV2,
  type SidecarLaneBlockchainStats,
  type SidecarLaneCrossExchange,
  type SidecarLaneExchangeAnnouncement,
  type SidecarLaneFearGreed,
  type SidecarLaneGlobalMarket,
  type SidecarLaneMacroCalendar,
  type SidecarLaneMacroProbability,
  type SidecarLaneMacroSeries,
  type SidecarLaneMarketTrades,
  type SidecarLaneNewsHeadline,
  type SidecarLaneOrderBook,
  type SidecarLaneProtocolRelease,
  type SidecarLaneRegulatoryFiling,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { assertResearchRuntime } from "@/lib/trader/research/assert-research-runtime";
import type { InstrumentId } from "@/lib/trader/intelligence/types";

const ANNOUNCEMENT_PROVIDER_BY_VENUE: Record<string, MarketDataProviderId> = {
  binance: "binance_announcements",
  htx: "htx_announcements",
  bybit: "bybit_announcements",
};

const RSS_PROVIDER_BY_SOURCE: Record<string, MarketDataProviderId> = {
  coindesk: "coindesk_rss",
  cointelegraph: "cointelegraph_rss",
  decrypt: "decrypt_rss",
};

function outcomeForObservation(
  observation: NormalizedObservation | undefined,
): ProviderCaptureOutcome {
  if (!observation) {
    return "UNAVAILABLE";
  }
  if (observation.health === "UNAVAILABLE") {
    return "UNAVAILABLE";
  }
  return "CAPTURED_HEALTHY";
}

function laneFromFearGreed(obs?: NormalizedObservation): SidecarLaneFearGreed | undefined {
  if (!obs || obs.health === "UNAVAILABLE") {
    return undefined;
  }
  const value = obs.payload.value;
  const classification = obs.payload.classification;
  if (typeof value !== "number" || typeof classification !== "string") {
    return undefined;
  }
  return {
    value,
    classification,
    eventTimeUtc: obs.provenance.eventTimeUtc,
  };
}

function laneFromGlobalMarket(obs?: NormalizedObservation): SidecarLaneGlobalMarket | undefined {
  if (!obs || obs.health === "UNAVAILABLE") {
    return undefined;
  }
  const btcDominance = obs.payload.btcDominance;
  const marketCapUsd = obs.payload.marketCapUsd;
  if (typeof btcDominance !== "number" || typeof marketCapUsd !== "number") {
    return undefined;
  }
  return {
    btcDominance,
    marketCapUsd,
    eventTimeUtc: obs.provenance.eventTimeUtc,
  };
}

function laneFromOrderBook(obs?: NormalizedObservation): SidecarLaneOrderBook | undefined {
  if (!obs || obs.health === "UNAVAILABLE") {
    return undefined;
  }
  const bestBid = obs.payload.bestBid;
  const bestAsk = obs.payload.bestAsk;
  if (typeof bestBid !== "number" || typeof bestAsk !== "number") {
    return undefined;
  }
  return {
    bestBid,
    bestAsk,
    bidLevels: typeof obs.payload.bidLevels === "number" ? obs.payload.bidLevels : 1,
    askLevels: typeof obs.payload.askLevels === "number" ? obs.payload.askLevels : 1,
    eventTimeUtc: obs.provenance.eventTimeUtc,
  };
}

function laneFromMarketTrades(obs?: NormalizedObservation): SidecarLaneMarketTrades | undefined {
  if (!obs || obs.health === "UNAVAILABLE") {
    return undefined;
  }
  return {
    tradeCount: typeof obs.payload.tradeCount === "number" ? obs.payload.tradeCount : 0,
    latestPrice: typeof obs.payload.latestPrice === "number" ? obs.payload.latestPrice : undefined,
    eventTimeUtc: obs.provenance.eventTimeUtc,
  };
}

export function serializeFusedContextToSidecarLanes(
  fusedContext: GatewayPollResult["fusedContext"],
  crossObservations: {
    binance?: NormalizedObservation;
    bybit?: NormalizedObservation;
  },
): ReplayProviderSidecarLanesV2 {
  const lanes: ReplayProviderSidecarLanesV2 = {};

  const fearGreed = laneFromFearGreed(fusedContext.fearGreed);
  if (fearGreed) {
    lanes.fear_greed_index = fearGreed;
  }

  const globalMarket = laneFromGlobalMarket(fusedContext.globalMarket);
  if (globalMarket) {
    lanes.global_market_stats = globalMarket;
  }

  const orderBook = laneFromOrderBook(fusedContext.orderBookSnapshot);
  if (orderBook) {
    lanes.order_book_snapshot = orderBook;
  }

  const marketTrades = laneFromMarketTrades(fusedContext.marketTradesSnapshot);
  if (marketTrades) {
    lanes.market_trades_snapshot = marketTrades;
  }

  const cross: SidecarLaneCrossExchange[] = [];
  for (const obs of [crossObservations.binance, crossObservations.bybit]) {
    if (!obs || obs.health === "UNAVAILABLE") {
      continue;
    }
    const confirmVenue = obs.payload.confirmVenue;
    const confirmLast = obs.payload.confirmLast;
    if (
      (confirmVenue === "binance" || confirmVenue === "bybit") &&
      typeof confirmLast === "string"
    ) {
      cross.push({
        confirmVenue,
        confirmLast,
        eventTimeUtc: obs.provenance.eventTimeUtc,
      });
    }
  }
  if (cross.length > 0) {
    lanes.cross_exchange_confirmation = cross;
  }

  const macroSeries: SidecarLaneMacroSeries[] = [];
  const macroCalendar: SidecarLaneMacroCalendar[] = [];
  const macroProbability: SidecarLaneMacroProbability[] = [];
  for (const obs of fusedContext.macroEvidence ?? []) {
    if (obs.health === "UNAVAILABLE") {
      continue;
    }
    if (obs.kind === "macro_series") {
      macroSeries.push({
        seriesId: String(obs.payload.seriesId ?? ""),
        value: Number(obs.payload.value ?? 0),
        observationDate: String(obs.payload.observationDate ?? ""),
        eventTimeUtc: obs.provenance.eventTimeUtc,
      });
    } else if (obs.kind === "macro_calendar_event") {
      macroCalendar.push({
        eventId: String(obs.payload.eventId ?? ""),
        title: String(obs.payload.title ?? ""),
        startUtc: String(obs.payload.startUtc ?? ""),
        category: typeof obs.payload.category === "string" ? obs.payload.category : undefined,
        eventTimeUtc: obs.provenance.eventTimeUtc,
      });
    } else if (obs.kind === "macro_probability") {
      macroProbability.push({
        meetingDate: String(obs.payload.meetingDate ?? ""),
        probability: Number(obs.payload.probability ?? 0),
        targetRateRange:
          typeof obs.payload.targetRateRange === "string" ? obs.payload.targetRateRange : undefined,
        eventTimeUtc: obs.provenance.eventTimeUtc,
      });
    }
  }
  if (macroSeries.length > 0) {
    lanes.macro_series = macroSeries;
  }
  if (macroCalendar.length > 0) {
    lanes.macro_calendar_event = macroCalendar;
  }
  if (macroProbability.length > 0) {
    lanes.macro_probability = macroProbability;
  }

  const newsHeadlines: SidecarLaneNewsHeadline[] = [];
  const announcements: SidecarLaneExchangeAnnouncement[] = [];
  for (const obs of fusedContext.newsEvidence ?? []) {
    if (obs.health === "UNAVAILABLE") {
      continue;
    }
    if (obs.kind === "news_headline") {
      const source = String(obs.payload.source ?? obs.provenance.venue);
      newsHeadlines.push({
        headline: String(obs.payload.headline ?? ""),
        url: String(obs.payload.url ?? ""),
        source,
        publishedAt:
          typeof obs.payload.publishedAt === "string" ? obs.payload.publishedAt : undefined,
        eventTimeUtc: obs.provenance.eventTimeUtc,
        providerId: RSS_PROVIDER_BY_SOURCE[source] ?? obs.provenance.providerId,
      });
    } else if (obs.kind === "news_event_cluster") {
      lanes.news_event_cluster = {
        clusterId: String(obs.payload.clusterId ?? ""),
        query: String(obs.payload.query ?? ""),
        articleCount: Number(obs.payload.articleCount ?? 0),
        topHeadline:
          typeof obs.payload.topHeadline === "string" ? obs.payload.topHeadline : undefined,
        eventTimeUtc: obs.provenance.eventTimeUtc,
      };
    } else if (obs.kind === "exchange_announcement") {
      const venue = String(obs.payload.venue ?? obs.provenance.venue);
      announcements.push({
        announcementId: String(obs.payload.announcementId ?? ""),
        title: String(obs.payload.title ?? ""),
        venue,
        publishedAt:
          typeof obs.payload.publishedAt === "string" ? obs.payload.publishedAt : undefined,
        eventTimeUtc: obs.provenance.eventTimeUtc,
        providerId: ANNOUNCEMENT_PROVIDER_BY_VENUE[venue] ?? obs.provenance.providerId,
      });
    }
  }
  if (newsHeadlines.length > 0) {
    lanes.news_headline = newsHeadlines;
  }
  if (announcements.length > 0) {
    lanes.exchange_announcement = announcements;
  }

  const blockchain: SidecarLaneBlockchainStats[] = [];
  for (const obs of fusedContext.blockchainEvidence ?? []) {
    if (obs.health === "UNAVAILABLE") {
      continue;
    }
    if (obs.kind === "mempool_stats") {
      lanes.mempool_stats = {
        count: Number(obs.payload.count ?? 0),
        vsize: Number(obs.payload.vsize ?? 0),
        totalFee: Number(obs.payload.totalFee ?? 0),
        fastestFee: typeof obs.payload.fastestFee === "number" ? obs.payload.fastestFee : undefined,
        eventTimeUtc: obs.provenance.eventTimeUtc,
      };
    } else if (obs.kind === "blockchain_network_stats") {
      blockchain.push({
        network: String(obs.payload.network ?? ""),
        blockNumber:
          typeof obs.payload.blockNumber === "string" ? obs.payload.blockNumber : undefined,
        gasPriceWei:
          typeof obs.payload.gasPriceWei === "string" ? obs.payload.gasPriceWei : undefined,
        chainParameterCount:
          typeof obs.payload.chainParameterCount === "number"
            ? obs.payload.chainParameterCount
            : undefined,
        eventTimeUtc: obs.provenance.eventTimeUtc,
        providerId: obs.provenance.providerId,
      });
    }
  }
  if (blockchain.length > 0) {
    lanes.blockchain_network_stats = blockchain;
  }

  const regulatory: SidecarLaneRegulatoryFiling[] = [];
  for (const obs of fusedContext.regulatoryEvidence ?? []) {
    if (obs.health === "UNAVAILABLE") {
      continue;
    }
    regulatory.push({
      cik: String(obs.payload.cik ?? ""),
      accessionNumber: String(obs.payload.accessionNumber ?? ""),
      form: String(obs.payload.form ?? ""),
      filingDate: String(obs.payload.filingDate ?? ""),
      eventTimeUtc: obs.provenance.eventTimeUtc,
    });
  }
  if (regulatory.length > 0) {
    lanes.regulatory_filing = regulatory;
  }

  const protocol: SidecarLaneProtocolRelease[] = [];
  for (const obs of fusedContext.protocolEvidence ?? []) {
    if (obs.health === "UNAVAILABLE") {
      continue;
    }
    protocol.push({
      owner: String(obs.payload.owner ?? ""),
      repo: String(obs.payload.repo ?? ""),
      tagName: String(obs.payload.tagName ?? ""),
      releaseName: String(obs.payload.releaseName ?? ""),
      publishedAt: String(obs.payload.publishedAt ?? ""),
      eventTimeUtc: obs.provenance.eventTimeUtc,
    });
  }
  if (protocol.length > 0) {
    lanes.protocol_release = protocol;
  }

  return lanes;
}

export function buildCaptureOutcomes(input: {
  fusedContext: GatewayPollResult["fusedContext"];
  crossObservations: {
    binance?: NormalizedObservation;
    bybit?: NormalizedObservation;
  };
  degradationReasons: readonly string[];
}): Partial<Record<MarketDataProviderId, ProviderCaptureOutcome>> {
  const outcomes: Partial<Record<MarketDataProviderId, ProviderCaptureOutcome>> = {};

  outcomes.htx_spot = outcomeForObservation(
    input.fusedContext.primaryQuote ?? Object.values(input.fusedContext.mtfBars)[0]?.[0],
  );
  outcomes.binance_public = outcomeForObservation(input.crossObservations.binance);
  outcomes.bybit_public = outcomeForObservation(input.crossObservations.bybit);
  outcomes.alternative_me = outcomeForObservation(input.fusedContext.fearGreed);
  outcomes.coingecko_global = outcomeForObservation(input.fusedContext.globalMarket);

  const providerFromObservations = (observations: readonly NormalizedObservation[] | undefined) => {
    for (const obs of observations ?? []) {
      outcomes[obs.provenance.providerId] = outcomeForObservation(obs);
    }
  };

  providerFromObservations(input.fusedContext.macroEvidence);
  providerFromObservations(input.fusedContext.newsEvidence);
  providerFromObservations(input.fusedContext.blockchainEvidence);
  providerFromObservations(input.fusedContext.regulatoryEvidence);
  providerFromObservations(input.fusedContext.protocolEvidence);

  outcomes.htx_spot =
    outcomeForObservation(input.fusedContext.orderBookSnapshot) === "CAPTURED_HEALTHY"
      ? "CAPTURED_HEALTHY"
      : outcomes.htx_spot;

  for (const providerId of MARKET_DATA_PROVIDER_IDS) {
    if (outcomes[providerId] === undefined) {
      const failed = input.degradationReasons.some((reason) => reason.startsWith(`${providerId}_`));
      outcomes[providerId] = failed ? "CAPTURE_FAILED" : "UNAVAILABLE";
    }
  }

  return outcomes;
}

export async function captureProviderSnapshot(input: {
  instrumentId?: InstrumentId;
  fetchImpl?: typeof fetch;
  generatedBy?: string;
  informationSelection?: InformationAcquisitionSelectionV1;
}): Promise<ReplayProviderSidecarV2> {
  assertResearchRuntime("captureProviderSnapshot");

  const instrumentId = input.instrumentId ?? "BTC/USDT";
  const gateway = new MarketDataGateway({
    internalSymbol: instrumentId,
    fetchImpl: input.fetchImpl,
  });

  const bundle = await gateway.pollEvaluationBundle({
    cycleIdPrefix: "m9-sidecar-capture",
    informationSelection: input.informationSelection,
  });

  const crossObservations = {
    binance: bundle.crossExchangeObservations?.binance,
    bybit: bundle.crossExchangeObservations?.bybit,
  };

  const captureAsOfUtc = new Date().toISOString();
  const lanes = serializeFusedContextToSidecarLanes(bundle.fusedContext, crossObservations);
  const captureOutcomes = buildCaptureOutcomes({
    fusedContext: bundle.fusedContext,
    crossObservations,
    degradationReasons: bundle.fusedContext.degradationReasons,
  });

  return {
    schemaVersion: REPLAY_PROVIDER_SIDECAR_V2,
    instrumentId,
    captureAsOfUtc,
    generatedBy: input.generatedBy ?? "capture-provider-snapshot",
    builderGitSha: process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    captureOutcomes,
    lanes,
  };
}
