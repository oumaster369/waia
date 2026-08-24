import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildMarketUnderstandingBridge } from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import { cdeReasonCodes } from "@/lib/trader/intelligence/types";
import { buildCrossVenueTriangulation } from "@/lib/trader/market-data/fusion/cross-venue-triangulation";
import { fuseContextV0 } from "@/lib/trader/market-data/fusion/context-fusion-v0";
import { MarketDataGateway } from "@/lib/trader/market-data/market-data-gateway";
import {
  buildProvenanceRef,
  normalizeCrossExchangeConfirmation,
  normalizeFearGreedObservation,
  normalizeOhlcvBarsObservation,
  normalizeUnavailableObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import { MTF_BAR_INTERVALS } from "@/lib/trader/market-data/observation-types";
import { aggregateProviderHealth } from "@/lib/trader/market-data/reliability/provider-health";
import { classifySessionPhaseUtc } from "@/lib/trader/market-data/session/session-phase-classifier";
import { computeAsianRangeCorridorMetadata } from "@/lib/trader/market-data/session/asian-range-corridor";
import { validateObservation } from "@/lib/trader/market-data/validation/validate-observation";
import {
  createHtxGatewayMockFetch,
  htxPollSourceOptions,
  type HtxKlineFixture,
} from "@/tests/helpers/htx-gateway-mock-fetch";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";

function loadHtxFixture(): HtxKlineFixture {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as HtxKlineFixture;
}

function loadFixtureBars() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    bars: import("@/lib/trader/intelligence/types").Bar[];
    latestQuote: import("@/lib/trader/intelligence/types").Quote;
  };
}

describe("PR2.5 session phase classifier", () => {
  it("classifies UTC hours into session phases", () => {
    expect(classifySessionPhaseUtc("2026-01-01T02:00:00.000Z")).toBe("ASIA");
    expect(classifySessionPhaseUtc("2026-01-01T10:00:00.000Z")).toBe("EUROPE");
    expect(classifySessionPhaseUtc("2026-01-01T14:00:00.000Z")).toBe("OVERLAP");
    expect(classifySessionPhaseUtc("2026-01-01T18:00:00.000Z")).toBe("US");
  });
});

