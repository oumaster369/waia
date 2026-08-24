import type { InstrumentId } from "@/lib/trader/intelligence/types";
import type {
  MarketDataProviderId,
  NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
import { BinanceAnnouncementsAdapter } from "@/lib/trader/market-data/adapters/binance-announcements-adapter";
import { BybitAnnouncementsAdapter } from "@/lib/trader/market-data/adapters/bybit-announcements-adapter";
import { CmeFedWatchAdapter } from "@/lib/trader/market-data/adapters/cme-fedwatch-adapter";
import { CoindeskRssAdapter } from "@/lib/trader/market-data/adapters/coindesk-rss-adapter";
import { CointelegraphRssAdapter } from "@/lib/trader/market-data/adapters/cointelegraph-rss-adapter";
import { DecryptRssAdapter } from "@/lib/trader/market-data/adapters/decrypt-rss-adapter";
import { FederalReserveAdapter } from "@/lib/trader/market-data/adapters/federal-reserve-adapter";
import { FredAdapter } from "@/lib/trader/market-data/adapters/fred-adapter";
import { GdeltAdapter } from "@/lib/trader/market-data/adapters/gdelt-adapter";
import { GitHubReleasesAdapter } from "@/lib/trader/market-data/adapters/github-releases-adapter";
import { HtxAnnouncementsAdapter } from "@/lib/trader/market-data/adapters/htx-announcements-adapter";
import { InfuraRpcAdapter } from "@/lib/trader/market-data/adapters/infura-rpc-adapter";
import type { MarketDataAdapter } from "@/lib/trader/market-data/adapters/market-data-adapter";
import { MempoolSpaceAdapter } from "@/lib/trader/market-data/adapters/mempool-space-adapter";
import { SecEdgarAdapter } from "@/lib/trader/market-data/adapters/sec-edgar-adapter";
import { TrongridIntelligenceAdapter } from "@/lib/trader/market-data/adapters/trongrid-intelligence-adapter";

export type OptionalMarketDataAdaptersConfig = {
  fetchImpl?: typeof fetch;
  internalSymbol?: InstrumentId;
  fredApiKey?: string;
  infuraProjectId?: string;
  infuraApiSecret?: string;
  tronGridApiKey?: string;
  githubToken?: string;
  secEdgarUserAgent?: string;
  cmeFedWatchEnabled?: boolean;
};

export function buildOptionalMarketDataAdapters(
  config: OptionalMarketDataAdaptersConfig = {},
  providerIds?: readonly MarketDataProviderId[],
): MarketDataAdapter[] {
  const fetchImpl = config.fetchImpl;
  const adapters: MarketDataAdapter[] = [
    new FredAdapter({ apiKey: config.fredApiKey, fetchImpl }),
    new FederalReserveAdapter({ fetchImpl }),
    new CmeFedWatchAdapter({ enabled: config.cmeFedWatchEnabled, fetchImpl }),
    new GdeltAdapter({ fetchImpl }),
    new CoindeskRssAdapter({ fetchImpl }),
    new CointelegraphRssAdapter({ fetchImpl }),
    new DecryptRssAdapter({ fetchImpl }),
    new BinanceAnnouncementsAdapter({ fetchImpl }),
    new HtxAnnouncementsAdapter({ fetchImpl }),
    new BybitAnnouncementsAdapter({ fetchImpl }),
    new GitHubReleasesAdapter({ token: config.githubToken, fetchImpl }),
    new InfuraRpcAdapter({
      projectId: config.infuraProjectId,
      apiSecret: config.infuraApiSecret,
      fetchImpl,
    }),
    new TrongridIntelligenceAdapter({ apiKey: config.tronGridApiKey, fetchImpl }),
    new MempoolSpaceAdapter({ fetchImpl }),
    new SecEdgarAdapter({ userAgent: config.secEdgarUserAgent, fetchImpl }),
  ];
  if (!providerIds) return adapters;
  const admitted = new Set(providerIds);
  return adapters.filter((adapter) => admitted.has(adapter.providerId));
}

export function categorizeOptionalObservations(observations: readonly NormalizedObservation[]): {
  macroEvidence: NormalizedObservation[];
  newsEvidence: NormalizedObservation[];
  blockchainEvidence: NormalizedObservation[];
  regulatoryEvidence: NormalizedObservation[];
  protocolEvidence: NormalizedObservation[];
} {
  const macroEvidence: NormalizedObservation[] = [];
  const newsEvidence: NormalizedObservation[] = [];
  const blockchainEvidence: NormalizedObservation[] = [];
  const regulatoryEvidence: NormalizedObservation[] = [];
  const protocolEvidence: NormalizedObservation[] = [];

  for (const observation of observations) {
    switch (observation.kind) {
      case "macro_series":
      case "macro_calendar_event":
      case "macro_probability":
        macroEvidence.push(observation);
        break;
      case "news_headline":
      case "news_event_cluster":
      case "exchange_announcement":
        newsEvidence.push(observation);
        break;
      case "blockchain_network_stats":
      case "mempool_stats":
        blockchainEvidence.push(observation);
        break;
      case "regulatory_filing":
        regulatoryEvidence.push(observation);
        break;
      case "protocol_release":
        protocolEvidence.push(observation);
        break;
      default:
        break;
    }
  }

  return {
    macroEvidence,
    newsEvidence,
    blockchainEvidence,
    regulatoryEvidence,
    protocolEvidence,
  };
}
