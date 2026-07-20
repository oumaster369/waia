import { RssFeedClient } from "@/lib/trader/connectors/rss/rss-feed-client";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import {
  buildProvenanceRef,
  normalizeNewsHeadlineObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

const COINDESK_RSS_URL = "https://www.coindesk.com/arc/outboundfeeds/rss/";

export type CoindeskRssAdapterConfig = {
  fetchImpl?: typeof fetch;
};

export class CoindeskRssAdapter implements MarketDataAdapter {
  readonly providerId = "coindesk_rss" as const;
  private readonly client: RssFeedClient;

  constructor(config: CoindeskRssAdapterConfig = {}) {
    this.client = new RssFeedClient({ fetchImpl: config.fetchImpl });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const timed = await timedAdapterFetch(() => this.client.fetchFeed(COINDESK_RSS_URL, 5));
      if (timed.value.length === 0) {
        throw new Error("[coindesk-rss] empty feed");
      }
      return timed.value.map((item) => {
        const eventTimeUtc = context.evaluatedAt;
        return normalizeNewsHeadlineObservation({
          headline: item.title,
          url: item.link,
          source: "coindesk",
          publishedAt: item.publishedAt,
          provenance: buildProvenanceRef({
            providerId: "coindesk_rss",
            venue: "coindesk",
            feedKind: "news_headline",
            symbol,
            eventTimeUtc,
            ingestTimeUtc: context.evaluatedAt,
          }),
          latencyMs: timed.latencyMs,
          evaluatedAt: context.evaluatedAt,
          eventTimeUtc,
        });
      });
    } catch (error) {
      return [
        normalizeUnavailableObservation({
          kind: "news_headline",
          provenance: buildProvenanceRef({
            providerId: "coindesk_rss",
            venue: "coindesk",
            feedKind: "news_headline",
            symbol,
            eventTimeUtc: context.evaluatedAt,
          }),
          evaluatedAt: context.evaluatedAt,
          reason: error instanceof Error ? error.message : String(error),
        }),
      ];
    }
  }
}
