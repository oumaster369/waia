/**
 * HTR-WP11 — explicit absent-lane representation (all 15 lanes).
 */
import { describe, expect, it } from "vitest";

import {
  applyNewBarsToCanvas,
  createInitialCanvasState,
} from "@/lib/trader/backtest/canvas-replay-integration";
import { buildHistoricalIngressContext } from "@/lib/trader/market-data/replay/historical-ingress-gateway";
import { REPLAY_PROVIDER_SIDECAR_LANE_KEYS } from "@/lib/trader/market-data/replay/provider-sidecar-types";
import {
  ensureExplicitAbsentLanes,
  SIDECAR_LANE_ABSENT,
} from "@/lib/trader/market-data/replay/replay-lane-normalizer";
import { loadMeanReversionFixture } from "@/tests/unit/helpers/wp11-wp12-fixture";

const ARRAY_LANE_KINDS = [
  "macro_series",
  "macro_calendar_event",
  "macro_probability",
  "news_headline",
  "news_event_cluster",
  "exchange_announcement",
  "protocol_release",
  "blockchain_network_stats",
  "regulatory_filing",
  "mempool_stats",
] as const;

describe("HTR-WP11 absent lanes", () => {
  it("ensureExplicitAbsentLanes materializes all 15 provider lanes", () => {
    const evaluatedAt = "2026-01-01T00:25:00.000Z";
    const degradationReasons: string[] = [];
    const bundle = ensureExplicitAbsentLanes({
      bundle: {},
      instrumentId: "BTC/USDT",
      evaluatedAt,
      degradationReasons,
    });

    expect(bundle.fearGreed).toBeDefined();
    expect(bundle.globalMarket).toBeDefined();
    expect(bundle.orderBookSnapshot).toBeDefined();
    expect(bundle.marketTradesSnapshot).toBeDefined();
    expect(bundle.crossExchangeConfirmation).toBeDefined();

    for (const kind of ARRAY_LANE_KINDS) {
      const target =
        kind === "macro_series" || kind === "macro_calendar_event" || kind === "macro_probability"
          ? bundle.macroEvidence
          : kind === "news_headline" ||
              kind === "news_event_cluster" ||
              kind === "exchange_announcement"
            ? bundle.newsEvidence
            : kind === "blockchain_network_stats" || kind === "mempool_stats"
              ? bundle.blockchainEvidence
              : kind === "regulatory_filing"
                ? bundle.regulatoryEvidence
                : bundle.protocolEvidence;

      const observation = target.find((entry) => entry.kind === kind);
      expect(observation, `${kind} absent placeholder`).toBeDefined();
      expect(observation?.payload.reason).toBe(SIDECAR_LANE_ABSENT);
    }

    expect(REPLAY_PROVIDER_SIDECAR_LANE_KEYS).toHaveLength(15);
    expect(degradationReasons.some((reason) => reason.includes(SIDECAR_LANE_ABSENT))).toBe(true);
  });

  it("buildHistoricalIngressContext never leaves sidecar lanes undefined without sidecar", () => {
    const fixture = loadMeanReversionFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    let canvasState = createInitialCanvasState();
    canvasState = applyNewBarsToCanvas(canvasState, fixture.bars, 0).state;

    const { context } = buildHistoricalIngressContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      canvasState,
    });

    expect(context.fearGreed).toBeDefined();
    expect(context.globalMarket).toBeDefined();
    expect(context.orderBookSnapshot).toBeDefined();
    expect(context.marketTradesSnapshot).toBeDefined();
    expect(context.crossExchangeConfirmation).toBeDefined();
    expect(context.macroEvidence?.length).toBeGreaterThan(0);
    expect(context.newsEvidence?.length).toBeGreaterThan(0);
    expect(context.blockchainEvidence?.length).toBeGreaterThan(0);
    expect(context.regulatoryEvidence?.length).toBeGreaterThan(0);
    expect(context.protocolEvidence?.length).toBeGreaterThan(0);

    for (const lane of [
      context.fearGreed,
      context.globalMarket,
      context.orderBookSnapshot,
      context.marketTradesSnapshot,
      context.crossExchangeConfirmation,
      ...(context.macroEvidence ?? []),
      ...(context.newsEvidence ?? []),
      ...(context.blockchainEvidence ?? []),
      ...(context.regulatoryEvidence ?? []),
      ...(context.protocolEvidence ?? []),
    ]) {
      expect(lane).toBeDefined();
      expect(lane?.health).toBe("UNAVAILABLE");
      expect(lane?.payload.reason).toBe(SIDECAR_LANE_ABSENT);
    }
  });
});
