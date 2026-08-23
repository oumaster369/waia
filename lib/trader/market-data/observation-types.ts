import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";

export const OBSERVATION_SCHEMA_VERSION = "waia.trader.observation.v1" as const;
export const FUSED_CONTEXT_SCHEMA_VERSION = "waia.trader.fused_context.v2" as const;

export const MARKET_DATA_PROVIDER_IDS = [
  "htx_spot",
  "coingecko_global",
  "binance_public",
  "bybit_public",
  "alternative_me",
  "fred",
  "federal_reserve",
  "cme_fedwatch",
  "gdelt",
  "coindesk_rss",
  "cointelegraph_rss",
  "decrypt_rss",
  "binance_announcements",
  "htx_announcements",
  "bybit_announcements",
  "github_releases",
  "infura_rpc",
  "trongrid_intelligence",
  "mempool_space",
  "sec_edgar",
] as const;

export type MarketDataProviderId = (typeof MARKET_DATA_PROVIDER_IDS)[number];

export type SessionPhase = "ASIA" | "EUROPE" | "US" | "OVERLAP" | "UNKNOWN";

export type ProviderHealth = "HEALTHY" | "DEGRADED" | "STALE" | "UNAVAILABLE";

export const NORMALIZED_OBSERVATION_KINDS = [
  "ohlcv_bar",
  "quote_l1",
  "order_book_snapshot",
  "market_trades_snapshot",
  "fear_greed_index",
  "global_market_stats",
  "cross_exchange_confirmation",
  "macro_series",
  "macro_calendar_event",
  "macro_probability",
  "news_headline",
  "news_event_cluster",
  "exchange_announcement",
  "protocol_release",
  "blockchain_network_stats",
  "regulatory_filing",
  "mempool_stats",
] as const;

export type NormalizedObservationKind = (typeof NORMALIZED_OBSERVATION_KINDS)[number];

export type SourceProvenanceRef = {
  providerId: MarketDataProviderId;
  venue: string;
  feedKind: string;
  symbol: string;
  eventTimeUtc: string;
  ingestTimeUtc: string;
};

export type NormalizedObservation = {
  schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
  kind: NormalizedObservationKind;
  interval?: BarInterval;
  sessionPhase: SessionPhase;
  provenance: SourceProvenanceRef;
  health: ProviderHealth;
  freshnessMs: number;
  latencyMs: number;
  confidence: number;
  payload: Record<string, unknown>;
};

export type AsianRangeCorridorMetadata = {
  hypothesisId: "asian_session_range_corridor_v0";
  sessionPhase: SessionPhase;
  rangeHigh: string;
  rangeLow: string;
  rangeWidthBps: number;
  corridorConfidence: number;
  isResearchSeedOnly: true;
};

import type { CrossVenueTriangulation } from "@/lib/trader/intelligence/market-understanding.types";

export type FusedMarketContext = {
  schemaVersion: typeof FUSED_CONTEXT_SCHEMA_VERSION;
  fusedAtUtc: string;
  instrumentId: InstrumentId;
  sessionPhase: SessionPhase;
  mtfBars: Partial<Record<BarInterval, NormalizedObservation[]>>;
  primaryQuote?: NormalizedObservation;
  orderBookSnapshot?: NormalizedObservation;
  marketTradesSnapshot?: NormalizedObservation;
  crossExchangeConfirmation?: NormalizedObservation;
  crossVenueTriangulation?: CrossVenueTriangulation;
  fearGreed?: NormalizedObservation;
  globalMarket?: NormalizedObservation;
  macroEvidence?: NormalizedObservation[];
  newsEvidence?: NormalizedObservation[];
  blockchainEvidence?: NormalizedObservation[];
  regulatoryEvidence?: NormalizedObservation[];
  protocolEvidence?: NormalizedObservation[];
  asianRangeCorridor?: AsianRangeCorridorMetadata;
  aggregateHealth: ProviderHealth;
  aggregateConfidence: number;
  provenance: SourceProvenanceRef[];
  degradationReasons: readonly string[];
};

export const MTF_BAR_INTERVALS = [
  "1m",
  "15m",
  "1h",
  "4h",
  "1d",
] as const satisfies readonly BarInterval[];

export const HTX_PERIOD_BY_INTERVAL: Record<BarInterval, string> = {
  "1m": "1min",
  "15m": "15min",
  "1h": "60min",
  "4h": "4hour",
  "1d": "1day",
};

export const INTERVAL_BY_HTX_PERIOD: Record<string, BarInterval> = {
  "1min": "1m",
  "15min": "15m",
  "60min": "1h",
  "4hour": "4h",
  "1day": "1d",
};
