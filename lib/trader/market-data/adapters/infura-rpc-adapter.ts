import { InfuraRpcClient } from "@/lib/trader/connectors/infura/infura-rpc-client";
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

export type InfuraRpcAdapterConfig = {
  projectId?: string;
  apiSecret?: string;
  fetchImpl?: typeof fetch;
};

export class InfuraRpcAdapter implements MarketDataAdapter {
  readonly providerId = "infura_rpc" as const;
  private readonly client: InfuraRpcClient;

  constructor(config: InfuraRpcAdapterConfig = {}) {
    this.client = new InfuraRpcClient({
      projectId: config.projectId,
      apiSecret: config.apiSecret,
      fetchImpl: config.fetchImpl,
    });
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.symbol ?? "GLOBAL";
    try {
      const blockTimed = await timedAdapterFetch(() => this.client.getBlockNumber());
      const gasTimed = await timedAdapterFetch(() => this.client.getGasPrice());
      const eventTimeUtc = context.evaluatedAt;
      return [
        normalizeBlockchainNetworkStatsObservation({
          network: "ethereum-mainnet",
          blockNumber: blockTimed.value,
          gasPriceWei: gasTimed.value,
          provenance: buildProvenanceRef({
            providerId: "infura_rpc",
            venue: "infura",
            feedKind: "blockchain_network_stats",
            symbol,
            eventTimeUtc,
          }),
          latencyMs: blockTimed.latencyMs + gasTimed.latencyMs,
          evaluatedAt: context.evaluatedAt,
          eventTimeUtc,
        }),
      ];
    } catch (error) {
      return [
        normalizeUnavailableObservation({
          kind: "blockchain_network_stats",
          provenance: buildProvenanceRef({
            providerId: "infura_rpc",
            venue: "infura",
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
