import { BinanceAnnouncementsClient } from "@/lib/trader/connectors/announcements/binance-announcements-client";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import {
  buildProvenanceRef,
  normalizeExchangeAnnouncementObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

export type BinanceAnnouncementsAdapterConfig = {
  fetchImpl?: typeof fetch;
};

export class BinanceAnnouncementsAdapter implements MarketDataAdapter {
  readonly providerId = "binance_announcements" as const;
  private readonly client: BinanceAnnouncementsClient;

  constructor(config: BinanceAnnouncementsAdapterConfig = {}) {
    this.client = new BinanceAnnouncementsClient({ fetchImpl: config.fetchImpl });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const timed = await timedAdapterFetch(() =>
        this.client.listRecentAnnouncements({ pageSize: 5 }),
      );
      if (timed.value.length === 0) {
        throw new Error("[binance-announcements] no announcements returned");
      }
      return timed.value.map((article) => {
        const publishedAt = new Date(article.releaseDate).toISOString();
        return normalizeExchangeAnnouncementObservation({
          announcementId: String(article.id),
          title: article.title,
          venue: "binance",
          publishedAt,
          provenance: buildProvenanceRef({
            providerId: "binance_announcements",
            venue: "binance",
            feedKind: "exchange_announcement",
            symbol,
            eventTimeUtc: publishedAt,
          }),
          latencyMs: timed.latencyMs,
          evaluatedAt: context.evaluatedAt,
          eventTimeUtc: publishedAt,
        });
      });
    } catch (error) {
      return [
        normalizeUnavailableObservation({
          kind: "exchange_announcement",
          provenance: buildProvenanceRef({
            providerId: "binance_announcements",
            venue: "binance",
            feedKind: "exchange_announcement",
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
