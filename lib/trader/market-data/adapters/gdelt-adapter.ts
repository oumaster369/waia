import { GdeltClient } from "@/lib/trader/connectors/gdelt/gdelt-client";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import {
  buildProvenanceRef,
  normalizeNewsEventClusterObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

const GDELT_CRYPTO_QUERY = "bitcoin OR cryptocurrency";

export type GdeltAdapterConfig = {
  fetchImpl?: typeof fetch;
};

export class GdeltAdapter implements MarketDataAdapter {
  readonly providerId = "gdelt" as const;
  private readonly client: GdeltClient;

  constructor(config: GdeltAdapterConfig = {}) {
    this.client = new GdeltClient({ fetchImpl: config.fetchImpl });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const timed = await timedAdapterFetch(() =>
        this.client.searchArticles({
          query: GDELT_CRYPTO_QUERY,
          maxRecords: 10,
          timespan: "24h",
        }),
      );
      const articles = timed.value;
      if (articles.length === 0) {
        throw new Error("[gdelt] no articles returned");
      }
      const topHeadline = articles[0]?.title;
      const eventTimeUtc = context.evaluatedAt;
      return [
        normalizeNewsEventClusterObservation({
          clusterId: "gdelt_crypto_24h",
          query: GDELT_CRYPTO_QUERY,
          articleCount: articles.length,
          topHeadline,
          provenance: buildProvenanceRef({
            providerId: "gdelt",
            venue: "gdelt",
            feedKind: "news_event_cluster",
            symbol,
            eventTimeUtc,
          }),
          latencyMs: timed.latencyMs,
          evaluatedAt: context.evaluatedAt,
          eventTimeUtc,
        }),
      ];
    } catch (error) {
      return [
        normalizeUnavailableObservation({
          kind: "news_event_cluster",
          provenance: buildProvenanceRef({
            providerId: "gdelt",
            venue: "gdelt",
            feedKind: "news_event_cluster",
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
