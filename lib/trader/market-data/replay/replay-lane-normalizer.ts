import {
  buildProvenanceRef,
  normalizeBlockchainNetworkStatsObservation,
  normalizeCrossExchangeConfirmation,
  normalizeExchangeAnnouncementObservation,
  normalizeFearGreedObservation,
  normalizeGlobalMarketObservation,
  normalizeMacroCalendarEventObservation,
  normalizeMacroProbabilityObservation,
  normalizeMacroSeriesObservation,
  normalizeMarketTradesSnapshotObservation,
  normalizeMempoolStatsObservation,
  normalizeNewsEventClusterObservation,
  normalizeNewsHeadlineObservation,
  normalizeOrderBookSnapshotObservation,
  normalizeProtocolReleaseObservation,
  normalizeRegulatoryFilingObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type {
  NormalizedObservation,
  NormalizedObservationKind,
  SourceProvenanceRef,
} from "@/lib/trader/market-data/observation-types";
import type {
  ReplayProviderSidecar,
  ReplayProviderSidecarEntryV1,
  ReplayProviderSidecarLaneKey,
  ReplayProviderSidecarLanesV2,
  ReplayProviderSidecarV1,
  ReplayProviderSidecarV2,
  ReplayProviderSidecarV3,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";
import {
  isReplayProviderSidecarV1,
  isReplayProviderSidecarV2,
  isReplayProviderSidecarV3,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";
import {
  pitResolvedEntriesToLanes,
  resolveSidecarTimelinesAtPit,
  sidecarV1EntryToTimeline,
  sidecarV2LanesToTimelines,
  sidecarV3Lanes,
  type PitTimelineEntry,
} from "@/lib/trader/market-data/replay/replay-pit-selector";

export const FUTURE_EVIDENCE_EXCLUDED = "FUTURE_EVIDENCE_EXCLUDED" as const;
export const SIDECAR_LANE_ABSENT = "SIDECAR_LANE_ABSENT" as const;

export type SidecarObservationBundle = {
  orderBookSnapshot: NormalizedObservation;
  marketTradesSnapshot: NormalizedObservation;
  crossExchangeConfirmation: NormalizedObservation;
  binanceObs?: NormalizedObservation;
  bybitObs?: NormalizedObservation;
  fearGreed: NormalizedObservation;
  globalMarket: NormalizedObservation;
  macroEvidence: NormalizedObservation[];
  newsEvidence: NormalizedObservation[];
  blockchainEvidence: NormalizedObservation[];
  regulatoryEvidence: NormalizedObservation[];
  protocolEvidence: NormalizedObservation[];
};

type LaneAbsentSpec = {
  kind: NormalizedObservationKind;
  providerId: SourceProvenanceRef["providerId"];
  venue: string;
  feedKind: string;
  symbol: "GLOBAL" | "instrument";
};

const SINGULAR_ABSENT_LANE_SPECS: LaneAbsentSpec[] = [
  {
    kind: "fear_greed_index",
    providerId: "alternative_me",
    venue: "alternative_me",
    feedKind: "fear_greed_index",
    symbol: "GLOBAL",
  },
  {
    kind: "global_market_stats",
    providerId: "coingecko_global",
    venue: "coingecko",
    feedKind: "global_market_stats",
    symbol: "GLOBAL",
  },
  {
    kind: "cross_exchange_confirmation",
    providerId: "binance_public",
    venue: "binance",
    feedKind: "cross_exchange_confirmation",
    symbol: "instrument",
  },
  {
    kind: "order_book_snapshot",
    providerId: "htx_spot",
    venue: "htx",
    feedKind: "order_book_snapshot",
    symbol: "instrument",
  },
  {
    kind: "market_trades_snapshot",
    providerId: "htx_spot",
    venue: "htx",
    feedKind: "market_trades_snapshot",
    symbol: "instrument",
  },
];

const ARRAY_ABSENT_LANE_SPECS: LaneAbsentSpec[] = [
  {
    kind: "macro_series",
    providerId: "fred",
    venue: "fred",
    feedKind: "macro_series",
    symbol: "GLOBAL",
  },
  {
    kind: "macro_calendar_event",
    providerId: "federal_reserve",
    venue: "federal_reserve",
    feedKind: "macro_calendar_event",
    symbol: "GLOBAL",
  },
  {
    kind: "macro_probability",
    providerId: "cme_fedwatch",
    venue: "cme",
    feedKind: "macro_probability",
    symbol: "GLOBAL",
  },
  {
    kind: "news_headline",
    providerId: "gdelt",
    venue: "gdelt",
    feedKind: "news_headline",
    symbol: "GLOBAL",
  },
  {
    kind: "news_event_cluster",
    providerId: "gdelt",
    venue: "gdelt",
    feedKind: "news_event_cluster",
    symbol: "GLOBAL",
  },
  {
    kind: "exchange_announcement",
    providerId: "binance_announcements",
    venue: "binance",
    feedKind: "exchange_announcement",
    symbol: "GLOBAL",
  },
  {
    kind: "protocol_release",
    providerId: "github_releases",
    venue: "github",
    feedKind: "protocol_release",
    symbol: "GLOBAL",
  },
  {
    kind: "blockchain_network_stats",
    providerId: "infura_rpc",
    venue: "infura",
    feedKind: "blockchain_network_stats",
    symbol: "GLOBAL",
  },
  {
    kind: "regulatory_filing",
    providerId: "sec_edgar",
    venue: "sec_edgar",
    feedKind: "regulatory_filing",
    symbol: "GLOBAL",
  },
  {
    kind: "mempool_stats",
    providerId: "mempool_space",
    venue: "mempool_space",
    feedKind: "mempool_stats",
    symbol: "GLOBAL",
  },
];

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

export function guardNoLookahead(input: {
  observation: NormalizedObservation;
  evaluatedAt: string;
  degradationReasons: string[];
}): NormalizedObservation {
  const eventMs = Date.parse(input.observation.provenance.eventTimeUtc);
  const cycleMs = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(eventMs) || !Number.isFinite(cycleMs) || eventMs <= cycleMs) {
    return input.observation;
  }
  input.degradationReasons.push(
    `${input.observation.provenance.providerId}_future_excluded:${input.observation.kind}`,
  );
  return normalizeUnavailableObservation({
    kind: input.observation.kind,
    provenance: input.observation.provenance,
    evaluatedAt: input.evaluatedAt,
    reason: FUTURE_EVIDENCE_EXCLUDED,
  });
}

function unavailableLane(input: {
  kind: NormalizedObservationKind;
  providerId: SourceProvenanceRef["providerId"];
  venue: string;
  feedKind: string;
  symbol: string;
  evaluatedAt: string;
  reason: string;
}): NormalizedObservation {
  return normalizeUnavailableObservation({
    kind: input.kind,
    provenance: replayProvenance({
      providerId: input.providerId,
      venue: input.venue,
      feedKind: input.feedKind,
      symbol: input.symbol,
      eventTimeUtc: input.evaluatedAt,
      evaluatedAt: input.evaluatedAt,
    }),
    evaluatedAt: input.evaluatedAt,
    reason: input.reason,
  });
}

function finalizeObservation(
  observation: NormalizedObservation,
  evaluatedAt: string,
  degradationReasons: string[],
): NormalizedObservation {
  return guardNoLookahead({ observation, evaluatedAt, degradationReasons });
}

function absentLaneObservation(
  spec: LaneAbsentSpec,
  instrumentId: string,
  evaluatedAt: string,
): NormalizedObservation {
  return unavailableLane({
    kind: spec.kind,
    providerId: spec.providerId,
    venue: spec.venue,
    feedKind: spec.feedKind,
    symbol: spec.symbol === "GLOBAL" ? "GLOBAL" : instrumentId,
    evaluatedAt,
    reason: SIDECAR_LANE_ABSENT,
  });
}

function hasObservationKind(
  observations: NormalizedObservation[],
  kind: NormalizedObservationKind,
): boolean {
  return observations.some((observation) => observation.kind === kind);
}

export function ensureExplicitAbsentLanes(input: {
  bundle: Partial<SidecarObservationBundle>;
  instrumentId: string;
  evaluatedAt: string;
  degradationReasons: string[];
}): SidecarObservationBundle {
  const macroEvidence = [...(input.bundle.macroEvidence ?? [])];
  const newsEvidence = [...(input.bundle.newsEvidence ?? [])];
  const blockchainEvidence = [...(input.bundle.blockchainEvidence ?? [])];
  const regulatoryEvidence = [...(input.bundle.regulatoryEvidence ?? [])];
  const protocolEvidence = [...(input.bundle.protocolEvidence ?? [])];

  let fearGreed = input.bundle.fearGreed;
  let globalMarket = input.bundle.globalMarket;
  let orderBookSnapshot = input.bundle.orderBookSnapshot;
  let marketTradesSnapshot = input.bundle.marketTradesSnapshot;
  let crossExchangeConfirmation = input.bundle.crossExchangeConfirmation;

  for (const spec of SINGULAR_ABSENT_LANE_SPECS) {
    const pushReason = () => {
      input.degradationReasons.push(`${spec.feedKind}_unavailable:${SIDECAR_LANE_ABSENT}`);
    };

    if (spec.kind === "fear_greed_index" && !fearGreed) {
      fearGreed = absentLaneObservation(spec, input.instrumentId, input.evaluatedAt);
      pushReason();
    }
    if (spec.kind === "global_market_stats" && !globalMarket) {
      globalMarket = absentLaneObservation(spec, input.instrumentId, input.evaluatedAt);
      pushReason();
    }
    if (spec.kind === "order_book_snapshot" && !orderBookSnapshot) {
      orderBookSnapshot = absentLaneObservation(spec, input.instrumentId, input.evaluatedAt);
      pushReason();
    }
    if (spec.kind === "market_trades_snapshot" && !marketTradesSnapshot) {
      marketTradesSnapshot = absentLaneObservation(spec, input.instrumentId, input.evaluatedAt);
      pushReason();
    }
    if (
      spec.kind === "cross_exchange_confirmation" &&
      !crossExchangeConfirmation &&
      !input.bundle.binanceObs &&
      !input.bundle.bybitObs
    ) {
      crossExchangeConfirmation = absentLaneObservation(
        spec,
        input.instrumentId,
        input.evaluatedAt,
      );
      pushReason();
    }
  }

  for (const spec of ARRAY_ABSENT_LANE_SPECS) {
    const target =
      spec.kind === "macro_series" ||
      spec.kind === "macro_calendar_event" ||
      spec.kind === "macro_probability"
        ? macroEvidence
        : spec.kind === "news_headline" ||
            spec.kind === "news_event_cluster" ||
            spec.kind === "exchange_announcement"
          ? newsEvidence
          : spec.kind === "blockchain_network_stats" || spec.kind === "mempool_stats"
            ? blockchainEvidence
            : spec.kind === "regulatory_filing"
              ? regulatoryEvidence
              : protocolEvidence;

    if (!hasObservationKind(target, spec.kind)) {
      target.push(absentLaneObservation(spec, input.instrumentId, input.evaluatedAt));
      input.degradationReasons.push(`${spec.feedKind}_unavailable:${SIDECAR_LANE_ABSENT}`);
    }
  }

  if (!crossExchangeConfirmation && (input.bundle.binanceObs || input.bundle.bybitObs)) {
    const binanceObs = input.bundle.binanceObs;
    const bybitObs = input.bundle.bybitObs;
    crossExchangeConfirmation =
      binanceObs && bybitObs
        ? binanceObs.confidence >= bybitObs.confidence
          ? binanceObs
          : bybitObs
        : (binanceObs ?? bybitObs)!;
  }

  return {
    orderBookSnapshot: orderBookSnapshot!,
    marketTradesSnapshot: marketTradesSnapshot!,
    crossExchangeConfirmation: crossExchangeConfirmation!,
    binanceObs: input.bundle.binanceObs,
    bybitObs: input.bundle.bybitObs,
    fearGreed: fearGreed!,
    globalMarket: globalMarket!,
    macroEvidence,
    newsEvidence,
    blockchainEvidence,
    regulatoryEvidence,
    protocolEvidence,
  };
}

export function buildObservationsFromSidecarV2(input: {
  lanes: ReplayProviderSidecarLanesV2;
  instrumentId: string;
  primaryLast: string;
  evaluatedAt: string;
  captureAsOfUtc: string;
  degradationReasons: string[];
}): SidecarObservationBundle {
  const { lanes, instrumentId, primaryLast, evaluatedAt, captureAsOfUtc, degradationReasons } =
    input;

  const macroEvidence: NormalizedObservation[] = [];
  const newsEvidence: NormalizedObservation[] = [];
  const blockchainEvidence: NormalizedObservation[] = [];
  const regulatoryEvidence: NormalizedObservation[] = [];
  const protocolEvidence: NormalizedObservation[] = [];

  let orderBookSnapshot: NormalizedObservation | undefined;
  let marketTradesSnapshot: NormalizedObservation | undefined;
  let fearGreed: NormalizedObservation | undefined;
  let globalMarket: NormalizedObservation | undefined;
  let binanceObs: NormalizedObservation | undefined;
  let bybitObs: NormalizedObservation | undefined;

  if (lanes.order_book_snapshot) {
    const lane = lanes.order_book_snapshot;
    orderBookSnapshot = finalizeObservation(
      normalizeOrderBookSnapshotObservation({
        symbol: instrumentId,
        bidLevels: [[lane.bestBid, 1]],
        askLevels: [[lane.bestAsk, 1]],
        eventTimeUtc: lane.eventTimeUtc,
        provenance: replayProvenance({
          providerId: "htx_spot",
          venue: "htx",
          feedKind: "order_book_snapshot",
          symbol: instrumentId,
          eventTimeUtc: lane.eventTimeUtc,
          evaluatedAt,
          captureAsOfUtc,
        }),
        latencyMs: 0,
        evaluatedAt,
      }),
      evaluatedAt,
      degradationReasons,
    );
  }

  if (lanes.market_trades_snapshot) {
    const lane = lanes.market_trades_snapshot;
    marketTradesSnapshot = finalizeObservation(
      normalizeMarketTradesSnapshotObservation({
        symbol: instrumentId,
        trades: lane.latestPrice
          ? [{ id: 0, price: lane.latestPrice, amount: 0, ts: Date.parse(lane.eventTimeUtc) }]
          : [],
        eventTimeUtc: lane.eventTimeUtc,
        provenance: replayProvenance({
          providerId: "htx_spot",
          venue: "htx",
          feedKind: "market_trades_snapshot",
          symbol: instrumentId,
          eventTimeUtc: lane.eventTimeUtc,
          evaluatedAt,
          captureAsOfUtc,
        }),
        latencyMs: 0,
        evaluatedAt,
      }),
      evaluatedAt,
      degradationReasons,
    );
  }

  for (const cross of lanes.cross_exchange_confirmation ?? []) {
    const obs = finalizeObservation(
      normalizeCrossExchangeConfirmation({
        symbol: instrumentId,
        primaryLast,
        confirmLast: cross.confirmLast,
        confirmVenue: cross.confirmVenue,
        provenance: replayProvenance({
          providerId: cross.confirmVenue === "binance" ? "binance_public" : "bybit_public",
          venue: cross.confirmVenue,
          feedKind: "cross_exchange_confirmation",
          symbol: instrumentId,
          eventTimeUtc: cross.eventTimeUtc,
          evaluatedAt,
          captureAsOfUtc,
        }),
        latencyMs: 0,
        evaluatedAt,
      }),
      evaluatedAt,
      degradationReasons,
    );
    if (cross.confirmVenue === "binance") {
      binanceObs = obs;
    } else {
      bybitObs = obs;
    }
  }

  if (lanes.fear_greed_index) {
    const lane = lanes.fear_greed_index;
    fearGreed = finalizeObservation(
      normalizeFearGreedObservation({
        value: lane.value,
        classification: lane.classification,
        provenance: replayProvenance({
          providerId: "alternative_me",
          venue: "alternative_me",
          feedKind: "fear_greed_index",
          symbol: "GLOBAL",
          eventTimeUtc: lane.eventTimeUtc,
          evaluatedAt,
          captureAsOfUtc,
        }),
        latencyMs: 0,
        evaluatedAt,
        eventTimeUtc: lane.eventTimeUtc,
      }),
      evaluatedAt,
      degradationReasons,
    );
  }

  if (lanes.global_market_stats) {
    const lane = lanes.global_market_stats;
    globalMarket = finalizeObservation(
      normalizeGlobalMarketObservation({
        btcDominance: lane.btcDominance,
        marketCapUsd: lane.marketCapUsd,
        provenance: replayProvenance({
          providerId: "coingecko_global",
          venue: "coingecko",
          feedKind: "global_market_stats",
          symbol: "GLOBAL",
          eventTimeUtc: lane.eventTimeUtc,
          evaluatedAt,
          captureAsOfUtc,
        }),
        latencyMs: 0,
        evaluatedAt,
        eventTimeUtc: lane.eventTimeUtc,
      }),
      evaluatedAt,
      degradationReasons,
    );
  }

  for (const lane of lanes.macro_series ?? []) {
    macroEvidence.push(
      finalizeObservation(
        normalizeMacroSeriesObservation({
          seriesId: lane.seriesId,
          value: lane.value,
          observationDate: lane.observationDate,
          provenance: replayProvenance({
            providerId: "fred",
            venue: "fred",
            feedKind: "macro_series",
            symbol: "GLOBAL",
            eventTimeUtc: lane.eventTimeUtc,
            evaluatedAt,
            captureAsOfUtc,
          }),
          latencyMs: 0,
          evaluatedAt,
          eventTimeUtc: lane.eventTimeUtc,
        }),
        evaluatedAt,
        degradationReasons,
      ),
    );
  }

  for (const lane of lanes.macro_calendar_event ?? []) {
    macroEvidence.push(
      finalizeObservation(
        normalizeMacroCalendarEventObservation({
          eventId: lane.eventId,
          title: lane.title,
          startUtc: lane.startUtc,
          category: lane.category,
          provenance: replayProvenance({
            providerId: "federal_reserve",
            venue: "federal_reserve",
            feedKind: "macro_calendar_event",
            symbol: "GLOBAL",
            eventTimeUtc: lane.eventTimeUtc,
            evaluatedAt,
            captureAsOfUtc,
          }),
          latencyMs: 0,
          evaluatedAt,
          eventTimeUtc: lane.eventTimeUtc,
        }),
        evaluatedAt,
        degradationReasons,
      ),
    );
  }

  for (const lane of lanes.macro_probability ?? []) {
    macroEvidence.push(
      finalizeObservation(
        normalizeMacroProbabilityObservation({
          meetingDate: lane.meetingDate,
          probability: lane.probability,
          targetRateRange: lane.targetRateRange,
          provenance: replayProvenance({
            providerId: "cme_fedwatch",
            venue: "cme",
            feedKind: "macro_probability",
            symbol: "GLOBAL",
            eventTimeUtc: lane.eventTimeUtc,
            evaluatedAt,
            captureAsOfUtc,
          }),
          latencyMs: 0,
          evaluatedAt,
          eventTimeUtc: lane.eventTimeUtc,
        }),
        evaluatedAt,
        degradationReasons,
      ),
    );
  }

  for (const lane of lanes.news_headline ?? []) {
    newsEvidence.push(
      finalizeObservation(
        normalizeNewsHeadlineObservation({
          headline: lane.headline,
          url: lane.url,
          source: lane.source,
          publishedAt: lane.publishedAt,
          provenance: replayProvenance({
            providerId: lane.providerId,
            venue: lane.providerId.replace(/_rss$/, ""),
            feedKind: "news_headline",
            symbol: "GLOBAL",
            eventTimeUtc: lane.eventTimeUtc,
            evaluatedAt,
            captureAsOfUtc,
          }),
          latencyMs: 0,
          evaluatedAt,
          eventTimeUtc: lane.eventTimeUtc,
        }),
        evaluatedAt,
        degradationReasons,
      ),
    );
  }

  if (lanes.news_event_cluster) {
    const lane = lanes.news_event_cluster;
    newsEvidence.push(
      finalizeObservation(
        normalizeNewsEventClusterObservation({
          clusterId: lane.clusterId,
          query: lane.query,
          articleCount: lane.articleCount,
          topHeadline: lane.topHeadline,
          provenance: replayProvenance({
            providerId: "gdelt",
            venue: "gdelt",
            feedKind: "news_event_cluster",
            symbol: "GLOBAL",
            eventTimeUtc: lane.eventTimeUtc,
            evaluatedAt,
            captureAsOfUtc,
          }),
          latencyMs: 0,
          evaluatedAt,
          eventTimeUtc: lane.eventTimeUtc,
        }),
        evaluatedAt,
        degradationReasons,
      ),
    );
  }

  for (const lane of lanes.exchange_announcement ?? []) {
    newsEvidence.push(
      finalizeObservation(
        normalizeExchangeAnnouncementObservation({
          announcementId: lane.announcementId,
          title: lane.title,
          venue: lane.venue,
          publishedAt: lane.publishedAt,
          provenance: replayProvenance({
            providerId: lane.providerId,
            venue: lane.venue,
            feedKind: "exchange_announcement",
            symbol: "GLOBAL",
            eventTimeUtc: lane.eventTimeUtc,
            evaluatedAt,
            captureAsOfUtc,
          }),
          latencyMs: 0,
          evaluatedAt,
          eventTimeUtc: lane.eventTimeUtc,
        }),
        evaluatedAt,
        degradationReasons,
      ),
    );
  }

  for (const lane of lanes.blockchain_network_stats ?? []) {
    blockchainEvidence.push(
      finalizeObservation(
        normalizeBlockchainNetworkStatsObservation({
          network: lane.network,
          blockNumber: lane.blockNumber,
          gasPriceWei: lane.gasPriceWei,
          chainParameterCount: lane.chainParameterCount,
          provenance: replayProvenance({
            providerId: lane.providerId,
            venue: lane.providerId === "infura_rpc" ? "infura" : "trongrid",
            feedKind: "blockchain_network_stats",
            symbol: "GLOBAL",
            eventTimeUtc: lane.eventTimeUtc,
            evaluatedAt,
            captureAsOfUtc,
          }),
          latencyMs: 0,
          evaluatedAt,
          eventTimeUtc: lane.eventTimeUtc,
        }),
        evaluatedAt,
        degradationReasons,
      ),
    );
  }

  if (lanes.mempool_stats) {
    const lane = lanes.mempool_stats;
    blockchainEvidence.push(
      finalizeObservation(
        normalizeMempoolStatsObservation({
          count: lane.count,
          vsize: lane.vsize,
          totalFee: lane.totalFee,
          fastestFee: lane.fastestFee,
          provenance: replayProvenance({
            providerId: "mempool_space",
            venue: "mempool_space",
            feedKind: "mempool_stats",
            symbol: "GLOBAL",
            eventTimeUtc: lane.eventTimeUtc,
            evaluatedAt,
            captureAsOfUtc,
          }),
          latencyMs: 0,
          evaluatedAt,
          eventTimeUtc: lane.eventTimeUtc,
        }),
        evaluatedAt,
        degradationReasons,
      ),
    );
  }

  for (const lane of lanes.regulatory_filing ?? []) {
    regulatoryEvidence.push(
      finalizeObservation(
        normalizeRegulatoryFilingObservation({
          cik: lane.cik,
          accessionNumber: lane.accessionNumber,
          form: lane.form,
          filingDate: lane.filingDate,
          provenance: replayProvenance({
            providerId: "sec_edgar",
            venue: "sec_edgar",
            feedKind: "regulatory_filing",
            symbol: "GLOBAL",
            eventTimeUtc: lane.eventTimeUtc,
            evaluatedAt,
            captureAsOfUtc,
          }),
          latencyMs: 0,
          evaluatedAt,
          eventTimeUtc: lane.eventTimeUtc,
        }),
        evaluatedAt,
        degradationReasons,
      ),
    );
  }

  for (const lane of lanes.protocol_release ?? []) {
    protocolEvidence.push(
      finalizeObservation(
        normalizeProtocolReleaseObservation({
          owner: lane.owner,
          repo: lane.repo,
          tagName: lane.tagName,
          releaseName: lane.releaseName,
          publishedAt: lane.publishedAt,
          provenance: replayProvenance({
            providerId: "github_releases",
            venue: "github",
            feedKind: "protocol_release",
            symbol: "GLOBAL",
            eventTimeUtc: lane.eventTimeUtc,
            evaluatedAt,
            captureAsOfUtc,
          }),
          latencyMs: 0,
          evaluatedAt,
          eventTimeUtc: lane.eventTimeUtc,
        }),
        evaluatedAt,
        degradationReasons,
      ),
    );
  }

  return ensureExplicitAbsentLanes({
    bundle: {
      orderBookSnapshot,
      marketTradesSnapshot,
      binanceObs,
      bybitObs,
      fearGreed,
      globalMarket,
      macroEvidence,
      newsEvidence,
      blockchainEvidence,
      regulatoryEvidence,
      protocolEvidence,
    },
    instrumentId,
    evaluatedAt,
    degradationReasons,
  });
}

export function buildObservationsFromSidecarV1(input: {
  sidecar: ReplayProviderSidecarV1;
  sidecarEntry: ReplayProviderSidecarEntryV1 | undefined;
  instrumentId: string;
  primaryLast: string;
  evaluatedAt: string;
  degradationReasons: string[];
}): {
  crossExchangeConfirmation?: NormalizedObservation;
  binanceObs?: NormalizedObservation;
  bybitObs?: NormalizedObservation;
  fearGreed?: NormalizedObservation;
  globalMarket?: NormalizedObservation;
} {
  const { sidecarEntry, instrumentId, primaryLast, evaluatedAt, degradationReasons } = input;
  if (!sidecarEntry) {
    return {};
  }

  let binanceObs: NormalizedObservation | undefined;
  let bybitObs: NormalizedObservation | undefined;

  if (sidecarEntry.binanceConfirmLast) {
    binanceObs = finalizeObservation(
      normalizeCrossExchangeConfirmation({
        symbol: instrumentId,
        primaryLast,
        confirmLast: sidecarEntry.binanceConfirmLast,
        confirmVenue: "binance",
        provenance: replayProvenance({
          providerId: "binance_public",
          venue: "binance",
          feedKind: "cross_exchange_confirmation",
          symbol: instrumentId,
          eventTimeUtc: evaluatedAt,
          evaluatedAt,
        }),
        latencyMs: 0,
        evaluatedAt,
      }),
      evaluatedAt,
      degradationReasons,
    );
  }

  if (sidecarEntry.bybitConfirmLast) {
    bybitObs = finalizeObservation(
      normalizeCrossExchangeConfirmation({
        symbol: instrumentId,
        primaryLast,
        confirmLast: sidecarEntry.bybitConfirmLast,
        confirmVenue: "bybit",
        provenance: replayProvenance({
          providerId: "bybit_public",
          venue: "bybit",
          feedKind: "cross_exchange_confirmation",
          symbol: instrumentId,
          eventTimeUtc: evaluatedAt,
          evaluatedAt,
        }),
        latencyMs: 0,
        evaluatedAt,
      }),
      evaluatedAt,
      degradationReasons,
    );
  }

  let fearGreed: NormalizedObservation | undefined;
  if (sidecarEntry.fearGreed) {
    fearGreed = finalizeObservation(
      normalizeFearGreedObservation({
        value: sidecarEntry.fearGreed.value,
        classification: sidecarEntry.fearGreed.classification,
        provenance: replayProvenance({
          providerId: "alternative_me",
          venue: "alternative_me",
          feedKind: "fear_greed_index",
          symbol: "GLOBAL",
          eventTimeUtc: evaluatedAt,
          evaluatedAt,
        }),
        latencyMs: 0,
        evaluatedAt,
        eventTimeUtc: evaluatedAt,
      }),
      evaluatedAt,
      degradationReasons,
    );
  }

  let globalMarket: NormalizedObservation | undefined;
  if (sidecarEntry.globalMarket) {
    globalMarket = finalizeObservation(
      normalizeGlobalMarketObservation({
        btcDominance: sidecarEntry.globalMarket.btcDominance,
        marketCapUsd: sidecarEntry.globalMarket.marketCapUsd,
        provenance: replayProvenance({
          providerId: "coingecko_global",
          venue: "coingecko",
          feedKind: "global_market_stats",
          symbol: "GLOBAL",
          eventTimeUtc: evaluatedAt,
          evaluatedAt,
        }),
        latencyMs: 0,
        evaluatedAt,
        eventTimeUtc: evaluatedAt,
      }),
      evaluatedAt,
      degradationReasons,
    );
  }

  const crossExchangeConfirmation =
    binanceObs && bybitObs
      ? binanceObs.confidence >= bybitObs.confidence
        ? binanceObs
        : bybitObs
      : (binanceObs ?? bybitObs);

  return { crossExchangeConfirmation, binanceObs, bybitObs, fearGreed, globalMarket };
}

export function buildObservationsFromSidecarAtPit(input: {
  sidecar: ReplayProviderSidecar;
  sidecarEntryV1?: ReplayProviderSidecarEntryV1;
  instrumentId: string;
  primaryLast: string;
  evaluatedAt: string;
  degradationReasons: string[];
}): SidecarObservationBundle {
  let timelines: Partial<Record<ReplayProviderSidecarLaneKey, PitTimelineEntry[]>> = {};
  let captureAsOfUtc = input.evaluatedAt;

  if (isReplayProviderSidecarV3(input.sidecar)) {
    timelines = sidecarV3Lanes(input.sidecar.lanes);
  } else if (isReplayProviderSidecarV2(input.sidecar)) {
    timelines = sidecarV2LanesToTimelines(input.sidecar.lanes, input.sidecar.captureAsOfUtc);
    captureAsOfUtc = input.sidecar.captureAsOfUtc;
  } else if (isReplayProviderSidecarV1(input.sidecar)) {
    const entry =
      input.sidecarEntryV1 ??
      input.sidecar.entries.find((candidate) => candidate.evaluatedAt === input.evaluatedAt);
    if (entry) {
      timelines = sidecarV1EntryToTimeline(entry, input.evaluatedAt);
    }
  }

  const resolved = resolveSidecarTimelinesAtPit({
    timelines,
    evaluatedAtUtc: input.evaluatedAt,
  });
  const lanes = pitResolvedEntriesToLanes(resolved);

  return buildObservationsFromSidecarV2({
    lanes,
    instrumentId: input.instrumentId,
    primaryLast: input.primaryLast,
    evaluatedAt: input.evaluatedAt,
    captureAsOfUtc,
    degradationReasons: input.degradationReasons,
  });
}

export function buildObservationsFromSidecarV3(input: {
  sidecar: ReplayProviderSidecarV3;
  instrumentId: string;
  primaryLast: string;
  evaluatedAt: string;
  degradationReasons: string[];
}): SidecarObservationBundle {
  return buildObservationsFromSidecarAtPit({
    sidecar: input.sidecar,
    instrumentId: input.instrumentId,
    primaryLast: input.primaryLast,
    evaluatedAt: input.evaluatedAt,
    degradationReasons: input.degradationReasons,
  });
}

export function markAbsentEvidenceLanes(input: {
  evaluatedAt: string;
  instrumentId: string;
  degradationReasons: string[];
  hasSidecar: boolean;
}): SidecarObservationBundle | Partial<SidecarObservationBundle> {
  if (input.hasSidecar) {
    return {};
  }

  input.degradationReasons.push("sidecar_absent:advanced_lanes_unavailable");
  return ensureExplicitAbsentLanes({
    bundle: {},
    instrumentId: input.instrumentId,
    evaluatedAt: input.evaluatedAt,
    degradationReasons: input.degradationReasons,
  });
}
