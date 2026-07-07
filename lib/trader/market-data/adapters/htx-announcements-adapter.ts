import { HtxAnnouncementsClient } from "@/lib/trader/connectors/announcements/htx-announcements-client";
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

export type HtxAnnouncementsAdapterConfig = {
  fetchImpl?: typeof fetch;
};

export class HtxAnnouncementsAdapter implements MarketDataAdapter {
  readonly providerId = "htx_announcements" as const;
  private readonly client: HtxAnnouncementsClient;

  constructor(config: HtxAnnouncementsAdapterConfig = {}) {
    this.client = new HtxAnnouncementsClient({ fetchImpl: config.fetchImpl });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const timed = await timedAdapterFetch(() =>
        this.client.listRecentAnnouncements({ limit: 5 }),
      );
      if (timed.value.length === 0) {
        throw new Error("[htx-announcements] no announcements returned");
      }
      return timed.value.map((article, index) => {
        const publishedAt = article.showTime
          ? new Date(article.showTime).toISOString()
          : context.evaluatedAt;
        return normalizeExchangeAnnouncementObservation({
          announcementId: String(article.id ?? index),
          title: article.title ?? "Untitled",
          venue: "htx",
          publishedAt,
          provenance: buildProvenanceRef({
            providerId: "htx_announcements",
            venue: "htx",
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
            providerId: "htx_announcements",
            venue: "htx",
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
