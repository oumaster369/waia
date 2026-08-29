import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { buildHypothesisSet } from "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
import {
  CONVICTION_SUSTAINED_CYCLES,
  type MarketHypothesis,
} from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import {
  RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
  type ReconstructionSnapshot,
} from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import type { FeatureSnapshot } from "@/lib/trader/intelligence/types";

function highConvictionReconstruction(): ReconstructionSnapshot {
  const base = {
    schemaVersion: RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
    instrumentId: "BTC/USDT",
    evaluatedAt: "2026-01-01T12:00:00.000Z",
    marketStructure: {
      swingHighs: [],
      swingLows: [],
      structureBias: "BULLISH" as const,
      higherHighSequence: true,
      lowerLowSequence: false,
      priorDayHigh: "70000",
      priorDayLow: "65000",
      sessionHigh: "69500",
      sessionLow: "66000",
      breakOfStructure: true,
      changeOfCharacter: false,
    },
    liquidityStructure: {
      levels: [],
      nearestObjectiveAbove: "70000",
      nearestObjectiveBelow: "65000",
      unsweptHighCount: 2,
      unsweptLowCount: 1,
    },
    trendStructure: {
      perTimeframeBias: { "1h": "BULLISH" as const, "4h": "BULLISH" as const },
      mtfAlignment: "ALIGNED" as const,
      regimeBias: "TREND" as const,
    },
    volatilityStructure: {
      atrUsdt: "500",
      atrPeriod: 14,
      volatilityRegime: "EXPANSION" as const,
      expansionRatio: "1.3",
    },
    participationStructure: {
      relativeVolume: "2.0",
      volumeAnomaly: true,
      effortVsResult: "IMPULSE" as const,
    },
    contextStructure: {
      sessionPhase: "US",
      fearGreedIndex: 55,
      crossVenueAgreement: "AGREE",
      contextOnly: true as const,
    },
    contentDigest: "fixture-digest",
  };
  return base;
}

function highQualityFeatures(): FeatureSnapshot {
  return {
    featureSetId: "feature-high",
    instrumentId: "BTC/USDT",
    evaluatedAt: "2026-01-01T12:00:00.000Z",
    features: {
      close: "68000",
      sma20: "67000",
      zscoreVsSma20: "1.5",
      priceDispersion20: "300",
      spreadBps: "1.0",
    },
    dataQualityScore: 0.9,
    inputs: { barCount: 100 },
  };
}

describe("trader MI core conviction authorization (PR-2)", () => {
  it("fails closed without canonical Knowledge authority despite sustained heuristic conviction", () => {
    const reconstruction = highConvictionReconstruction();
    let sessionState = createEmptyHypothesisSessionState();
    let opportunity;

    for (let i = 0; i < CONVICTION_SUSTAINED_CYCLES; i++) {
      const result = buildHypothesisSet({
        reconstruction,
        evaluatedAt: reconstruction.evaluatedAt,
        sessionState,
      });
      sessionState = result.sessionState;
      opportunity = result.hypothesisSet.opportunity;
    }

    expect(opportunity).toBeNull();

    const msv = buildMsvEnvelope({
      features: highQualityFeatures(),
      opportunity: opportunity ?? undefined,
      miCoreEnabled: true,
      newId: () => "msv-conviction",
    });

    expect(msv.derived.opportunityAuthorized).not.toBe(true);
  });

  it("all 8 hypothesis types are independently constructible", () => {
    const reconstruction = highConvictionReconstruction();
    const { hypothesisSet } = buildHypothesisSet({
      reconstruction,
      evaluatedAt: reconstruction.evaluatedAt,
      sessionState: createEmptyHypothesisSessionState(),
    });

    const types = new Set(hypothesisSet.hypotheses.map((h: MarketHypothesis) => h.hypothesisType));
    expect(types.size).toBe(8);
  });
});
