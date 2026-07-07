import { TronGridIntelligenceClient } from "@/lib/trader/connectors/trongrid-intelligence/trongrid-intelligence-client";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import {
  buildProvenanceRef,
  normalizeBlockchainNetworkStatsObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

export type TrongridIntelligenceAdapterConfig = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export class TrongridIntelligenceAdapter implements MarketDataAdapter {
  readonly providerId = "trongrid_intelligence" as const;
  private readonly client: TronGridIntelligenceClient;

  constructor(config: TrongridIntelligenceAdapterConfig = {}) {
    this.client = new TronGridIntelligenceClient({
      apiKey: config.apiKey,
      fetchImpl: config.fetchImpl,
    });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const timed = await timedAdapterFetch(() => this.client.getChainParameters());
      const eventTimeUtc = context.evaluatedAt;
      return [
        normalizeBlockchainNetworkStatsObservation({
          network: "tron-mainnet",
          chainParameterCount: timed.value.length,
          provenance: buildProvenanceRef({
            providerId: "trongrid_intelligence",
            venue: "trongrid",
            feedKind: "blockchain_network_stats",
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
          kind: "blockchain_network_stats",
          provenance: buildProvenanceRef({
            providerId: "trongrid_intelligence",
            venue: "trongrid",
            feedKind: "blockchain_network_stats",
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
