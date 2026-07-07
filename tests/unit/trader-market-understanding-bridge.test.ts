import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import {
  buildMarketUnderstandingBridge,
  buildResearchSignals,
} from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import {
  CANONICAL_MARKET_QUESTION_IDS,
  MARKET_UNDERSTANDING_SCHEMA_VERSION,
  type MarketUnderstandingSnapshot,
} from "@/lib/trader/intelligence/market-understanding.types";
import { cdeReasonCodes } from "@/lib/trader/intelligence/types";
import { buildCrossVenueTriangulation } from "@/lib/trader/market-data/fusion/cross-venue-triangulation";
import { fuseContextV0 } from "@/lib/trader/market-data/fusion/context-fusion-v0";
import {
  buildProvenanceRef,
  normalizeCrossExchangeConfirmation,
  normalizeFearGreedObservation,
  normalizeOhlcvBarsObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";
import { MTF_BAR_INTERVALS } from "@/lib/trader/market-data/observation-types";

function loadFixtureBars() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    bars: import("@/lib/trader/intelligence/types").Bar[];
    latestQuote: import("@/lib/trader/intelligence/types").Quote;
  };
}

describe("PR2.6 market understanding bridge", () => {
  it("produces deterministic snapshots for identical inputs", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });

    const first = buildMarketUnderstandingBridge({ fusedContext, features });
    const second = buildMarketUnderstandingBridge({ fusedContext, features });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.schemaVersion).toBe("waia.trader.market_understanding.v0");
  });

  it("evaluates all 11 canonical questions", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });

    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    expect(understanding.questionEvaluations).toHaveLength(11);
    expect(understanding.questionEvaluations.map((q) => q.questionId).sort()).toEqual(
      [...CANONICAL_MARKET_QUESTION_IDS].sort(),
    );
  });

  it("emits knowledge gaps when evidence incomplete", () => {
    const evaluatedAt = "2026-01-01T14:00:00.000Z";
    const fixture = loadFixtureBars();
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

    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    expect(understanding.knowledgeGaps.length).toBeGreaterThan(0);
    expect(understanding.confidenceAttribution.contributors.length).toBeGreaterThan(0);
    expect(understanding.reasoningInputs.unknowns.length).toBeGreaterThanOrEqual(0);
  });

  it("downgrades CDE permission on cross-venue conflict", () => {
    const evaluatedAt = "2026-01-01T14:00:00.000Z";
    const fixture = loadFixtureBars();
    const mtfBars: Partial<
      Record<
        import("@/lib/trader/intelligence/types").BarInterval,
        ReturnType<typeof normalizeOhlcvBarsObservation>[]
      >
    > = {};

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
    });

    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const msv = buildMsvEnvelope({ features, fusedContext, understanding });

    expect(understanding.spotPosture).not.toBe("TRADE");
    expect(msv.derived.tradingPermission).not.toBe("ALLOW_TRADING");
    expect(msv.derived.reasonCodes).toContain(cdeReasonCodes.understandingCrossVenueConflict);
    expect(msv.understanding?.spotPosture).toBe(understanding.spotPosture);
  });

  it("exports research signals from understanding", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const signals = buildResearchSignals(understanding);
    expect(Array.isArray(signals.unansweredQuestions)).toBe(true);
    expect(Array.isArray(signals.conflicts)).toBe(true);
    expect(Array.isArray(signals.anomalies)).toBe(true);
  });
});

function minimalUnderstanding(
  overrides: Partial<MarketUnderstandingSnapshot>,
): MarketUnderstandingSnapshot {
  return {
    schemaVersion: MARKET_UNDERSTANDING_SCHEMA_VERSION,
    instrumentId: "BTC/USDT",
    evaluatedAt: "2026-01-01T00:25:00.000Z",
    questionEvaluations: [],
    knowledgeGaps: [],
    confidenceAttribution: {
      priorConfidence: 0.8,
      finalConfidence: 0.8,
      confidenceDelta: 0,
      contributors: [],
    },
    reasoningInputs: {
      evidenceUsed: [],
      evidenceIgnored: [],
      conflicts: [],
      unknowns: [],
    },
    mtfBackdrop: {},
    mtfAlignment: "ALIGNED",
    regimeHint: "TRENDING",
    crossVenue: {
      agreement: "AGREE",
      binanceDeltaBps: 0,
      bybitDeltaBps: 0,
      triangulationConfidence: 0.9,
      reasonCodes: [],
    },
    globalContext: "NEUTRAL",
    crowdPsychology: "NEUTRAL",
    liquiditySufficiency: "SUFFICIENT",
    dataQualitySufficient: true,
    dataQualityReasonCodes: [],
    asianCorridorPresent: false,
    spotPosture: "TRADE",
    postureRationale: [],
    understandingConfidence: 0.8,
    ...overrides,
  };
}

describe("PR2.6 CDE posture from understanding", () => {
  function buildMsvForPosture(understanding: MarketUnderstandingSnapshot) {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    return buildMsvEnvelope({ features, fusedContext, understanding });
  }

  it("restricts permission when regime hint is STRESSED", () => {
    const msv = buildMsvForPosture(
      minimalUnderstanding({
        regimeHint: "STRESSED",
        spotPosture: "REDUCE_RISK",
      }),
    );

    expect(msv.derived.reasonCodes).toContain(cdeReasonCodes.understandingStressed);
    expect(msv.derived.reasonCodes).toContain(cdeReasonCodes.understandingReducedRisk);
    expect(msv.derived.tradingPermission).toBe("ALLOW_REDUCED_RISK");
  });

  it("forces ONLY_CLOSE_POSITIONS when posture is PRESERVE_CAPITAL", () => {
    const msv = buildMsvForPosture(
      minimalUnderstanding({
        regimeHint: "STRESSED",
        spotPosture: "PRESERVE_CAPITAL",
        postureRationale: ["POSTURE_PRESERVE_CAPITAL"],
      }),
    );

    expect(msv.derived.reasonCodes).toContain(cdeReasonCodes.understandingPreserveCapital);
    expect(msv.derived.tradingPermission).toBe("ONLY_CLOSE_POSITIONS");
    expect(msv.derived.riskMultiplier).toBe("0.25");
  });

  it("forces PAPER_ONLY when posture is NO_TRADE", () => {
    const msv = buildMsvForPosture(
      minimalUnderstanding({
        dataQualitySufficient: false,
        spotPosture: "NO_TRADE",
        postureRationale: ["POSTURE_DATA_QUALITY_INSUFFICIENT"],
      }),
    );

    expect(msv.derived.reasonCodes).toContain(cdeReasonCodes.understandingNoTrade);
    expect(msv.derived.reasonCodes).toContain(cdeReasonCodes.understandingDataInsufficient);
    expect(msv.derived.tradingPermission).toBe("PAPER_ONLY");
    expect(msv.derived.riskMultiplier).toBe("0.25");
  });
});
