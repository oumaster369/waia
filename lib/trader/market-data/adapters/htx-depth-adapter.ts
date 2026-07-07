import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import type { HtxRestClient } from "@/lib/trader/connectors/htx/client";
import type { InstrumentId } from "@/lib/trader/intelligence/types";
import {
  type AdapterFetchContext,
  type MarketDataAdapter,
  timedAdapterFetch,
} from "@/lib/trader/market-data/adapters/market-data-adapter";
import {
  buildProvenanceRef,
  normalizeMarketTradesSnapshotObservation,
  normalizeOrderBookSnapshotObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";

export type HtxDepthAdapterConfig = {
  htxClient: HtxRestClient;
  internalSymbol?: InstrumentId;
};

export class HtxDepthAdapter implements MarketDataAdapter {
  readonly providerId = "htx_spot" as const;
  private readonly htxClient: HtxRestClient;
  private readonly internalSymbol: InstrumentId;

  constructor(config: HtxDepthAdapterConfig) {
    this.htxClient = config.htxClient;
    this.internalSymbol = config.internalSymbol ?? "BTC/USDT";
  }

  async fetchObservations(context: AdapterFetchContext): Promise<readonly NormalizedObservation[]> {
    const symbol = context.instrumentId ?? context.symbol ?? this.internalSymbol;
    const htxSymbol = internalSymbolToHtx(symbol);
    const observations: NormalizedObservation[] = [];

    try {
      const depthTimed = await timedAdapterFetch(() =>
        this.htxClient.getMarketDepth({ symbol: htxSymbol }),
      );
      const tick = depthTimed.value.tick;
      if (!tick) {
        throw new Error("[htx-depth] missing depth tick");
      }
      const eventTimeUtc = tick.ts ? new Date(tick.ts).toISOString() : context.evaluatedAt;
      observations.push(
        normalizeOrderBookSnapshotObservation({
          symbol,
          bidLevels: tick.bids,
          askLevels: tick.asks,
          eventTimeUtc,
          provenance: buildProvenanceRef({
            providerId: "htx_spot",
            venue: "htx",
            feedKind: "order_book_snapshot",
            symbol,
            eventTimeUtc,
          }),
          latencyMs: depthTimed.latencyMs,
          evaluatedAt: context.evaluatedAt,
        }),
      );
    } catch (error) {
      observations.push(
        normalizeUnavailableObservation({
          kind: "order_book_snapshot",
          provenance: buildProvenanceRef({
            providerId: "htx_spot",
            venue: "htx",
            feedKind: "order_book_snapshot",
            symbol,
            eventTimeUtc: context.evaluatedAt,
          }),
          evaluatedAt: context.evaluatedAt,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    try {
      const tradesTimed = await timedAdapterFetch(() =>
        this.htxClient.getMarketHistoryTrade({ symbol: htxSymbol, size: 50 }),
      );
      const trades = tradesTimed.value;
      const latestTs = trades[0]?.ts ?? Date.now();
      const eventTimeUtc = new Date(latestTs).toISOString();
      observations.push(
        normalizeMarketTradesSnapshotObservation({
          symbol,
          trades,
          eventTimeUtc,
          provenance: buildProvenanceRef({
            providerId: "htx_spot",
            venue: "htx",
            feedKind: "market_trades_snapshot",
            symbol,
            eventTimeUtc,
          }),
          latencyMs: tradesTimed.latencyMs,
          evaluatedAt: context.evaluatedAt,
        }),
      );
    } catch (error) {
      observations.push(
        normalizeUnavailableObservation({
          kind: "market_trades_snapshot",
          provenance: buildProvenanceRef({
            providerId: "htx_spot",
            venue: "htx",
            feedKind: "market_trades_snapshot",
            symbol,
            eventTimeUtc: context.evaluatedAt,
          }),
          evaluatedAt: context.evaluatedAt,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    return observations;
  }
}
