import type { Bar, BarInterval, Quote } from "@/lib/trader/intelligence/types";
import {
  OBSERVATION_SCHEMA_VERSION,
  type NormalizedObservation,
  type SourceProvenanceRef,
} from "@/lib/trader/market-data/observation-types";
import { scoreObservationReliabilityWithPolicy } from "@/lib/trader/market-data/reliability/freshness-policy";
import { classifySessionPhaseUtc } from "@/lib/trader/market-data/session/session-phase-classifier";

export function buildProvenanceRef(input: {
  providerId: SourceProvenanceRef["providerId"];
  venue: string;
  feedKind: string;
  symbol: string;
  eventTimeUtc: string;
  ingestTimeUtc?: string;
}): SourceProvenanceRef {
  return {
    providerId: input.providerId,
    venue: input.venue,
    feedKind: input.feedKind,
    symbol: input.symbol,
    eventTimeUtc: input.eventTimeUtc,
    ingestTimeUtc: input.ingestTimeUtc ?? new Date().toISOString(),
  };
}

function computeFreshnessMs(evaluatedAt: string, eventTimeUtc: string): number {
  return Math.max(0, Date.parse(evaluatedAt) - Date.parse(eventTimeUtc));
}

export function normalizeOhlcvBarsObservation(input: {
  bars: readonly Bar[];
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
}): NormalizedObservation {
  const latest = input.bars[input.bars.length - 1];
  const first = input.bars[0];
  const eventTime = latest?.barCloseTime ?? input.evaluatedAt;
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, eventTime);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "ohlcv_bar",
    freshnessMs,
  });

  let openCloseDeltaPct: number | undefined;
  if (first && latest) {
    const open = Number(first.open);
    const close = Number(latest.close);
    if (Number.isFinite(open) && Number.isFinite(close) && open > 0) {
      openCloseDeltaPct = ((close - open) / open) * 100;
    }
  }

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "ohlcv_bar",
    interval: latest?.interval,
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      barCount: input.bars.length,
      latestClose: latest?.close,
      latestBarCloseTime: latest?.barCloseTime,
      openCloseDeltaPct,
    },
  };
}

export function normalizeQuoteObservation(input: {
  quote: Quote;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.quote.timestamp);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "quote_l1",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "quote_l1",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      bid: input.quote.bid,
      ask: input.quote.ask,
      last: input.quote.last,
      timestamp: input.quote.timestamp,
    },
  };
}

export function normalizeOrderBookSnapshotObservation(input: {
  symbol: string;
  bidLevels: readonly [number, number][];
  askLevels: readonly [number, number][];
  eventTimeUtc: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "order_book_snapshot",
    freshnessMs,
  });

  const bestBid = input.bidLevels[0]?.[0];
  const bestAsk = input.askLevels[0]?.[0];

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "order_book_snapshot",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      symbol: input.symbol,
      bidLevels: input.bidLevels.length,
      askLevels: input.askLevels.length,
      bestBid,
      bestAsk,
      eventTimeUtc: input.eventTimeUtc,
    },
  };
}

export function normalizeMarketTradesSnapshotObservation(input: {
  symbol: string;
  trades: readonly {
    id: number | string;
    price: number;
    amount: number;
    direction?: string;
    ts: number;
  }[];
  eventTimeUtc: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "market_trades_snapshot",
    freshnessMs,
  });

  const latestTrade = input.trades[0];

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "market_trades_snapshot",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      symbol: input.symbol,
      tradeCount: input.trades.length,
      latestPrice: latestTrade?.price,
      latestAmount: latestTrade?.amount,
      latestDirection: latestTrade?.direction,
      eventTimeUtc: input.eventTimeUtc,
    },
  };
}

export function normalizeCrossExchangeConfirmation(input: {
  symbol: string;
  primaryLast: string;
  confirmLast: string;
  confirmVenue: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
}): NormalizedObservation {
  const primary = Number(input.primaryLast);
  const confirm = Number(input.confirmLast);
  const dislocationBps =
    primary > 0 ? (Math.abs(confirm - primary) / primary) * 10_000 : Number.POSITIVE_INFINITY;

  const baseConfidence = dislocationBps <= 25 ? 0.95 : dislocationBps <= 75 ? 0.7 : 0.4;
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "cross_exchange_confirmation",
    freshnessMs: 0,
    baseConfidence,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "cross_exchange_confirmation",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs: 0,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      symbol: input.symbol,
      primaryLast: input.primaryLast,
      confirmLast: input.confirmLast,
      confirmVenue: input.confirmVenue,
      dislocationBps,
      aligned: dislocationBps <= 25,
    },
  };
}

