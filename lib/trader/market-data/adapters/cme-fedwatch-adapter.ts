import { CmeFedWatchClient } from "@/lib/trader/connectors/cme-fedwatch/cme-fedwatch-client";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import {
  buildProvenanceRef,
  normalizeMacroProbabilityObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

export type CmeFedWatchAdapterConfig = {
  enabled?: boolean;
  fetchImpl?: typeof fetch;
};

export class CmeFedWatchAdapter implements MarketDataAdapter {
  readonly providerId = "cme_fedwatch" as const;
  private readonly client: CmeFedWatchClient;

  constructor(config: CmeFedWatchAdapterConfig = {}) {
    this.client = new CmeFedWatchClient({
      enabled: config.enabled,
      fetchImpl: config.fetchImpl,
    });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      if (!this.client.isEnabled()) {
        throw new Error("[cme-fedwatch] disabled");
      }
      const timed = await timedAdapterFetch(() => this.client.getProbabilities());
      const probabilities = timed.value.slice(0, 3);
      if (probabilities.length === 0) {
        throw new Error("[cme-fedwatch] no probabilities returned");
      }
      return probabilities.map((entry) => {
        const eventTimeUtc = context.evaluatedAt;
        return normalizeMacroProbabilityObservation({
          meetingDate: entry.meetingDate,
          probability: entry.probability,
          targetRateRange: entry.targetRateRange,
          provenance: buildProvenanceRef({
            providerId: "cme_fedwatch",
            venue: "cme",
            feedKind: "macro_probability",
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
          kind: "macro_probability",
          provenance: buildProvenanceRef({
            providerId: "cme_fedwatch",
            venue: "cme",
            feedKind: "macro_probability",
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
