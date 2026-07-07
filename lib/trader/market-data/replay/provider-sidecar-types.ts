import type { MarketDataProviderId } from "@/lib/trader/market-data/observation-types";

export const REPLAY_PROVIDER_SIDECAR_V1 = "waia.trader.m9_provider_sidecar.v1" as const;
export const REPLAY_PROVIDER_SIDECAR_V2 = "waia.trader.m9_provider_sidecar.v2" as const;

export type ProviderCaptureOutcome = "CAPTURED_HEALTHY" | "CAPTURE_FAILED" | "UNAVAILABLE";

export type ReplayProviderSidecarEntryV1 = {
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

export type ReplayProviderSidecarV1 = {
  schemaVersion: typeof REPLAY_PROVIDER_SIDECAR_V1;
  instrumentId: string;
  entries: ReplayProviderSidecarEntryV1[];
};

export type SidecarLaneFearGreed = {
  value: number;
  classification: string;
  eventTimeUtc: string;
};

export type SidecarLaneGlobalMarket = {
  btcDominance: number;
  marketCapUsd: number;
  eventTimeUtc: string;
};

export type SidecarLaneCrossExchange = {
  confirmVenue: "binance" | "bybit";
  confirmLast: string;
  eventTimeUtc: string;
};

export type SidecarLaneOrderBook = {
  bestBid: number;
  bestAsk: number;
  bidLevels: number;
  askLevels: number;
  eventTimeUtc: string;
};

export type SidecarLaneMarketTrades = {
  tradeCount: number;
  latestPrice?: number;
  eventTimeUtc: string;
};

export type SidecarLaneMacroSeries = {
  seriesId: string;
  value: number;
  observationDate: string;
  eventTimeUtc: string;
};

export type SidecarLaneMacroCalendar = {
  eventId: string;
  title: string;
  startUtc: string;
  category?: string;
  eventTimeUtc: string;
};

export type SidecarLaneMacroProbability = {
  meetingDate: string;
  probability: number;
  targetRateRange?: string;
  eventTimeUtc: string;
};

export type SidecarLaneNewsHeadline = {
  headline: string;
  url: string;
  source: string;
  publishedAt?: string;
  eventTimeUtc: string;
  providerId: MarketDataProviderId;
};

export type SidecarLaneNewsCluster = {
  clusterId: string;
  query: string;
  articleCount: number;
  topHeadline?: string;
  eventTimeUtc: string;
};

export type SidecarLaneExchangeAnnouncement = {
  announcementId: string;
  title: string;
  venue: string;
  publishedAt?: string;
  eventTimeUtc: string;
  providerId: MarketDataProviderId;
};

export type SidecarLaneProtocolRelease = {
  owner: string;
  repo: string;
  tagName: string;
  releaseName: string;
  publishedAt: string;
  eventTimeUtc: string;
};

export type SidecarLaneBlockchainStats = {
  network: string;
  blockNumber?: string;
  gasPriceWei?: string;
  chainParameterCount?: number;
  eventTimeUtc: string;
  providerId: MarketDataProviderId;
};

export type SidecarLaneRegulatoryFiling = {
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  eventTimeUtc: string;
};

export type SidecarLaneMempoolStats = {
  count: number;
  vsize: number;
  totalFee: number;
  fastestFee?: number;
  eventTimeUtc: string;
};

export type ReplayProviderSidecarLanesV2 = {
  fear_greed_index?: SidecarLaneFearGreed;
  global_market_stats?: SidecarLaneGlobalMarket;
  cross_exchange_confirmation?: SidecarLaneCrossExchange[];
  order_book_snapshot?: SidecarLaneOrderBook;
  market_trades_snapshot?: SidecarLaneMarketTrades;
  macro_series?: SidecarLaneMacroSeries[];
  macro_calendar_event?: SidecarLaneMacroCalendar[];
  macro_probability?: SidecarLaneMacroProbability[];
  news_headline?: SidecarLaneNewsHeadline[];
  news_event_cluster?: SidecarLaneNewsCluster;
  exchange_announcement?: SidecarLaneExchangeAnnouncement[];
  protocol_release?: SidecarLaneProtocolRelease[];
  blockchain_network_stats?: SidecarLaneBlockchainStats[];
  regulatory_filing?: SidecarLaneRegulatoryFiling[];
  mempool_stats?: SidecarLaneMempoolStats;
};

export type ReplayProviderSidecarV2 = {
  schemaVersion: typeof REPLAY_PROVIDER_SIDECAR_V2;
  instrumentId: string;
  captureAsOfUtc: string;
  generatedBy: string;
  builderGitSha?: string | null;
  captureOutcomes?: Partial<Record<MarketDataProviderId, ProviderCaptureOutcome>>;
  lanes: ReplayProviderSidecarLanesV2;
};

export type ReplayProviderSidecar = ReplayProviderSidecarV1 | ReplayProviderSidecarV2;

export function isReplayProviderSidecarV2(
  sidecar: ReplayProviderSidecar,
): sidecar is ReplayProviderSidecarV2 {
  return sidecar.schemaVersion === REPLAY_PROVIDER_SIDECAR_V2;
}

export function isReplayProviderSidecarV1(
  sidecar: ReplayProviderSidecar,
): sidecar is ReplayProviderSidecarV1 {
  return sidecar.schemaVersion === REPLAY_PROVIDER_SIDECAR_V1;
}

export function parseReplayProviderSidecar(raw: unknown): ReplayProviderSidecar {
  if (!raw || typeof raw !== "object") {
    throw new Error("[sidecar] invalid sidecar payload");
  }
  const schemaVersion = (raw as { schemaVersion?: string }).schemaVersion;
  if (schemaVersion === REPLAY_PROVIDER_SIDECAR_V2) {
    return raw as ReplayProviderSidecarV2;
  }
  if (schemaVersion === REPLAY_PROVIDER_SIDECAR_V1) {
    return raw as ReplayProviderSidecarV1;
  }
  throw new Error(
    `[sidecar] unsupported schemaVersion ${String(schemaVersion)}; expected v1 or v2`,
  );
}