describe("PR2.5 provider health degradation", () => {
  it("marks unavailable observations with zero confidence", () => {
    const evaluatedAt = "2026-01-01T14:00:00.000Z";
    const observation = normalizeUnavailableObservation({
      kind: "fear_greed_index",
      provenance: buildProvenanceRef({
        providerId: "alternative_me",
        venue: "alternative_me",
        feedKind: "fear_greed_index",
        symbol: "GLOBAL",
        eventTimeUtc: evaluatedAt,
      }),
      evaluatedAt,
      reason: "timeout",
    });

    expect(observation.health).toBe("UNAVAILABLE");
    expect(observation.confidence).toBe(0);
    expect(validateObservation(observation).valid).toBe(true);
  });

  it("aggregates worst health across observations", () => {
    const evaluatedAt = "2026-01-01T14:00:00.000Z";
    const healthy = normalizeFearGreedObservation({
      value: 50,
      classification: "Neutral",
      provenance: buildProvenanceRef({
        providerId: "alternative_me",
        venue: "alternative_me",
        feedKind: "fear_greed_index",
        symbol: "GLOBAL",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 10,
      evaluatedAt,
      eventTimeUtc: evaluatedAt,
    });
    const unavailable = normalizeUnavailableObservation({
      kind: "cross_exchange_confirmation",
      provenance: buildProvenanceRef({
        providerId: "binance_public",
        venue: "binance",
        feedKind: "cross_exchange_confirmation",
        symbol: "BTC/USDT",
        eventTimeUtc: evaluatedAt,
      }),
      evaluatedAt,
      reason: "offline",
    });

    const aggregate = aggregateProviderHealth([healthy, unavailable]);
    expect(aggregate.health).toBe("UNAVAILABLE");
    expect(aggregate.confidence).toBe(0);
  });
});

describe("PR2.5 context fusion v0", () => {
  it("merges MTF observations deterministically", () => {
    const evaluatedAt = "2026-01-01T02:00:00.000Z";
    const fixture = loadFixtureBars();
    const mtfBars: Partial<
      Record<
        import("@/lib/trader/intelligence/types").BarInterval,
        ReturnType<typeof normalizeOhlcvBarsObservation>[]
      >
    > = {};

    for (const interval of MTF_BAR_INTERVALS) {
      const barsForInterval = fixture.bars.map((bar) => ({ ...bar, interval }));
      const observations = [
        normalizeOhlcvBarsObservation({
          bars: barsForInterval.slice(0, 12),
          provenance: buildProvenanceRef({
            providerId: "htx_spot",
            venue: "htx",
            feedKind: "ohlcv_bar",
            symbol: "BTC/USDT",
            eventTimeUtc: evaluatedAt,
          }),
          latencyMs: 5,
          evaluatedAt,
        }),
      ];
      if (interval === "1h") {
        observations.push(
          normalizeOhlcvBarsObservation({
            bars: barsForInterval.slice(12),
            provenance: buildProvenanceRef({
              providerId: "htx_spot",
              venue: "htx",
              feedKind: "ohlcv_bar",
              symbol: "BTC/USDT",
              eventTimeUtc: evaluatedAt,
            }),
            latencyMs: 6,
            evaluatedAt,
          }),
        );
      }
      mtfBars[interval] = observations;
    }

    const fused = fuseContextV0({
      instrumentId: "BTC/USDT",
      fusedAtUtc: evaluatedAt,
      mtfBars,
    });

    expect(fused.schemaVersion).toBe("waia.trader.fused_context.v2");
    expect(Object.keys(fused.mtfBars)).toHaveLength(MTF_BAR_INTERVALS.length);
    expect(fused.sessionPhase).toBe("ASIA");
    expect(fused.asianRangeCorridor?.isResearchSeedOnly).toBe(true);
  });
});

describe("PR2.5 CDE fused context hooks", () => {
  it("downgrades permission when aggregate health is degraded", () => {
    const fixture = loadFixtureBars();
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
    });

    const fusedContext = fuseContextV0({
      instrumentId: "BTC/USDT",
      fusedAtUtc: "2026-01-01T14:00:00.000Z",
      mtfBars: {},
      degradationReasons: ["binance_unavailable"],
    });

    const degraded = {
      ...fusedContext,
      aggregateHealth: "DEGRADED" as const,
      aggregateConfidence: 0.4,
    };

    const msv = buildMsvEnvelope({ features, fusedContext: degraded });
    expect(msv.derived.tradingPermission).toBe("ALLOW_REDUCED_RISK");
    expect(msv.derived.reasonCodes).toContain(cdeReasonCodes.fusedContextReduced);
    expect(msv.derived.riskMultiplier).toBe("0.5");
  });

  it("PR2.6 downgrades permission when understanding reports cross-venue conflict", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });

    const binance = normalizeCrossExchangeConfirmation({
      symbol: "BTC/USDT",
      primaryLast: fixture.latestQuote.last,
      confirmLast: "70000",
      confirmVenue: "binance",
      provenance: buildProvenanceRef({
        providerId: "binance_public",
        venue: "binance",
        feedKind: "cross_exchange_confirmation",
        symbol: "BTC/USDT",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 1,
      evaluatedAt,
    });
    const bybit = normalizeCrossExchangeConfirmation({
      symbol: "BTC/USDT",
      primaryLast: fixture.latestQuote.last,
      confirmLast: "60000",
      confirmVenue: "bybit",
      provenance: buildProvenanceRef({
        providerId: "bybit_public",
        venue: "bybit",
        feedKind: "cross_exchange_confirmation",
        symbol: "BTC/USDT",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 1,
      evaluatedAt,
    });

    const fusedContext = fuseContextV0({
      instrumentId: "BTC/USDT",
      fusedAtUtc: evaluatedAt,
      mtfBars: {},
      crossExchangeConfirmation: binance,
      crossVenueTriangulation: buildCrossVenueTriangulation({ binance, bybit }),
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const msv = buildMsvEnvelope({ features, fusedContext, understanding });

    expect(msv.understanding).toBeDefined();
    expect(msv.derived.tradingPermission).not.toBe("ALLOW_TRADING");
    expect(msv.derived.reasonCodes).toContain(cdeReasonCodes.understandingCrossVenueConflict);
  });
});

describe("PR2.5 market data gateway", () => {
  it("polls HTX MTF and produces fused context without optional providers", async () => {
    const fixture = loadHtxFixture();
    const gateway = new MarketDataGateway({
      fetchImpl: createHtxGatewayMockFetch(fixture),
      disableOptionalProviders: true,
    });

    const bundle = await gateway.pollEvaluationBundle({ cycleIdPrefix: "pr25-test" });

    expect(bundle.snapshot.bars).toHaveLength(25);
    expect(bundle.fusedContext.mtfBars["1m"]).toBeDefined();
    expect(bundle.fusedContext.mtfBars["1d"]).toBeDefined();
    expect(bundle.fusedContext.aggregateHealth).not.toBe("UNAVAILABLE");
  });

  it("fails soft when optional providers unavailable", async () => {
    const fixture = loadHtxFixture();
    const gateway = new MarketDataGateway({
      fetchImpl: createHtxGatewayMockFetch(fixture),
      disableOptionalProviders: false,
    });

    const bundle = await gateway.pollEvaluationBundle({ cycleIdPrefix: "pr25-degrade" });

    expect(bundle.fusedContext.degradationReasons.length).toBeGreaterThan(0);
    expect(bundle.snapshot.bars.length).toBeGreaterThanOrEqual(20);
  });

  it("does not derive cross-venue triangulation without an exact acquisition selection", async () => {
    const fixture = loadHtxFixture();
    const gateway = new MarketDataGateway({
      fetchImpl: createHtxGatewayMockFetch(fixture),
      disableOptionalProviders: false,
    });

    const bundle = await gateway.pollEvaluationBundle({ cycleIdPrefix: "pr26-triangulation" });

    expect(bundle.informationAcquisition).toBeNull();
    expect(bundle.fusedContext.crossVenueTriangulation).toBeUndefined();
    expect(bundle.fusedContext.crossExchangeConfirmation).toBeUndefined();
  });
});

describe("PR2.5 asian range corridor metadata", () => {
  it("never sets trading flags — research seed only", () => {
    const evaluatedAt = "2026-01-01T03:00:00.000Z";
    const fixture = loadFixtureBars();
    const observationA = normalizeOhlcvBarsObservation({
      bars: fixture.bars.slice(0, 12).map((bar) => ({ ...bar, interval: "1h" })),
      provenance: buildProvenanceRef({
        providerId: "htx_spot",
        venue: "htx",
        feedKind: "ohlcv_bar",
        symbol: "BTC/USDT",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 1,
      evaluatedAt,
    });
    const observationB = normalizeOhlcvBarsObservation({
      bars: fixture.bars.slice(12).map((bar) => ({ ...bar, interval: "1h" })),
      provenance: buildProvenanceRef({
        providerId: "htx_spot",
        venue: "htx",
        feedKind: "ohlcv_bar",
        symbol: "BTC/USDT",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 2,
      evaluatedAt,
    });

    const corridor = computeAsianRangeCorridorMetadata({
      sessionPhase: "ASIA",
      mtfBars: { "1h": [observationA, observationB] },
    });

    expect(corridor).toBeDefined();
    expect(corridor!.isResearchSeedOnly).toBe(true);
  });
});

describe("PR2.5 HtxBarPollSource gateway integration", () => {
  it("fetchEvaluationBundle exposes fused context for paper cycles", async () => {
    const fixture = loadHtxFixture();
    const poll = new HtxBarPollSource(htxPollSourceOptions(fixture));

    const bundle = await poll.fetchEvaluationBundle();
    expect(bundle.fusedContext.instrumentId).toBe("BTC/USDT");
    expect(bundle.fusedContext.provenance.length).toBeGreaterThan(0);
  });
});
