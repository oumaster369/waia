import { FederalReserveClient } from "@/lib/trader/connectors/federal-reserve/federal-reserve-client";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import {
  buildProvenanceRef,
  normalizeMacroCalendarEventObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

export type FederalReserveAdapterConfig = {
  fetchImpl?: typeof fetch;
};

export class FederalReserveAdapter implements MarketDataAdapter {
  readonly providerId = "federal_reserve" as const;
  private readonly client: FederalReserveClient;

  constructor(config: FederalReserveAdapterConfig = {}) {
    this.client = new FederalReserveClient({ fetchImpl: config.fetchImpl });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const timed = await timedAdapterFetch(() => this.client.getCalendarEvents());
      const events = timed.value.slice(0, 5);
      if (events.length === 0) {
        throw new Error("[federal-reserve] no calendar events returned");
      }
      return events.map((event) => {
        const eventTimeUtc = event.start;
        return normalizeMacroCalendarEventObservation({
          eventId: event.id,
          title: event.title,
          startUtc: event.start,
          category: event.category,
          provenance: buildProvenanceRef({
            providerId: "federal_reserve",
            venue: "federal_reserve",
            feedKind: "macro_calendar_event",
            symbol,
            eventTimeUtc,
          }),
          latencyMs: timed.latencyMs,
          evaluatedAt: context.evaluatedAt,
          eventTimeUtc,
        });
      });
    } catch (error) {
      return [
        normalizeUnavailableObservation({
          kind: "macro_calendar_event",
          provenance: buildProvenanceRef({
            providerId: "federal_reserve",
            venue: "federal_reserve",
            feedKind: "macro_calendar_event",
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