export function normalizeFearGreedObservation(input: {
  value: number;
  classification: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "fear_greed_index",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "fear_greed_index",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      value: input.value,
      classification: input.classification,
    },
  };
}

export function normalizeGlobalMarketObservation(input: {
  btcDominance: number;
  marketCapUsd: number;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "global_market_stats",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "global_market_stats",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      btcDominance: input.btcDominance,
      marketCapUsd: input.marketCapUsd,
    },
  };
}

export function normalizeMacroSeriesObservation(input: {
  seriesId: string;
  value: number;
  observationDate: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "macro_series",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "macro_series",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      seriesId: input.seriesId,
      value: input.value,
      observationDate: input.observationDate,
    },
  };
}

export function normalizeMacroCalendarEventObservation(input: {
  eventId: string;
  title: string;
  startUtc: string;
  category?: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "macro_calendar_event",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "macro_calendar_event",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      eventId: input.eventId,
      title: input.title,
      startUtc: input.startUtc,
      category: input.category,
    },
  };
}

export function normalizeMacroProbabilityObservation(input: {
  meetingDate: string;
  probability: number;
  targetRateRange?: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "macro_probability",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "macro_probability",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      meetingDate: input.meetingDate,
      probability: input.probability,
      targetRateRange: input.targetRateRange,
    },
  };
}

export function normalizeNewsHeadlineObservation(input: {
  headline: string;
  url: string;
  source: string;
  publishedAt?: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "news_headline",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "news_headline",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      headline: input.headline,
      url: input.url,
      source: input.source,
      publishedAt: input.publishedAt,
    },
  };
}

export function normalizeNewsEventClusterObservation(input: {
  clusterId: string;
  query: string;
  articleCount: number;
  topHeadline?: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "news_event_cluster",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "news_event_cluster",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      clusterId: input.clusterId,
      query: input.query,
      articleCount: input.articleCount,
      topHeadline: input.topHeadline,
    },
  };
}

export function normalizeExchangeAnnouncementObservation(input: {
  announcementId: string;
  title: string;
  venue: string;
  publishedAt?: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "exchange_announcement",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "exchange_announcement",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      announcementId: input.announcementId,
      title: input.title,
      venue: input.venue,
      publishedAt: input.publishedAt,
    },
  };
}

export function normalizeProtocolReleaseObservation(input: {
  owner: string;
  repo: string;
  tagName: string;
  releaseName: string;
  publishedAt: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "protocol_release",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "protocol_release",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      owner: input.owner,
      repo: input.repo,
      tagName: input.tagName,
      releaseName: input.releaseName,
      publishedAt: input.publishedAt,
    },
  };
}

export function normalizeBlockchainNetworkStatsObservation(input: {
  network: string;
  blockNumber?: string;
  gasPriceWei?: string;
  chainParameterCount?: number;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "blockchain_network_stats",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "blockchain_network_stats",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      network: input.network,
      blockNumber: input.blockNumber,
      gasPriceWei: input.gasPriceWei,
      chainParameterCount: input.chainParameterCount,
    },
  };
}

export function normalizeRegulatoryFilingObservation(input: {
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "regulatory_filing",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "regulatory_filing",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      cik: input.cik,
      accessionNumber: input.accessionNumber,
      form: input.form,
      filingDate: input.filingDate,
    },
  };
}

export function normalizeMempoolStatsObservation(input: {
  count: number;
  vsize: number;
  totalFee: number;
  fastestFee?: number;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = computeFreshnessMs(input.evaluatedAt, input.eventTimeUtc);
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: "mempool_stats",
    freshnessMs,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "mempool_stats",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      count: input.count,
      vsize: input.vsize,
      totalFee: input.totalFee,
      fastestFee: input.fastestFee,
    },
  };
}

export function normalizeUnavailableObservation(input: {
  kind: NormalizedObservation["kind"];
  provenance: SourceProvenanceRef;
  evaluatedAt: string;
  reason: string;
  interval?: BarInterval;
}): NormalizedObservation {
  const reliability = scoreObservationReliabilityWithPolicy({
    kind: input.kind,
    freshnessMs: 0,
    unavailable: true,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: input.kind,
    interval: input.interval,
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs: 0,
    latencyMs: 0,
    confidence: reliability.confidence,
    payload: {
      unavailable: true,
      reason: input.reason,
    },
  };
}
