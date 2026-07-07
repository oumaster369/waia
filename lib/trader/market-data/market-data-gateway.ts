import { AlternativeMeFearGreedClient } from "@/lib/trader/connectors/alternative-me/fear-greed-client";
import { BinancePublicMarketClient } from "@/lib/trader/connectors/binance/public-market-client";
import { BybitPublicMarketClient } from "@/lib/trader/connectors/bybit/public-market-client";
import { CoinGeckoGlobalMarketClient } from "@/lib/trader/connectors/coingecko/global-market-client";
import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import { HtxRestClient, type HtxFetchFn } from "@/lib/trader/connectors/htx/client";
import type { Bar, BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import {
  buildOptionalMarketDataAdapters,
  categorizeOptionalObservations,
} from "@/lib/trader/market-data/adapters/adapter-registry";
import { HtxDepthAdapter } from "@/lib/trader/market-data/adapters/htx-depth-adapter";
import { fuseContextV1 } from "@/lib/trader/market-data/fusion/context-fusion-v1";
import { buildCrossVenueTriangulation } from "@/lib/trader/market-data/fusion/cross-venue-triangulation";
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
  fredApiKey?: string;
  infuraProjectId?: string;
  infuraApiSecret?: string;
  tronGridApiKey?: string;
  githubToken?: string;
  secEdgarUserAgent?: string;
  cmeFedWatchEnabled?: boolean;
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

function resolveEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function pickObservationByKind(
  observations: readonly NormalizedObservation[],
  kind: NormalizedObservation["kind"],
): NormalizedObservation | undefined {
  return observations.find((observation) => observation.kind === kind);
}

export class MarketDataGateway {
  private readonly internalSymbol: InstrumentId;
  private readonly htxClient: HtxRestClient;
  private readonly htxDepthAdapter: HtxDepthAdapter;
  private readonly binance: BinancePublicMarketClient;
  private readonly bybit: BybitPublicMarketClient;
  private readonly fearGreed: AlternativeMeFearGreedClient;
  private readonly coinGecko: CoinGeckoGlobalMarketClient;
  private readonly disableOptionalProviders: boolean;
  private readonly optionalAdaptersConfig: {
    fetchImpl?: HtxFetchFn;
    internalSymbol: InstrumentId;
    fredApiKey?: string;
    infuraProjectId?: string;
    infuraApiSecret?: string;
    tronGridApiKey?: string;
    githubToken?: string;
    secEdgarUserAgent?: string;
    cmeFedWatchEnabled?: boolean;
  };
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
    this.htxDepthAdapter = new HtxDepthAdapter({
      htxClient: this.htxClient,
      internalSymbol: this.internalSymbol,
    });
    this.binance = new BinancePublicMarketClient({ fetchImpl });
    this.bybit = new BybitPublicMarketClient({ fetchImpl });
    this.fearGreed = new AlternativeMeFearGreedClient({ fetchImpl });
    this.coinGecko = new CoinGeckoGlobalMarketClient({
      fetchImpl,
      apiKey: config.coingeckoApiKey ?? process.env.COINGECKO_API_KEY,
    });
    this.disableOptionalProviders = config.disableOptionalProviders ?? false;
    this.optionalAdaptersConfig = {
      fetchImpl,
      internalSymbol: this.internalSymbol,
      fredApiKey: config.fredApiKey ?? process.env.FRED_API_KEY,
      infuraProjectId: config.infuraProjectId ?? process.env.AI_TRADER_INFURA_PROJECT_ID,
      infuraApiSecret: config.infuraApiSecret ?? process.env.AI_TRADER_INFURA_API_SECRET,
      tronGridApiKey: config.tronGridApiKey ?? process.env.AI_TRADER_TRONGRID_API_KEY,
      githubToken: config.githubToken ?? process.env.AI_TRADER_GITHUB_TOKEN,
      secEdgarUserAgent: config.secEdgarUserAgent ?? process.env.AI_TRADER_SEC_EDGAR_USER_AGENT,
      cmeFedWatchEnabled:
        config.cmeFedWatchEnabled ?? resolveEnvBoolean(process.env.AI_TRADER_CME_FEDWATCH_ENABLED),
    };
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

    const depthObservations = await this.htxDepthAdapter.fetchObservations({
      instrumentId: this.internalSymbol,
      symbol: this.internalSymbol,
      evaluatedAt,
      fetchImpl: this.optionalAdaptersConfig.fetchImpl,
    });
    const orderBookSnapshot = pickObservationByKind(depthObservations, "order_book_snapshot");
    const marketTradesSnapshot = pickObservationByKind(depthObservations, "market_trades_snapshot");
    for (const observation of depthObservations) {
      if (observation.health === "UNAVAILABLE") {
        degradationReasons.push(
          `${observation.provenance.feedKind}_unavailable:${observation.payload.reason ?? "unknown"}`,
        );
      }
    }

    let crossExchangeConfirmation: NormalizedObservation | undefined;
    let crossVenueTriangulation;
    let fearGreedObservation: NormalizedObservation | undefined;
    let globalMarketObservation: NormalizedObservation | undefined;
    let macroEvidence: NormalizedObservation[] = [];
    let newsEvidence: NormalizedObservation[] = [];
    let blockchainEvidence: NormalizedObservation[] = [];
    let regulatoryEvidence: NormalizedObservation[] = [];
    let protocolEvidence: NormalizedObservation[] = [];

    if (!this.disableOptionalProviders) {
      const crossExchange = await this.fetchCrossExchangeConfirmation({
        primaryLast: quote.last,
        evaluatedAt,
        degradationReasons,
      });
      crossExchangeConfirmation = crossExchange.crossExchangeConfirmation;
      crossVenueTriangulation = crossExchange.crossVenueTriangulation;
      fearGreedObservation = await this.fetchFearGreed({ evaluatedAt, degradationReasons });
      globalMarketObservation = await this.fetchGlobalMarket({ evaluatedAt, degradationReasons });

      const optionalAdapters = buildOptionalMarketDataAdapters(this.optionalAdaptersConfig);
      const adapterResults = await Promise.allSettled(
        optionalAdapters.map((adapter) =>
          adapter.fetchObservations({
            instrumentId: this.internalSymbol,
            symbol: this.internalSymbol,
            evaluatedAt,
            fetchImpl: this.optionalAdaptersConfig.fetchImpl,
          }),
        ),
      );

      const optionalObservations: NormalizedObservation[] = [];
      for (let index = 0; index < adapterResults.length; index++) {
        const result = adapterResults[index];
        const adapter = optionalAdapters[index];
        if (!result || !adapter) {
          continue;
        }
        if (result.status === "rejected") {
          degradationReasons.push(
            `${adapter.providerId}_unavailable:${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          );
          continue;
        }
        for (const observation of result.value) {
          if (observation.health === "UNAVAILABLE") {
            degradationReasons.push(
              `${adapter.providerId}_unavailable:${observation.payload.reason ?? "unknown"}`,
            );
          }
        }
        optionalObservations.push(...result.value);
      }

      const categorized = categorizeOptionalObservations(optionalObservations);
      macroEvidence = categorized.macroEvidence;
      newsEvidence = categorized.newsEvidence;
      blockchainEvidence = categorized.blockchainEvidence;
      regulatoryEvidence = categorized.regulatoryEvidence;
      protocolEvidence = categorized.protocolEvidence;
    }

    const fusedContext = fuseContextV1({
      instrumentId: this.internalSymbol,
      fusedAtUtc: evaluatedAt,
      mtfBars: mtfObservations,
      primaryQuote,
      orderBookSnapshot,
      marketTradesSnapshot,
      crossExchangeConfirmation,
      crossVenueTriangulation,
      fearGreed: fearGreedObservation,
      globalMarket: globalMarketObservation,
      macroEvidence,
      newsEvidence,
      blockchainEvidence,
      regulatoryEvidence,
      protocolEvidence,
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
  }): Promise<{
    crossExchangeConfirmation?: NormalizedObservation;
    crossVenueTriangulation: ReturnType<typeof buildCrossVenueTriangulation>;
  }> {
    let binanceObs: NormalizedObservation | undefined;
    let bybitObs: NormalizedObservation | undefined;

    try {
      const binanceTimed = await timed(() => this.binance.getTickerPrice(this.internalSymbol));
      binanceObs = normalizeCrossExchangeConfirmation({
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
    } catch (error) {
      input.degradationReasons.push(
        `binance_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const bybitTimed = await timed(() => this.bybit.getSpotTicker(this.internalSymbol));
      bybitObs = normalizeCrossExchangeConfirmation({
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
    } catch (error) {
      input.degradationReasons.push(
        `bybit_unavailable:${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const crossVenueTriangulation = buildCrossVenueTriangulation({
      binance: binanceObs,
      bybit: bybitObs,
    });

    if (!binanceObs && !bybitObs) {
      return {
        crossExchangeConfirmation: normalizeUnavailableObservation({
          kind: "cross_exchange_confirmation",
          provenance: buildProvenanceRef({
            providerId: "binance_public",
            venue: "binance",
            feedKind: "cross_exchange_confirmation",
            symbol: this.internalSymbol,
            eventTimeUtc: input.evaluatedAt,
          }),
          evaluatedAt: input.evaluatedAt,
          reason: "cross_exchange_unavailable",
        }),
        crossVenueTriangulation,
      };
    }

    const crossExchangeConfirmation =
      binanceObs && bybitObs
        ? binanceObs.confidence >= bybitObs.confidence
          ? binanceObs
          : bybitObs
        : (binanceObs ?? bybitObs);

    return { crossExchangeConfirmation, crossVenueTriangulation };
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
      return normalizeUnavailableObservation({
        kind: "global_market_stats",
        provenance: buildProvenanceRef({
          providerId: "coingecko_global",
          venue: "coingecko",
          feedKind: "global_market_stats",
          symbol: "GLOBAL",
          eventTimeUtc: input.evaluatedAt,
        }),
        evaluatedAt: input.evaluatedAt,
        reason: error instanceof Error ? error.message : String(error),
      });
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
