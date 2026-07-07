import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateCanonicalMarketQuestions } from "@/lib/trader/intelligence/evaluate-canonical-market-questions";
import { CANONICAL_MARKET_QUESTION_IDS } from "@/lib/trader/intelligence/market-understanding.types";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";
import {
  classifyMtfAlignment,
  classifyMtfBackdropFromObservations,
} from "@/lib/trader/market-data/mtf/mtf-backdrop-classifier";

function loadFixtureBars() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    bars: import("@/lib/trader/intelligence/types").Bar[];
    latestQuote: import("@/lib/trader/intelligence/types").Quote;
  };
}

describe("PR2.6 canonical market question evaluation", () => {
  it("covers all canonical question IDs", () => {
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
    const mtfBackdrop = classifyMtfBackdropFromObservations(fusedContext.mtfBars);
    const mtfAlignment = classifyMtfAlignment(mtfBackdrop);

    const evaluations = evaluateCanonicalMarketQuestions({
      fusedContext,
      features,
      mtfBackdrop,
      mtfAlignment,
      regimeHint: "RANGING",
      crossVenueAgreement: fusedContext.crossVenueTriangulation?.agreement ?? "UNAVAILABLE",
      crossVenueConfidence: fusedContext.crossVenueTriangulation?.triangulationConfidence ?? 0,
      crowd: "NEUTRAL",
      liquidity: "SUFFICIENT",
      globalContext: "NEUTRAL",
      dataQualitySufficient: true,
      dataQualityReasonCodes: [],
      knowledgeGapDescriptions: [],
    });

    expect(evaluations).toHaveLength(CANONICAL_MARKET_QUESTION_IDS.length);
    for (const questionId of CANONICAL_MARKET_QUESTION_IDS) {
      const evaluation = evaluations.find((entry) => entry.questionId === questionId);
      expect(evaluation, `missing ${questionId}`).toBeDefined();
      expect(evaluation!.answerSummary.length).toBeGreaterThan(0);
      expect(evaluation!.confidence).toBeGreaterThanOrEqual(0);
      expect(evaluation!.confidence).toBeLessThanOrEqual(1);
    }
  });
});
