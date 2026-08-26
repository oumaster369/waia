import { describe, expect, it } from "vitest";

import {
  MKB_KNOWLEDGE_STATES,
  MKB_STALE_AFTER_MS,
  assertNoCapitalAuthority,
  classifyForecastKnowledgeState,
  classifyKnowledgeEdgeState,
  classifyLegacyPredictionKnowledgeState,
  classifyMarketEventState,
  classifyNoTradeObservationState,
  classifyOutcomeVerdict,
  isForecastDecisionChainComplete,
  isVerifiedKnowledgeState,
  MkbCapitalAuthorityError,
} from "@/lib/trader/knowledge/mkb-knowledge-state";
import type {
  TraderIntelligenceDecisionRecord,
  TraderIntelligenceForecastRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { KnowledgeEdge, MarketPrediction } from "@/lib/trader/knowledge/knowledge.types";

function baseForecast(
  overrides: Partial<TraderIntelligenceForecastRecord> = {},
): TraderIntelligenceForecastRecord {
  return {
    id: "forecast-1",
    organizationId: "org-1",
    cycleEnvelopeId: "env-1",
    hypothesisRecordId: "hyp-1",
    convictionRecordId: "conv-1",
    runId: "run-1",
    cycleId: "0",
    symbol: "BTC/USDT",
    forecastKeyDigest: "f".repeat(64),
    evaluatedAt: "2024-01-01T00:00:00.000Z",
    issuedAt: "2024-01-01T00:00:00.000Z",
    evidenceCutoffAt: "2024-01-01T00:00:00.000Z",
    targetWindowStartAt: "2024-01-01T01:00:00.000Z",
    targetWindowEndAt: "2024-01-01T02:00:00.000Z",
    marketQuestion: "q",
    invalidationConditionsJson: "[]",
    scenarioSetJson: "[]",
    forecastConfidenceJson: "{}",
    historicalProfileId: "profile",
    historicalProfileDigest: "a".repeat(64),
    matrixDigest: "b".repeat(64),
    evidenceDigest: "c".repeat(64),
    authoritativeLinkDigest: "d".repeat(64),
    forecastModelVersion: "v1",
    contentDigest: "e".repeat(64),
    schemaVersion: "waia.trader.intelligence_forecast_record.v1",
    ...overrides,
  };
}

function baseDecision(
  overrides: Partial<TraderIntelligenceDecisionRecord> = {},
): TraderIntelligenceDecisionRecord {
  return {
    id: "decision-1",
    organizationId: "org-1",
    cycleEnvelopeId: "env-1",
    convictionRecordId: "conv-1",
    runId: "run-1",
    cycleId: "0",
    symbol: "BTC/USDT",
    evaluatedAt: "2024-01-01T00:00:00.000Z",
    issuedAt: "2024-01-01T00:00:00.000Z",
    decisionClass: "NO_TRADE",
    universalTerminalReasonCode: "NO_TRADE",
    whyNotCashJson: null,
    whyCashOrAbstainJson: "{}",
    grossExpectedReward: null,
    expectedFees: null,
    expectedSlippage: null,
    expectedOtherCosts: null,
    expectedRewardAfterCosts: null,
    costModelId: null,
    costModelVersion: null,
    costEvidenceState: "NOT_APPLICABLE",
    cdeMsvPermissionSnapshotJson: "{}",
    reasonCodesJson: "[]",
    strategyId: null,
    strategyVersion: null,
    contentDigest: "f".repeat(64),
    schemaVersion: "waia.trader.intelligence_decision_record.v1",
    ...overrides,
  };
}

describe("trader wp15 knowledge state", () => {
  it("exports all sanctioned knowledge states", () => {
    expect(MKB_KNOWLEDGE_STATES).toEqual([
      "OBSERVATION_ONLY",
      "UNRESOLVED",
      "RESOLVED_CORRECT",
      "RESOLVED_INCORRECT",
      "INSUFFICIENT_EVIDENCE",
      "STALE",
      "INELIGIBLE",
    ]);
  });

  it("classifies outcome verdicts", () => {
    expect(classifyOutcomeVerdict("CORRECT")).toBe("RESOLVED_CORRECT");
    expect(classifyOutcomeVerdict("INCORRECT")).toBe("RESOLVED_INCORRECT");
    expect(classifyOutcomeVerdict("INSUFFICIENT")).toBe("INSUFFICIENT_EVIDENCE");
    expect(classifyOutcomeVerdict(undefined)).toBe("UNRESOLVED");
  });

  it("marks incomplete chains ineligible", () => {
    expect(
      isForecastDecisionChainComplete({
        envelope: null,
        decision: baseDecision(),
        links: [],
        entryPurpose: null,
      }),
    ).toBe(false);
  });

  it("classifies legacy unverified predictions as observation-only", () => {
    const prediction: MarketPrediction = {
      id: "pred-1",
      organizationId: "org-1",
      subjectRef: "legacy:subject",
      predictionJson: "{}",
      predictedAt: new Date(Date.UTC(2024, 0, 1)),
      outcomeJson: null,
      verifiedAt: null,
      verificationResult: null,
      contentDigest: "a".repeat(64),
      createdAt: new Date(Date.UTC(2024, 0, 1)),
    };

    expect(classifyLegacyPredictionKnowledgeState(prediction, WP15_AS_OF)).toBe("OBSERVATION_ONLY");
  });

  it("classifies verified edges as resolved correct", () => {
    const edge: KnowledgeEdge = {
      id: "edge-1",
      organizationId: "org-1",
      fromRef: "a",
      toRef: "b",
      relationKind: "pattern_associated_with_close",
      confidence: "0.8",
      strength: "0.7",
      regimeScope: "global",
      failureCasesJson: "[]",
      hypothesisId: null,
      verified: true,
      createdAt: new Date(Date.UTC(2024, 0, 1)),
      updatedAt: new Date(Date.UTC(2024, 0, 1)),
    };

    expect(classifyKnowledgeEdgeState(edge, WP15_AS_OF)).toBe("RESOLVED_CORRECT");
  });

  it("classifies market events as observation-only", () => {
    expect(classifyMarketEventState(new Date(Date.UTC(2024, 0, 1)), WP15_AS_OF)).toBe(
      "OBSERVATION_ONLY",
    );
  });

  it("classifies complete no-trade observations as observation-only", () => {
    const decision = baseDecision({ decisionClass: "NO_TRADE" });
    expect(
      classifyNoTradeObservationState({
        envelope: {
          id: "env-1",
          organizationId: "org-1",
          runId: "run-1",
          cycleId: "0",
          symbol: "BTC/USDT",
          evaluatedAt: "2024-01-01T00:00:00.000Z",
          historicalProfileId: "profile",
          historicalProfileDigest: "a".repeat(64),
          matrixDigest: "b".repeat(64),
          terminalReasonCode: "NO_TRADE",
          inputCausalBundleJson: null,
          inputSemanticDigest: "c".repeat(64),
          outputSemanticDigest: "d".repeat(64),
          contentDigest: "e".repeat(64),
          schemaVersion: "waia.trader.intelligence_cycle_envelope.v1",
        },
        decision,
        links: [],
        entryPurpose: null,
      }),
    ).toBe("OBSERVATION_ONLY");
  });

  it("marks stale unresolved forecasts using explicit asOf", () => {
    const forecast = baseForecast({
      targetWindowEndAt: "2023-01-01T00:00:00.000Z",
    });
    const asOf = new Date(Date.parse("2023-01-01T00:00:00.000Z") + MKB_STALE_AFTER_MS + 1_000);

    expect(
      classifyForecastKnowledgeState({
        forecast,
        decision: baseDecision(),
        envelope: {
          id: "env-1",
          organizationId: "org-1",
          runId: "run-1",
          cycleId: "0",
          symbol: "BTC/USDT",
          evaluatedAt: "2024-01-01T00:00:00.000Z",
          historicalProfileId: "profile",
          historicalProfileDigest: "a".repeat(64),
          matrixDigest: "b".repeat(64),
          terminalReasonCode: "NO_TRADE",
          inputCausalBundleJson: null,
          inputSemanticDigest: "c".repeat(64),
          outputSemanticDigest: "d".repeat(64),
          contentDigest: "e".repeat(64),
          schemaVersion: "waia.trader.intelligence_cycle_envelope.v1",
        },
        links: [],
        entryPurpose: null,
        asOf,
      }),
    ).toBe("STALE");
  });

  it("assertNoCapitalAuthority rejects prohibited fields", () => {
    expect(() => assertNoCapitalAuthority({ metadata: { capitalAllocation: "1.0" } })).toThrow(
      MkbCapitalAuthorityError,
    );
  });

  it("identifies verified knowledge state", () => {
    expect(isVerifiedKnowledgeState("RESOLVED_CORRECT")).toBe(true);
    expect(isVerifiedKnowledgeState("UNRESOLVED")).toBe(false);
  });
});

const WP15_AS_OF = new Date(Date.UTC(2024, 0, 2, 0, 0, 0));
