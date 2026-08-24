import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildMarketUnderstandingBridge } from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import { CANONICAL_MARKET_QUESTION_IDS } from "@/lib/trader/intelligence/market-understanding.types";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import { buildCrossVenueTriangulation } from "@/lib/trader/market-data/fusion/cross-venue-triangulation";
import { fuseContextV0 } from "@/lib/trader/market-data/fusion/context-fusion-v0";
import {
  buildProvenanceRef,
  normalizeCrossExchangeConfirmation,
  normalizeFearGreedObservation,
  normalizeGlobalMarketObservation,
  normalizeOhlcvBarsObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import { MTF_BAR_INTERVALS } from "@/lib/trader/market-data/observation-types";
import {
  buildReplayFusedContext,
  type ReplayProviderSidecar,
} from "@/lib/trader/market-data/replay-fused-context-builder";

const FIXTURE_DIR = path.join(process.cwd(), "tests/fixtures/trader");

type BarFixture = {
  bars: Bar[];
  latestQuote: Quote;
};

function loadBarFixture(): BarFixture {
  const filePath = path.join(FIXTURE_DIR, "btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as BarFixture;
}

function loadSidecar(): ReplayProviderSidecar {
  const filePath = path.join(FIXTURE_DIR, "m9-provider-sidecar.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as ReplayProviderSidecar;
}

function buildAlignedTrendUnderstanding() {
  const fixture = loadBarFixture();
  const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
  const fusedContext = buildReplayFusedContext({
    bars: fixture.bars,
    quote: fixture.latestQuote,
    evaluatedAt,
    instrumentId: "BTC/USDT",
    providerSidecar: loadSidecar(),
  });
  const features = computeFeatureSnapshot({
    bars: fixture.bars,
    quote: fixture.latestQuote,
    evaluatedAt,
  });
  return buildMarketUnderstandingBridge({ fusedContext, features });
}

function buildCrossVenueConflictUnderstanding() {
  const fixture = loadBarFixture();
  const evaluatedAt = "2026-01-01T14:00:00.000Z";
  const mtfBars: Parameters<typeof fuseContextV0>[0]["mtfBars"] = {};

  for (const interval of MTF_BAR_INTERVALS) {
    mtfBars[interval] = [
      normalizeOhlcvBarsObservation({
        bars: fixture.bars.map((bar) => ({ ...bar, interval })),
        provenance: buildProvenanceRef({
          providerId: "htx_spot",
          venue: "htx",
          feedKind: "ohlcv_bar",
          symbol: "BTC/USDT",
          eventTimeUtc: evaluatedAt,
        }),
        latencyMs: 1,
        evaluatedAt,
      }),
    ];
  }

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
    mtfBars,
    crossExchangeConfirmation: binance,
    crossVenueTriangulation: buildCrossVenueTriangulation({ binance, bybit }),
    fearGreed: normalizeFearGreedObservation({
      value: 85,
      classification: "Extreme Greed",
      provenance: buildProvenanceRef({
        providerId: "alternative_me",
        venue: "alternative_me",
        feedKind: "fear_greed_index",
        symbol: "GLOBAL",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 1,
      evaluatedAt,
      eventTimeUtc: evaluatedAt,
    }),
    globalMarket: normalizeGlobalMarketObservation({
      btcDominance: 60,
      marketCapUsd: 1_000_000_000_000,
      provenance: buildProvenanceRef({
        providerId: "coingecko_global",
        venue: "coingecko",
        feedKind: "global_market_stats",
        symbol: "GLOBAL",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 1,
      evaluatedAt,
      eventTimeUtc: evaluatedAt,
    }),
  });

  const features = computeFeatureSnapshot({
    bars: fixture.bars,
    quote: fixture.latestQuote,
    evaluatedAt,
  });

  return buildMarketUnderstandingBridge({ fusedContext, features });
}

function buildGapsConflictUnderstanding() {
  const fixture = loadBarFixture();
  const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
  const fusedContext = fuseContextV0({
    instrumentId: "BTC/USDT",
    fusedAtUtc: evaluatedAt,
    mtfBars: {},
    crossVenueTriangulation: buildCrossVenueTriangulation({}),
    degradationReasons: ["cross_exchange_unavailable"],
  });
  const features = computeFeatureSnapshot({
    bars: fixture.bars,
    quote: fixture.latestQuote,
    evaluatedAt,
  });
  return buildMarketUnderstandingBridge({ fusedContext, features });
}

const GOLDEN_CASES = [
  {
    name: "aligned-trend",
    file: "market-understanding-aligned-trend.json",
    build: buildAlignedTrendUnderstanding,
  },
  {
    name: "cross-venue-conflict",
    file: "market-understanding-cross-venue-conflict.json",
    build: buildCrossVenueConflictUnderstanding,
  },
  {
    name: "gaps-conflict",
    file: "market-understanding-gaps-conflict.json",
    build: buildGapsConflictUnderstanding,
  },
] as const;

if (process.env.UPDATE_MARKET_UNDERSTANDING_GOLDEN === "1") {
  for (const testCase of GOLDEN_CASES) {
    const snapshot = testCase.build();
    writeFileSync(
      path.join(FIXTURE_DIR, testCase.file),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
  }
}

describe("PR2.6 golden market understanding fixtures", () => {
  for (const testCase of GOLDEN_CASES) {
    it(`matches golden snapshot for ${testCase.name}`, () => {
      const fixturePath = path.join(FIXTURE_DIR, testCase.file);
      expect(existsSync(fixturePath)).toBe(true);

      const golden = JSON.parse(readFileSync(fixturePath, "utf8"));
      const actual = testCase.build();

      expect(actual).toEqual(golden);
      expect(actual.questionEvaluations).toHaveLength(12);
      expect(
        actual.questionEvaluations.map((q: { questionId: string }) => q.questionId).sort(),
      ).toEqual([...CANONICAL_MARKET_QUESTION_IDS].sort());
    });
  }

  it("produces byte-stable JSON for identical replay inputs", () => {
    const first = JSON.stringify(buildAlignedTrendUnderstanding());
    const second = JSON.stringify(buildAlignedTrendUnderstanding());
    expect(first).toBe(second);
  });
});
