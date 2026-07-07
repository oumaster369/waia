import type { MarketDataProviderId } from "@/lib/trader/market-data/observation-types";

export type MarketDataProviderDescriptor = {
  id: MarketDataProviderId;
  venue: string;
  label: string;
  required: boolean;
  kinds: readonly string[];
};

const PROVIDER_DESCRIPTORS: Record<MarketDataProviderId, MarketDataProviderDescriptor> = {
  htx_spot: {
    id: "htx_spot",
    venue: "htx",
    label: "HTX Spot",
    required: true,
    kinds: ["ohlcv_bar", "quote_l1", "order_book_snapshot"],
  },
  binance_public: {
    id: "binance_public",
    venue: "binance",
    label: "Binance Public",
    required: false,
    kinds: ["cross_exchange_confirmation", "quote_l1"],
  },
  bybit_public: {
    id: "bybit_public",
    venue: "bybit",
    label: "Bybit Public",
    required: false,
    kinds: ["cross_exchange_confirmation", "quote_l1"],
  },
  alternative_me: {
    id: "alternative_me",
    venue: "alternative_me",
    label: "Alternative.me Fear & Greed",
    required: false,
    kinds: ["fear_greed_index"],
  },
  coingecko_global: {
    id: "coingecko_global",
    venue: "coingecko",
    label: "CoinGecko Global",
    required: false,
    kinds: ["global_market_stats"],
  },
};

export function listMarketDataProviders(): readonly MarketDataProviderDescriptor[] {
  return Object.values(PROVIDER_DESCRIPTORS);
}

export function getMarketDataProvider(id: MarketDataProviderId): MarketDataProviderDescriptor {
  return PROVIDER_DESCRIPTORS[id];
}

export function isRegisteredMarketDataProvider(id: string): id is MarketDataProviderId {
  return id in PROVIDER_DESCRIPTORS;
}
