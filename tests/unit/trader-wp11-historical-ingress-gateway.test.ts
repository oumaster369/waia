/**
 * HTR-WP11 — historical ingress gateway enforcement.
 */
import { describe, expect, it } from "vitest";

import {
  applyNewBarsToCanvas,
  createInitialCanvasState,
} from "@/lib/trader/backtest/canvas-replay-integration";
import {
  assertNoNetworkImport,
  buildHistoricalIngressContext,
  HTR_WP11_FUTURE_EVIDENCE_REACHABLE,
  HTR_WP11_INGRESS_BYPASS,
} from "@/lib/trader/market-data/replay/historical-ingress-gateway";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import {
  loadMeanReversionFixture,
  loadSidecarV1Fixture,
} from "@/tests/unit/helpers/wp11-wp12-fixture";

describe("HTR-WP11 historical ingress gateway", () => {
  it("assertNoNetworkImport passes without forbidden live-provider imports", () => {
    expect(() => assertNoNetworkImport()).not.toThrow();
  });

  it("buildHistoricalIngressContext returns deterministic fused context", () => {
    const fixture = loadMeanReversionFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    let canvasState = createInitialCanvasState();
    canvasState = applyNewBarsToCanvas(canvasState, fixture.bars, 0).state;

    const first = buildHistoricalIngressContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: loadSidecarV1Fixture(),
      canvasState,
    });
    const second = buildHistoricalIngressContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: loadSidecarV1Fixture(),
      canvasState,
    });

    expect(canonicalJsonString(first.context)).toBe(canonicalJsonString(second.context));
    expect(first.context.instrumentId).toBe("BTC/USDT");
    expect(first.context.fearGreed).toBeDefined();
    expect(first.degradationReasons).toEqual(second.degradationReasons);
  });

  it("parity-both substrate rejects canvas/oracle divergence", () => {
    const fixture = loadMeanReversionFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    let canvasState = createInitialCanvasState();
    canvasState = applyNewBarsToCanvas(canvasState, fixture.bars.slice(0, 10), 0).state;

    expect(() =>
      buildHistoricalIngressContext({
        substrateMode: "parity-both",
        bars: fixture.bars,
        quote: fixture.latestQuote,
        evaluatedAt,
        instrumentId: "BTC/USDT",
        canvasState,
      }),
    ).toThrow(HTR_WP11_INGRESS_BYPASS);
  });

  it("rejects future evidence reachable on primary quote timestamp", () => {
    const fixture = loadMeanReversionFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    let canvasState = createInitialCanvasState();
    canvasState = applyNewBarsToCanvas(canvasState, fixture.bars, 0).state;

    expect(() =>
      buildHistoricalIngressContext({
        bars: fixture.bars,
        quote: {
          ...fixture.latestQuote,
          timestamp: "2026-01-01T01:00:00.000Z",
        },
        evaluatedAt,
        instrumentId: "BTC/USDT",
        canvasState,
      }),
    ).toThrow(HTR_WP11_FUTURE_EVIDENCE_REACHABLE);
  });
});
