import { BybitAnnouncementsClient } from "@/lib/trader/connectors/announcements/bybit-announcements-client";
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

export type BybitAnnouncementsAdapterConfig = {
  fetchImpl?: typeof fetch;
};

export class BybitAnnouncementsAdapter implements MarketDataAdapter {
  readonly providerId = "bybit_announcements" as const;
  private readonly client: BybitAnnouncementsClient;

  constructor(config: BybitAnnouncementsAdapterConfig = {}) {
    this.client = new BybitAnnouncementsClient({ fetchImpl: config.fetchImpl });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const timed = await timedAdapterFetch(() =>
        this.client.listRecentAnnouncements({ limit: 5 }),
      );
      if (timed.value.length === 0) {
        throw new Error("[bybit-announcements] no announcements returned");
      }
      return timed.value.map((article, index) => {
        const publishedAt = article.dateTimestamp
          ? new Date(article.dateTimestamp).toISOString()
          : context.evaluatedAt;
        return normalizeExchangeAnnouncementObservation({
          announcementId: article.url ?? String(index),
          title: article.title ?? "Untitled",
          venue: "bybit",
          publishedAt,
          provenance: buildProvenanceRef({
            providerId: "bybit_announcements",
            venue: "bybit",
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
            providerId: "bybit_announcements",
            venue: "bybit",
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
