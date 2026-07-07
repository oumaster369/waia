import { AlternativeMeFearGreedClient } from "@/lib/trader/connectors/alternative-me/fear-greed-client";
import { BinancePublicMarketClient } from "@/lib/trader/connectors/binance/public-market-client";
import { BybitPublicMarketClient } from "@/lib/trader/connectors/bybit/public-market-client";
import { CoinGeckoGlobalMarketClient } from "@/lib/trader/connectors/coingecko/global-market-client";
import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import { HtxRestClient, type HtxFetchFn } from "@/lib/trader/connectors/htx/client";
import type { Bar, BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import { fuseContextV0 } from "@/lib/trader/market-data/fusion/context-fusion-v0";
import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { mapHtxKlinesToBars, mapHtxMergedToQuote } from "@/lib/trader/market-data/htx-kline-mapper";
import { fetchMtfBarsFromHtx } from "@/lib/trader/market-data/mtf/mtf-bar-aggregator";
import {
  buildProvenanceRef,
  normalizeCrossExchangeConfirmation,
  normalizeFearGreedObservation,
  normalizeGlobalMarketObservation,
  normalizeOhlcvBarsObservation,
  normalizeQuoteObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import {
  HTX_PERIOD_BY_INTERVAL,
  MTF_BAR_INTERVALS,
  type FusedMarketContext,
  type NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";

export type MarketDataGatewayConfig = {
  internalSymbol?: InstrumentId;
  htxRestHost?: string;
  fetchImpl?: HtxFetchFn;
  coingeckoApiKey?: string;
  disableOptionalProviders?: boolean;
};

export type GatewayPollResult = {
  snapshot: MarketSnapshot;
  fusedContext: FusedMarketContext;
  mtfBarsByInterval: Partial<Record<BarInterval, Bar[]>>;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const started = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - started };
}

export class MarketDataGateway {
  private readonly internalSymbol: InstrumentId;
  private readonly htxClient: HtxRestClient;
  private readonly binance: BinancePublicMarketClient;
  private readonly bybit: BybitPublicMarketClient;
  private readonly fearGreed: AlternativeMeFearGreedClient;
  private readonly coinGecko: CoinGeckoGlobalMarketClient;
  private readonly disableOptionalProviders: boolean;
  private cycleIndex = 0;
  private readonly cycleIdPrefix: string;

  constructor(config: MarketDataGatewayConfig = {}) {
    const fetchImpl = config.fetchImpl;
    this.internalSymbol = config.internalSymbol ?? "BTC/USDT";
    this.htxClient = new HtxRestClient({
      apiKey: "public",
      apiSecret: "public",
      restHost: config.htxRestHost,
      fetchImpl,
    });
    this.binance = new BinancePublicMarketClient({ fetchImpl });
    this.bybit = new BybitPublicMarketClient({ fetchImpl });
    this.fearGreed = new AlternativeMeFearGreedClient({ fetchImpl });
    this.coinGecko = new CoinGeckoGlobalMarketClient({
      fetchImpl,
      apiKey: config.coingeckoApiKey,
    });
    this.disableOptionalProviders = config.disableOptionalProviders ?? false;
    this.cycleIdPrefix = "mi-gateway";
  }

  reset(): void {
    this.cycleIndex = 0;
  }

  async pollEvaluationBundle(input?: {
    cycleIdPrefix?: string;
    evaluatedAt?: string;
  }): Promise<GatewayPollResult> {
    const degradationReasons: string[] = [];

    const mtfBarsByInterval = await fetchMtfBarsFromHtx({
      client: this.htxClient,
      internalSymbol: this.internalSymbol,
      intervals: MTF_BAR_INTERVALS,
    });

    const primaryBars = mtfBarsByInterval["1m"] ?? [];
    if (primaryBars.length < EXPAND_MIN_BARS) {
      throw new Error(
        `[market-data] gateway HTX 1m returned ${primaryBars.length} bars; need at least ${EXPAND_MIN_BARS}`,
      );
    }

    const evaluatedAt =
      input?.evaluatedAt ??
      primaryBars[primaryBars.length - 1]?.barCloseTime ??
      new Date().toISOString();

    const htxSymbol = internalSymbolToHtx(this.internalSymbol);
    const mergedTimed = await timed(() => this.htxClient.getMarketDetailMerged(htxSymbol));
    const quote = mapHtxMergedToQuote(this.internalSymbol, mergedTimed.value);

    const snapshot = buildMarketSnapshot(
      primaryBars,
      quote,
      this.cycleIndex,
      input?.cycleIdPrefix ?? this.cycleIdPrefix,
    );
    this.cycleIndex += 1;

    const mtfObservations: Partial<Record<BarInterval, NormalizedObservation[]>> = {};
    for (const interval of MTF_BAR_INTERVALS) {
      const bars = mtfBarsByInterval[interval] ?? [];
      if (bars.length === 0) {
        continue;
      }
      mtfObservations[interval] = [
        normalizeOhlcvBarsObservation({
          bars,
          provenance: buildProvenanceRef({
            providerId: "htx_spot",
            venue: "htx",
            feedKind: "ohlcv_bar",
            symbol: this.internalSymbol,
            eventTimeUtc: bars[bars.length - 1]?.barCloseTime ?? evaluatedAt,
          }),
          latencyMs: 0,
          evaluatedAt,
        }),
      ];
    }

    const primaryQuote = normalizeQuoteObservation({
      quote,
      provenance: buildProvenanceRef({
        providerId: "htx_spot",
        venue: "htx",
        feedKind: "quote_l1",
        symbol: this.internalSymbol,
        eventTimeUtc: quote.timestamp,
      }),
      latencyMs: mergedTimed.latencyMs,
      evaluatedAt,
    });

    let crossExchangeConfirmation: NormalizedObservation | undefined;
    let fearGreedObservation: NormalizedObservation | undefined;
    let globalMarketObservation: NormalizedObservation | undefined;

    if (!this.disableOptionalProviders) {
      crossExchangeConfirmation = await this.fetchCrossExchangeConfirmation({
        primaryLast: quote.last,
        evaluatedAt,
        degradationReasons,
      });
      fearGreedObservation = await this.fetchFearGreed({ evaluatedAt, degradationReasons });
      globalMarketObservation = await this.fetchGlobalMarket({ evaluatedAt, degradationReasons });
    }

    const fusedContext = fuseContextV0({
      instrumentId: this.internalSymbol,
      fusedAtUtc: evaluatedAt,
      mtfBars: mtfObservations,
      primaryQuote,
      crossExchangeConfirmation,
      fearGreed: fearGreedObservation,
      globalMarket: globalMarketObservation,
      degradationReasons,
    });

    return {
      snapshot: { ...snapshot, evaluatedAt: snapshot.evaluatedAt ?? evaluatedAt },
      fusedContext,
      mtfBarsByInterval,
    };
  }

  private async fetchCrossExchangeConfirmation(input: {
    primaryLast: string;
    evaluatedAt: string;
    degradationReasons: string[];
  }): Promise<NormalizedObservation | undefined> {
    try {
      const binanceTimed = await timed(() => this.binance.getTickerPrice(this.internalSymbol));
      const binanceObs = normalizeCrossExchangeConfirmation({
        symbol: this.internalSymbol,
        primaryLast: input.primaryLast,
        confirmLast: binanceTimed.value.price,
        confirmVenue: "binance",
        provenance: buildProvenanceRef({
          providerId: "binance_public",
          venue: "binance",
          feedKind: "cross_exchange_confirmation",
          symbol: this.internalSymbol,
          eventTimeUtc: input.evaluatedAt,
        }),
        latencyMs: binanceTimed.latencyMs,
        evaluatedAt: input.evaluatedAt,
      });

      try {
        const bybitTimed = await timed(() => this.bybit.getSpotTicker(this.internalSymbol));
        const bybitObs = normalizeCrossExchangeConfirmation({
          symbol: this.internalSymbol,
          primaryLast: input.primaryLast,
          confirmLast: bybitTimed.value.lastPrice,
          confirmVenue: "bybit",
          provenance: buildProvenanceRef({
            providerId: "bybit_public",
            venue: "bybit",
            feedKind: "cross_exchange_confirmation",
            symbol: this.internalSymbol,
            eventTimeUtc: input.evaluatedAt,
          }),
          latencyMs: bybitTimed.latencyMs,
          evaluatedAt: input.evaluatedAt,
        });

        return binanceObs.confidence >= bybitObs.confidence ? binanceObs : bybitObs;
      } catch (bybitError) {
        input.degradationReasons.push(
          `bybit_unavailable:${bybitError instanceof Error ? bybitError.message : String(bybitError)}`,
        );
        return binanceObs;
      }
    } catch (error) {
      input.degradationReasons.push(
        `cross_exchange_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
      return normalizeUnavailableObservation({
        kind: "cross_exchange_confirmation",
        provenance: buildProvenanceRef({
          providerId: "binance_public",
          venue: "binance",
          feedKind: "cross_exchange_confirmation",
          symbol: this.internalSymbol,
          eventTimeUtc: input.evaluatedAt,
        }),
        evaluatedAt: input.evaluatedAt,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async fetchFearGreed(input: {
    evaluatedAt: string;
    degradationReasons: string[];
  }): Promise<NormalizedObservation | undefined> {
    try {
      const timedResult = await timed(() => this.fearGreed.getLatest());
      const eventTimeUtc = new Date(Number(timedResult.value.timestamp) * 1000).toISOString();
      return normalizeFearGreedObservation({
        value: Number(timedResult.value.value),
        classification: timedResult.value.value_classification,
        provenance: buildProvenanceRef({
          providerId: "alternative_me",
          venue: "alternative_me",
          feedKind: "fear_greed_index",
          symbol: "GLOBAL",
          eventTimeUtc,
        }),
        latencyMs: timedResult.latencyMs,
        evaluatedAt: input.evaluatedAt,
        eventTimeUtc,
      });
    } catch (error) {
      input.degradationReasons.push(
        `fear_greed_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
      return normalizeUnavailableObservation({
        kind: "fear_greed_index",
        provenance: buildProvenanceRef({
          providerId: "alternative_me",
          venue: "alternative_me",
          feedKind: "fear_greed_index",
          symbol: "GLOBAL",
          eventTimeUtc: input.evaluatedAt,
        }),
        evaluatedAt: input.evaluatedAt,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async fetchGlobalMarket(input: {
    evaluatedAt: string;
    degradationReasons: string[];
  }): Promise<NormalizedObservation | undefined> {
    try {
      const timedResult = await timed(() => this.coinGecko.getGlobalMarket());
      const eventTimeUtc = new Date(timedResult.value.updated_at * 1000).toISOString();
      return normalizeGlobalMarketObservation({
        btcDominance: timedResult.value.market_cap_percentage.btc ?? 0,
        marketCapUsd: timedResult.value.total_market_cap.usd ?? 0,
        provenance: buildProvenanceRef({
          providerId: "coingecko_global",
          venue: "coingecko",
          feedKind: "global_market_stats",
          symbol: "GLOBAL",
          eventTimeUtc,
        }),
        latencyMs: timedResult.latencyMs,
        evaluatedAt: input.evaluatedAt,
        eventTimeUtc,
      });
    } catch (error) {
      input.degradationReasons.push(
        `coingecko_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}

export async function fetchPrimaryBarsOnly(input: {
  client: HtxRestClient;
  internalSymbol: InstrumentId;
  period?: string;
  size?: number;
}): Promise<Bar[]> {
  const htxSymbol = internalSymbolToHtx(input.internalSymbol);
  const period = input.period ?? HTX_PERIOD_BY_INTERVAL["1m"];
  const klines = await input.client.getMarketHistoryKline({
    symbol: htxSymbol,
    period,
    size: input.size ?? 25,
  });
  return mapHtxKlinesToBars(input.internalSymbol, klines, "1m");
}
