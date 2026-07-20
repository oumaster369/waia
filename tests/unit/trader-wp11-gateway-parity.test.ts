/**
 * HTR-WP11 — gateway parity + sidecar v1/v2 byte compatibility.
 */
import { describe, expect, it } from "vitest";

import {
  applyNewBarsToCanvas,
  createInitialCanvasState,
} from "@/lib/trader/backtest/canvas-replay-integration";
import { buildHistoricalIngressContext } from "@/lib/trader/market-data/replay/historical-ingress-gateway";
import { buildReplayFusedContextClosedOnlyLegacy } from "@/lib/trader/market-data/replay-fused-context-builder";
import {
  parseReplayProviderSidecar,
  type ReplayProviderSidecarV1,
  type ReplayProviderSidecarV2,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import {
  loadMeanReversionFixture,
  loadSidecarV1Fixture,
  loadSidecarV2Fixture,
} from "@/tests/unit/helpers/wp11-wp12-fixture";

function sidecarObservationSlice(
  context: ReturnType<typeof buildHistoricalIngressContext>["context"],
) {
  return {
    fearGreed: context.fearGreed,
    globalMarket: context.globalMarket,
    crossExchangeConfirmation: context.crossExchangeConfirmation,
    orderBookSnapshot: context.orderBookSnapshot,
    marketTradesSnapshot: context.marketTradesSnapshot,
    macroEvidence: context.macroEvidence,
    newsEvidence: context.newsEvidence,
    blockchainEvidence: context.blockchainEvidence,
    regulatoryEvidence: context.regulatoryEvidence,
    protocolEvidence: context.protocolEvidence,
    degradationReasons: context.degradationReasons,
  };
}

describe("HTR-WP11 gateway parity", () => {
  it("v1 and v2 sidecars parse and produce byte-identical overlapping lane slices", () => {
    const fixture = loadMeanReversionFixture();
    const evaluatedAt = "2026-01-01T00:25:00.000Z";
    let canvasState = createInitialCanvasState();
    canvasState = applyNewBarsToCanvas(canvasState, fixture.bars, 0).state;

    const sidecarV1 = parseReplayProviderSidecar(loadSidecarV1Fixture()) as ReplayProviderSidecarV1;
    const entry = sidecarV1.entries[0]!;
    const sidecarV2: ReplayProviderSidecarV2 = {
      schemaVersion: "waia.trader.m9_provider_sidecar.v2",
      instrumentId: "BTC/USDT",
      captureAsOfUtc: evaluatedAt,
      generatedBy: "tests/unit/trader-wp11-gateway-parity.test.ts",
      lanes: {
        fear_greed_index: {
          value: entry.fearGreed!.value,
          classification: entry.fearGreed!.classification,
          eventTimeUtc: evaluatedAt,
        },
        global_market_stats: {
          btcDominance: entry.globalMarket!.btcDominance,
          marketCapUsd: entry.globalMarket!.marketCapUsd,
          eventTimeUtc: evaluatedAt,
        },
        cross_exchange_confirmation: [
          {
            confirmVenue: "binance",
            confirmLast: entry.binanceConfirmLast!,
            eventTimeUtc: evaluatedAt,
          },
          {
            confirmVenue: "bybit",
            confirmLast: entry.bybitConfirmLast!,
            eventTimeUtc: evaluatedAt,
          },
        ],
      },
    };

    const v1 = buildHistoricalIngressContext({
      substrateMode: "legacy-oracle",
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: sidecarV1,
      canvasState,
    });
    const v2 = buildHistoricalIngressContext({
      substrateMode: "legacy-oracle",
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: sidecarV2,
      canvasState,
    });

    expect(canonicalJsonString(sidecarObservationSlice(v1.context))).toBe(
      canonicalJsonString(sidecarObservationSlice(v2.context)),
    );
  });

  it("parity-both accepts matching incremental and legacy substrates", () => {
    const fixture = loadMeanReversionFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    let canvasState = createInitialCanvasState();
    canvasState = applyNewBarsToCanvas(canvasState, fixture.bars, 0).state;

    expect(() =>
      buildHistoricalIngressContext({
        substrateMode: "parity-both",
        bars: fixture.bars,
        quote: fixture.latestQuote,
        evaluatedAt,
        instrumentId: "BTC/USDT",
        canvasState,
      }),
    ).not.toThrow();
  });

  it("legacy oracle path matches direct builder for bounded fixture", () => {
    const fixture = loadMeanReversionFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;

    const direct = buildReplayFusedContextClosedOnlyLegacy({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });

    let canvasState = createInitialCanvasState();
    canvasState = applyNewBarsToCanvas(canvasState, fixture.bars, 0).state;
    const gateway = buildHistoricalIngressContext({
      substrateMode: "legacy-oracle",
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      canvasState,
    });

    expect(canonicalJsonString(gateway.context)).toBe(canonicalJsonString(direct));
  });

  it("m9-provider-sidecar-v2.json fixture parses and builds bounded ingress context", () => {
    const fixture = loadMeanReversionFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    let canvasState = createInitialCanvasState();
    canvasState = applyNewBarsToCanvas(canvasState, fixture.bars, 0).state;

    const sidecarV2 = parseReplayProviderSidecar(loadSidecarV2Fixture());
    const ingress = buildHistoricalIngressContext({
      substrateMode: "legacy-oracle",
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: sidecarV2,
      canvasState,
    });

    expect(ingress.context.fearGreed?.health).toBe("HEALTHY");
    expect(ingress.context.orderBookSnapshot).toBeDefined();
    expect(canonicalJsonString(loadSidecarV2Fixture())).toBe(canonicalJsonString(sidecarV2));
  });
});
