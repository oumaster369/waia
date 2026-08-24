import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateCanonicalMarketQuestions } from "@/lib/trader/intelligence/evaluate-canonical-market-questions";
import { CANONICAL_MARKET_QUESTION_IDS } from "@/lib/trader/intelligence/market-understanding.types";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";
import {
  OBSERVATION_SCHEMA_VERSION,
  type FusedMarketContext,
  type NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
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

function evaluateQuestions(overrides: Partial<FusedMarketContext> = {}) {
  const fixture = loadFixtureBars();
  const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
  const baseContext = buildReplayFusedContext({
    bars: fixture.bars,
    quote: fixture.latestQuote,
    evaluatedAt,
    instrumentId: "BTC/USDT",
  });
  const fusedContext = { ...baseContext, ...overrides };
  const features = computeFeatureSnapshot({
    bars: fixture.bars,
    quote: fixture.latestQuote,
    evaluatedAt,
  });
  const mtfBackdrop = classifyMtfBackdropFromObservations(fusedContext.mtfBars);
  const mtfAlignment = classifyMtfAlignment(mtfBackdrop);

  return evaluateCanonicalMarketQuestions({
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
}

describe("PR2.6 canonical market question evaluation", () => {
  it("covers all canonical question IDs", () => {
    const evaluations = evaluateQuestions();

    expect(evaluations).toHaveLength(CANONICAL_MARKET_QUESTION_IDS.length);
    for (const questionId of CANONICAL_MARKET_QUESTION_IDS) {
      const evaluation = evaluations.find((entry) => entry.questionId === questionId);
      expect(evaluation, `missing ${questionId}`).toBeDefined();
      expect(evaluation!.answerSummary.length).toBeGreaterThan(0);
      expect(evaluation!.confidence).toBeGreaterThanOrEqual(0);
      expect(evaluation!.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("does not answer causal WHY from price and MTF state alone", () => {
    const why = evaluateQuestions().find((entry) => entry.questionId === "Q_WHY_HAPPENING");
    expect(why).toEqual({
      questionId: "Q_WHY_HAPPENING",
      status: "UNKNOWN",
      answerSummary: "causal_evidence_not_established",
      confidence: 0,
      evidenceProvenanceIds: [],
      influencesPermission: false,
      influencesPosture: true,
    });
  });

  it("admits causal WHY evidence only when an available causal observation is present", () => {
    const causalNews: NormalizedObservation = {
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      kind: "news_headline",
      sessionPhase: "US",
      provenance: {
        providerId: "coindesk_rss",
        venue: "coindesk",
        feedKind: "news_headline",
        symbol: "GLOBAL",
        eventTimeUtc: "2026-08-23T10:00:00.000Z",
        ingestTimeUtc: "2026-08-23T10:00:01.000Z",
      },
      health: "HEALTHY",
      freshnessMs: 1_000,
      latencyMs: 10,
      confidence: 0.8,
      payload: {
        headline: "Protocol activity update",
        url: "https://example.invalid/causal-evidence",
        source: "CoinDesk",
        publishedAt: "2026-08-23T10:00:00.000Z",
      },
    };
    const why = evaluateQuestions({
      newsEvidence: [causalNews],
      provenance: [causalNews.provenance],
    }).find((entry) => entry.questionId === "Q_WHY_HAPPENING");

    expect(why).toMatchObject({
      status: "PARTIAL",
      answerSummary: expect.stringContaining("news_1"),
      evidenceProvenanceIds: ["coindesk_rss:news_headline:2026-08-23T10:00:00.000Z"],
    });

    const staleWhy = evaluateQuestions({
      newsEvidence: [{ ...causalNews, health: "STALE" }],
      provenance: [causalNews.provenance],
    }).find((entry) => entry.questionId === "Q_WHY_HAPPENING");
    expect(staleWhy).toMatchObject({
      status: "UNKNOWN",
      answerSummary: "causal_evidence_not_established",
      evidenceProvenanceIds: [],
    });
  });

  it("preserves bounded NOT_REQUIRED, NOT_APPLICABLE, and unresolved-unknown semantics", () => {
    const evaluations = evaluateQuestions();
    expect(evaluations.find((entry) => entry.questionId === "Q_UNKNOWN")).toMatchObject({
      status: "UNKNOWN",
      answerSummary: "unknowns_not_established",
    });
    expect(
      evaluations.find((entry) => entry.questionId === "Q_HISTORICAL_ANALOGUES"),
    ).toMatchObject({
      status: "NOT_REQUIRED",
      answerSummary: "requires_profile_declared_non_holdout_analogue_evidence",
    });
    for (const questionId of ["Q_DEPLOY_CAPITAL", "Q_PRESERVE_CAPITAL"] as const) {
      expect(evaluations.find((entry) => entry.questionId === questionId)).toMatchObject({
        status: "NOT_APPLICABLE",
        answerSummary: "outside_market_understanding_authority",
        influencesPermission: false,
      });
    }
  });
});
