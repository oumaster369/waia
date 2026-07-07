import { MempoolSpaceClient } from "@/lib/trader/connectors/mempool-space/mempool-space-client";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import {
  buildProvenanceRef,
  normalizeMempoolStatsObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

export type MempoolSpaceAdapterConfig = {
  fetchImpl?: typeof fetch;
};

export class MempoolSpaceAdapter implements MarketDataAdapter {
  readonly providerId = "mempool_space" as const;
  private readonly client: MempoolSpaceClient;

  constructor(config: MempoolSpaceAdapterConfig = {}) {
    this.client = new MempoolSpaceClient({ fetchImpl: config.fetchImpl });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const mempoolTimed = await timedAdapterFetch(() => this.client.getMempoolStats());
      const feesTimed = await timedAdapterFetch(() => this.client.getRecommendedFees());
      const eventTimeUtc = context.evaluatedAt;
      return [
        normalizeMempoolStatsObservation({
          count: mempoolTimed.value.count,
          vsize: mempoolTimed.value.vsize,
          totalFee: mempoolTimed.value.total_fee,
          fastestFee: feesTimed.value.fastestFee,
          provenance: buildProvenanceRef({
            providerId: "mempool_space",
            venue: "mempool_space",
            feedKind: "mempool_stats",
            symbol,
            eventTimeUtc,
          }),
          latencyMs: mempoolTimed.latencyMs + feesTimed.latencyMs,
          evaluatedAt: context.evaluatedAt,
          eventTimeUtc,
        }),
      ];
    } catch (error) {
      return [
        normalizeUnavailableObservation({
          kind: "mempool_stats",
          provenance: buildProvenanceRef({
            providerId: "mempool_space",
            venue: "mempool_space",
            feedKind: "mempool_stats",
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
