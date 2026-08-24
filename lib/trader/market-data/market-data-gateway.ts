import { AlternativeMeFearGreedClient } from "@/lib/trader/connectors/alternative-me/fear-greed-client";
import { BinancePublicMarketClient } from "@/lib/trader/connectors/binance/public-market-client";
import { BybitPublicMarketClient } from "@/lib/trader/connectors/bybit/public-market-client";
import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import { HtxRestClient, type HtxFetchFn } from "@/lib/trader/connectors/htx/client";
import {
  assertInformationAcquisitionSelectionV1,
  computeInquiryContentDigest,
  inquiryCanonicalTextCompare,
  type InformationAcquisitionSelectionV1,
  type InformationRequestedSourceV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
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
  normalizeOhlcvBarsObservation,
  normalizeQuoteObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import { prepareCanonicalPitAttemptV1 } from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import {
  HTX_PERIOD_BY_INTERVAL,
  MTF_BAR_INTERVALS,
  type FusedMarketContext,
  type MarketDataProviderId,
  type NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import {
  defineInformationAcquisitionReceiptV1,
  type InformationAcquisitionOutcomeReasonV1,
  type InformationAcquisitionOutcomeV1,
  type InformationAcquisitionReceiptV1,
  type MarketSnapshot,
} from "@/lib/trader/market-data/types";
import {
  resolveMarketDataProviderSelection,
  type MarketDataProviderSelectionResolution,
} from "@/lib/trader/market-data/provider-registry";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

// CoinGeckoGlobalMarketClient remains registry-covered but is never selected here because
// global_market_stats is EXCLUDED_UNMODELED at the canonical primitive boundary.

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
  crossExchangeObservations?: {
    binance?: NormalizedObservation;
    bybit?: NormalizedObservation;
  };
  canonicalPitCandidates: readonly NormalizedObservation[];
  informationAcquisition: InformationAcquisitionReceiptV1 | null;
};

type ResolvedRequestedSource = Readonly<{
  source: InformationRequestedSourceV1;
  resolution: MarketDataProviderSelectionResolution;
}>;

function rejectedAcquisitionOutcome(
  source: InformationRequestedSourceV1,
  reasonCode: InformationAcquisitionOutcomeReasonV1,
): InformationAcquisitionOutcomeV1 {
  return {
    requestedSource: source,
    status: "REJECTED",
    reasonCode,
    canonicalPitAttempts: [],
    observationContentDigests: [],
  };
}

function unavailableAcquisitionOutcome(
  source: InformationRequestedSourceV1,
): InformationAcquisitionOutcomeV1 {
  return {
    requestedSource: source,
    status: "UNAVAILABLE",
    reasonCode: "SOURCE_UNAVAILABLE",
    canonicalPitAttempts: [],
    observationContentDigests: [],
  };
}

function classifyAcquisitionOutcome(input: {
  source: InformationRequestedSourceV1;
  observations: readonly NormalizedObservation[];
}): Readonly<{
  outcome: InformationAcquisitionOutcomeV1;
  acceptedObservations: readonly NormalizedObservation[];
}> {
  const observations = input.observations
    .filter(
      (observation) =>
        observation.provenance.providerId === input.source.providerId &&
        (input.source.allowedObservationKinds as readonly string[]).includes(observation.kind),
    )
    .map((observation) => ({
      observation,
      attempt: prepareCanonicalPitAttemptV1(observation),
    }))
    .map((entry) => ({ ...entry, digest: entry.attempt.normalizedInputDigest }))
    .sort((left, right) => inquiryCanonicalTextCompare(left.digest, right.digest))
    .filter((entry, index, entries) => index === 0 || entry.digest !== entries[index - 1]?.digest);

  if (observations.length === 0) {
    return {
      outcome: rejectedAcquisitionOutcome(input.source, "SOURCE_RETURNED_NO_ADMITTED_OBSERVATION"),
      acceptedObservations: [],
    };
  }

  const available = observations.filter((entry) => entry.attempt.status === "AVAILABLE");
  const rejected = observations.filter((entry) => entry.attempt.status === "REJECTED");
  const unavailable = observations.filter((entry) => entry.attempt.status === "UNAVAILABLE");
  const selected = available.length > 0 ? available : rejected.length > 0 ? rejected : unavailable;
  const status =
    available.length > 0 ? "AVAILABLE" : rejected.length > 0 ? "REJECTED" : "UNAVAILABLE";
  const reasonCode =
    status === "AVAILABLE" ? null : (selected[0]?.attempt.reason ?? "SOURCE_UNAVAILABLE");
  return {
    outcome: {
      requestedSource: input.source,
      status,
      reasonCode,
      canonicalPitAttempts: selected.map((entry) => entry.attempt),
      observationContentDigests:
        status === "AVAILABLE" ? selected.map((entry) => entry.digest) : [],
    },
    acceptedObservations: status === "AVAILABLE" ? selected.map((entry) => entry.observation) : [],
  };
}

export function listCanonicalPitGatewayCandidates(
  context: FusedMarketContext,
  crossExchangeObservations?: GatewayPollResult["crossExchangeObservations"],
): NormalizedObservation[] {
  const candidates: NormalizedObservation[] = [];
  for (const interval of MTF_BAR_INTERVALS) {
    candidates.push(...(context.mtfBars[interval] ?? []));
  }
  for (const observation of [
    context.primaryQuote,
    context.orderBookSnapshot,
    context.marketTradesSnapshot,
    context.crossExchangeConfirmation,
    context.fearGreed,
    context.globalMarket,
    crossExchangeObservations?.binance,
    crossExchangeObservations?.bybit,
  ]) {
    if (observation) candidates.push(observation);
  }
  candidates.push(
    ...(context.macroEvidence ?? []),
    ...(context.newsEvidence ?? []),
    ...(context.blockchainEvidence ?? []),
    ...(context.regulatoryEvidence ?? []),
    ...(context.protocolEvidence ?? []),
  );

  const unique = new Map<string, NormalizedObservation>();
  for (const observation of candidates) {
    const digest = computeStableJsonDigest(observation);
    if (!unique.has(digest)) unique.set(digest, observation);
  }
  return [...unique.values()];
}

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
    informationSelection?: InformationAcquisitionSelectionV1;
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

    const fusedContext = fuseContextV1({
      instrumentId: this.internalSymbol,
      fusedAtUtc: evaluatedAt,
      mtfBars: mtfObservations,
      primaryQuote,
      orderBookSnapshot,
      marketTradesSnapshot,
      macroEvidence: [],
      newsEvidence: [],
      blockchainEvidence: [],
      regulatoryEvidence: [],
      protocolEvidence: [],
      degradationReasons,
    });

    const mandatoryBundle: GatewayPollResult = {
      snapshot: { ...snapshot, evaluatedAt: snapshot.evaluatedAt ?? evaluatedAt },
      fusedContext,
      mtfBarsByInterval,
      crossExchangeObservations: {},
      canonicalPitCandidates: listCanonicalPitGatewayCandidates(fusedContext),
      informationAcquisition: null,
    };
    if (!input?.informationSelection) return mandatoryBundle;
    return this.acquireSelectedInformation({
      mandatoryBundle,
      selection: input.informationSelection,
    });
  }

  async acquireSelectedInformation(input: {
    mandatoryBundle: GatewayPollResult;
    selection: InformationAcquisitionSelectionV1;
  }): Promise<GatewayPollResult> {
    const selection = assertInformationAcquisitionSelectionV1(input.selection);
    const resolvedSources: ResolvedRequestedSource[] = selection.requestedSources.map((source) => ({
      source,
      resolution: resolveMarketDataProviderSelection(source),
    }));
    const scopeReason =
      selection.mode !== "LIVE"
        ? "SELECTION_MODE_MISMATCH"
        : selection.symbol !== this.internalSymbol ||
            selection.pitAnchor !== input.mandatoryBundle.fusedContext.fusedAtUtc
          ? "SELECTION_SCOPE_MISMATCH"
          : null;

    const providerObservations = new Map<string, readonly NormalizedObservation[]>();
    providerObservations.set("htx_spot", input.mandatoryBundle.canonicalPitCandidates);
    const unavailableProviders = new Set<string>();
    const optionalDegradationReasons: string[] = [];
    const selectedProviderIds = [
      ...new Set(
        resolvedSources.flatMap(({ resolution }) =>
          resolution.status === "ACCEPTED" && resolution.provider.id !== "htx_spot"
            ? [resolution.provider.id]
            : [],
        ),
      ),
    ];

    if (!scopeReason && !this.disableOptionalProviders) {
      if (selectedProviderIds.includes("alternative_me")) {
        const fearGreed = await this.fetchFearGreed({
          evaluatedAt: selection.pitAnchor,
          degradationReasons: optionalDegradationReasons,
        });
        providerObservations.set("alternative_me", fearGreed ? [fearGreed] : []);
      }
      for (const providerId of ["binance_public", "bybit_public"] as const) {
        if (!selectedProviderIds.includes(providerId)) continue;
        try {
          providerObservations.set(providerId, [
            await this.fetchCrossExchangeProvider({
              providerId,
              primaryLast: input.mandatoryBundle.snapshot.quote.last,
              evaluatedAt: selection.pitAnchor,
            }),
          ]);
        } catch (error) {
          unavailableProviders.add(providerId);
          optionalDegradationReasons.push(
            `${providerId}_unavailable:${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const directProviders = new Set<MarketDataProviderId>([
        "htx_spot",
        "alternative_me",
        "binance_public",
        "bybit_public",
      ]);
      const adapterProviderIds: MarketDataProviderId[] = selectedProviderIds.filter(
        (providerId) => !directProviders.has(providerId),
      );
      const optionalAdapters = buildOptionalMarketDataAdapters(
        this.optionalAdaptersConfig,
        adapterProviderIds,
      );
      const adapterResults = await Promise.allSettled(
        optionalAdapters.map((adapter) =>
          adapter.fetchObservations({
            instrumentId: this.internalSymbol,
            symbol: this.internalSymbol,
            evaluatedAt: selection.pitAnchor,
            fetchImpl: this.optionalAdaptersConfig.fetchImpl,
          }),
        ),
      );
      for (let index = 0; index < adapterResults.length; index++) {
        const result = adapterResults[index];
        const adapter = optionalAdapters[index];
        if (!result || !adapter) continue;
        if (result.status === "rejected") {
          unavailableProviders.add(adapter.providerId);
          optionalDegradationReasons.push(
            `${adapter.providerId}_unavailable:${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          );
          continue;
        }
        providerObservations.set(adapter.providerId, result.value);
        for (const observation of result.value) {
          if (observation.health === "UNAVAILABLE") {
            optionalDegradationReasons.push(
              `${adapter.providerId}_unavailable:${observation.payload.reason ?? "unknown"}`,
            );
          }
        }
      }
    } else if (!scopeReason) {
      for (const providerId of selectedProviderIds) unavailableProviders.add(providerId);
    }

    const resolvedOutcomes = resolvedSources.map(({ source, resolution }) => {
      if (scopeReason) {
        return {
          outcome: rejectedAcquisitionOutcome(source, scopeReason),
          acceptedObservations: [],
        };
      }
      if (resolution.status === "REJECTED") {
        return {
          outcome: rejectedAcquisitionOutcome(source, resolution.reasonCode),
          acceptedObservations: [],
        };
      }
      if (unavailableProviders.has(resolution.provider.id)) {
        return { outcome: unavailableAcquisitionOutcome(source), acceptedObservations: [] };
      }
      const observations = providerObservations.get(resolution.provider.id);
      if (!observations) {
        return { outcome: unavailableAcquisitionOutcome(source), acceptedObservations: [] };
      }
      return classifyAcquisitionOutcome({ source, observations });
    });
    const outcomes = resolvedOutcomes.map((resolved) => resolved.outcome);
    const informationAcquisition = defineInformationAcquisitionReceiptV1({ selection, outcomes });
    const acceptedObservations = resolvedOutcomes.flatMap(
      (resolved) => resolved.acceptedObservations,
    );
    const uniqueAccepted = new Map<string, NormalizedObservation>();
    for (const observation of acceptedObservations) {
      const digest = computeInquiryContentDigest(observation);
      if (!uniqueAccepted.has(digest)) uniqueAccepted.set(digest, observation);
    }
    const optionalObservations = [...uniqueAccepted.values()].filter(
      (observation) => observation.provenance.providerId !== "htx_spot",
    );
    const categorized = categorizeOptionalObservations(optionalObservations);
    const fearGreed = optionalObservations.find(
      (observation) => observation.kind === "fear_greed_index",
    );
    const crossExchangeObservations = {
      binance: optionalObservations.find(
        (observation) => observation.provenance.providerId === "binance_public",
      ),
      bybit: optionalObservations.find(
        (observation) => observation.provenance.providerId === "bybit_public",
      ),
    };
    const crossExchangeCandidates = [
      crossExchangeObservations.binance,
      crossExchangeObservations.bybit,
    ].filter((observation): observation is NormalizedObservation => observation !== undefined);
    const crossExchangeConfirmation = crossExchangeCandidates[0];
    const crossVenueTriangulation =
      crossExchangeCandidates.length > 0
        ? buildCrossVenueTriangulation({
            binance: crossExchangeObservations.binance,
            bybit: crossExchangeObservations.bybit,
          })
        : undefined;
    const mandatory = input.mandatoryBundle.fusedContext;
    const fusedContext = fuseContextV1({
      instrumentId: this.internalSymbol,
      fusedAtUtc: selection.pitAnchor,
      mtfBars: mandatory.mtfBars,
      primaryQuote: mandatory.primaryQuote,
      orderBookSnapshot: mandatory.orderBookSnapshot,
      marketTradesSnapshot: mandatory.marketTradesSnapshot,
      crossExchangeConfirmation,
      crossVenueTriangulation,
      fearGreed,
      macroEvidence: categorized.macroEvidence,
      newsEvidence: categorized.newsEvidence,
      blockchainEvidence: categorized.blockchainEvidence,
      regulatoryEvidence: categorized.regulatoryEvidence,
      protocolEvidence: categorized.protocolEvidence,
      degradationReasons: [...mandatory.degradationReasons, ...optionalDegradationReasons],
    });
    return {
      snapshot: input.mandatoryBundle.snapshot,
      fusedContext,
      mtfBarsByInterval: input.mandatoryBundle.mtfBarsByInterval,
      crossExchangeObservations,
      canonicalPitCandidates: listCanonicalPitGatewayCandidates(
        fusedContext,
        crossExchangeObservations,
      ),
      informationAcquisition,
    };
  }

  private async fetchCrossExchangeProvider(input: {
    providerId: "binance_public" | "bybit_public";
    primaryLast: string;
    evaluatedAt: string;
  }): Promise<NormalizedObservation> {
    if (input.providerId === "binance_public") {
      const binanceTimed = await timed(() => this.binance.getTickerPrice(this.internalSymbol));
      return normalizeCrossExchangeConfirmation({
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
    }
    const bybitTimed = await timed(() => this.bybit.getSpotTicker(this.internalSymbol));
    return normalizeCrossExchangeConfirmation({
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
