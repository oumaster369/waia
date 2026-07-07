import { FredClient } from "@/lib/trader/connectors/fred/fred-client";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import {
  buildProvenanceRef,
  normalizeMacroSeriesObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

const FRED_MACRO_SERIES = ["DFF", "T10Y2Y"] as const;

export type FredAdapterConfig = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export class FredAdapter implements MarketDataAdapter {
  readonly providerId = "fred" as const;
  private readonly client: FredClient;

  constructor(config: FredAdapterConfig = {}) {
    this.client = new FredClient({
      apiKey: config.apiKey,
      fetchImpl: config.fetchImpl,
    });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const observations: NormalizedObservation[] = [];
      for (const seriesId of FRED_MACRO_SERIES) {
        const timed = await timedAdapterFetch(() =>
          this.client.getSeriesObservations({ seriesId, limit: 1 }),
        );
        const row = timed.value.observations.find((entry) => entry.value !== ".");
        if (!row) {
          continue;
        }
        const eventTimeUtc = `${row.date}T00:00:00.000Z`;
        observations.push(
          normalizeMacroSeriesObservation({
            seriesId,
            value: Number(row.value),
            observationDate: row.date,
            provenance: buildProvenanceRef({
              providerId: "fred",
              venue: "fred",
              feedKind: "macro_series",
              symbol,
              eventTimeUtc,
            }),
            latencyMs: timed.latencyMs,
            evaluatedAt: context.evaluatedAt,
            eventTimeUtc,
          }),
        );
      }
      if (observations.length === 0) {
        throw new Error("[fred] no usable macro series observations");
      }
      return observations;
    } catch (error) {
      return [
        normalizeUnavailableObservation({
          kind: "macro_series",
          provenance: buildProvenanceRef({
            providerId: "fred",
            venue: "fred",
            feedKind: "macro_series",
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
