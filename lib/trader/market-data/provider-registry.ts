import type {
  MarketDataProviderId,
  NormalizedObservationKind,
} from "@/lib/trader/market-data/observation-types";
import type { CanonicalPrimitiveObservationKindV1 } from "@/lib/trader/mi/canonical-observation-v1";

export type MarketDataProviderDescriptor = Readonly<{
  id: MarketDataProviderId;
  venue: string;
  label: string;
  required: boolean;
  kinds: readonly NormalizedObservationKind[];
}>;

const RAW_PROVIDER_DESCRIPTORS: Record<MarketDataProviderId, MarketDataProviderDescriptor> = {
  htx_spot: {
    id: "htx_spot",
    venue: "htx",
    label: "HTX Spot",
    required: true,
    kinds: ["ohlcv_bar", "quote_l1", "order_book_snapshot", "market_trades_snapshot"],
  },
  binance_public: {
    id: "binance_public",
    venue: "binance",
    label: "Binance Public",
    required: false,
    kinds: ["cross_exchange_confirmation"],
  },
  bybit_public: {
    id: "bybit_public",
    venue: "bybit",
    label: "Bybit Public",
    required: false,
    kinds: ["cross_exchange_confirmation"],
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
  fred: {
    id: "fred",
    venue: "fred",
    label: "FRED Macro Series",
    required: false,
    kinds: ["macro_series"],
  },
  federal_reserve: {
    id: "federal_reserve",
    venue: "federal_reserve",
    label: "Federal Reserve Calendar",
    required: false,
    kinds: ["macro_calendar_event"],
  },
  cme_fedwatch: {
    id: "cme_fedwatch",
    venue: "cme",
    label: "CME FedWatch Probabilities",
    required: false,
    kinds: ["macro_probability"],
  },
  gdelt: {
    id: "gdelt",
    venue: "gdelt",
    label: "GDELT News Clusters",
    required: false,
    kinds: ["news_event_cluster"],
  },
  coindesk_rss: {
    id: "coindesk_rss",
    venue: "coindesk",
    label: "CoinDesk RSS",
    required: false,
    kinds: ["news_headline"],
  },
  cointelegraph_rss: {
    id: "cointelegraph_rss",
    venue: "cointelegraph",
    label: "Cointelegraph RSS",
    required: false,
    kinds: ["news_headline"],
  },
  decrypt_rss: {
    id: "decrypt_rss",
    venue: "decrypt",
    label: "Decrypt RSS",
    required: false,
    kinds: ["news_headline"],
  },
  binance_announcements: {
    id: "binance_announcements",
    venue: "binance",
    label: "Binance Announcements",
    required: false,
    kinds: ["exchange_announcement"],
  },
  htx_announcements: {
    id: "htx_announcements",
    venue: "htx",
    label: "HTX Announcements",
    required: false,
    kinds: ["exchange_announcement"],
  },
  bybit_announcements: {
    id: "bybit_announcements",
    venue: "bybit",
    label: "Bybit Announcements",
    required: false,
    kinds: ["exchange_announcement"],
  },
  github_releases: {
    id: "github_releases",
    venue: "github",
    label: "GitHub Protocol Releases",
    required: false,
    kinds: ["protocol_release"],
  },
  infura_rpc: {
    id: "infura_rpc",
    venue: "infura",
    label: "Infura EVM RPC",
    required: false,
    kinds: ["blockchain_network_stats"],
  },
  trongrid_intelligence: {
    id: "trongrid_intelligence",
    venue: "trongrid",
    label: "TronGrid Intelligence",
    required: false,
    kinds: ["blockchain_network_stats"],
  },
  mempool_space: {
    id: "mempool_space",
    venue: "mempool_space",
    label: "mempool.space",
    required: false,
    kinds: ["mempool_stats"],
  },
  sec_edgar: {
    id: "sec_edgar",
    venue: "sec_edgar",
    label: "SEC EDGAR Filings",
    required: false,
    kinds: ["regulatory_filing"],
  },
};

const PROVIDER_DESCRIPTORS = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_PROVIDER_DESCRIPTORS).map(([providerId, descriptor]) => [
      providerId,
      Object.freeze({ ...descriptor, kinds: Object.freeze([...descriptor.kinds]) }),
    ]),
  ),
) as Readonly<Record<MarketDataProviderId, MarketDataProviderDescriptor>>;
const PROVIDER_LIST = Object.freeze(Object.values(PROVIDER_DESCRIPTORS));

export function listMarketDataProviders(): readonly MarketDataProviderDescriptor[] {
  return PROVIDER_LIST;
}

export function getMarketDataProvider(id: MarketDataProviderId): MarketDataProviderDescriptor {
  return PROVIDER_DESCRIPTORS[id];
}

export function isRegisteredMarketDataProvider(id: string): id is MarketDataProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDER_DESCRIPTORS, id);
}

export type MarketDataProviderSelectionResolution =
  | Readonly<{
      status: "ACCEPTED";
      provider: MarketDataProviderDescriptor;
      admittedKinds: readonly NormalizedObservationKind[];
    }>
  | Readonly<{
      status: "REJECTED";
      reasonCode: "SOURCE_UNKNOWN" | "PROVIDER_KIND_MISMATCH";
    }>;

export function resolveMarketDataProviderSelection(input: {
  providerId: string;
  allowedObservationKinds: readonly CanonicalPrimitiveObservationKindV1[];
}): MarketDataProviderSelectionResolution {
  if (!isRegisteredMarketDataProvider(input.providerId)) {
    return Object.freeze({ status: "REJECTED", reasonCode: "SOURCE_UNKNOWN" });
  }
  const provider = getMarketDataProvider(input.providerId);
  const admittedKinds = Object.freeze(
    provider.kinds.filter((kind) =>
      input.allowedObservationKinds.includes(kind as CanonicalPrimitiveObservationKindV1),
    ),
  );
  if (admittedKinds.length === 0) {
    return Object.freeze({ status: "REJECTED", reasonCode: "PROVIDER_KIND_MISMATCH" });
  }
  return Object.freeze({ status: "ACCEPTED", provider, admittedKinds });
}
