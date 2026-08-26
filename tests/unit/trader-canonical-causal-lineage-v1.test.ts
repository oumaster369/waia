import { describe, expect, it } from "vitest";

import { buildForecastRecords } from "@/lib/trader/intelligence/forecast-decision/build-forecast-records";
import { buildHypothesisSet } from "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
import { buildRuntimeKnowledgeAuthorityV1 } from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import {
  createEmptyHypothesisSessionState,
  DECISION_CHAIN_SCHEMA_VERSION,
  MARKET_STATE_SNAPSHOT_SCHEMA_VERSION,
  type DecisionChain,
  type MarketStateSnapshot,
} from "@/lib/trader/intelligence/mi-core.types";
import {
  RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
  type ReconstructionSnapshot,
} from "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import { buildIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records-service";
import { admitResearchForecastDecisionConstruction } from "./forecast-decision-construction-test-helper";

const PIT = "2026-01-01T12:00:00.000Z";

function reconstruction(): ReconstructionSnapshot {
  return {
    schemaVersion: RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
    instrumentId: "BTC/USDT",
    evaluatedAt: PIT,
    marketStructure: { swingHighs: [], swingLows: [], structureBias: "BULLISH", higherHighSequence: true, lowerLowSequence: false, priorDayHigh: null, priorDayLow: null, sessionHigh: null, sessionLow: null, breakOfStructure: true, changeOfCharacter: false },
    liquidityStructure: { levels: [], nearestObjectiveAbove: null, nearestObjectiveBelow: null, unsweptHighCount: 0, unsweptLowCount: 0 },
    trendStructure: { perTimeframeBias: {}, mtfAlignment: "ALIGNED", regimeBias: "TREND" },
    volatilityStructure: { atrUsdt: null, atrPeriod: 14, volatilityRegime: "NORMAL", expansionRatio: null },
    participationStructure: { relativeVolume: null, volumeAnomaly: false, effortVsResult: "NEUTRAL" },
    contextStructure: { sessionPhase: "TEST", fearGreedIndex: null, crossVenueAgreement: null, contextOnly: true },
    contentDigest: "reconstruction-digest",
  };
}

function buildFixture(includeUnrelatedEvidence = false) {
  const authority = buildRuntimeKnowledgeAuthorityV1({
    organizationId: "org-1",
    symbol: "BTC/USDT",
    pitAnchor: PIT,
    knowledgeSemanticDigest: "knowledge-digest",
    hypotheses: [{
      hypothesisId: "hyp-1",
      hypothesisKey: "trend",
      definitionDigest: "definition-digest",
      createdAt: "2026-01-01T10:00:00.000Z",
      hypothesisType: "trend_continuation",
      lifecycleState: "VALIDATED",
      rankOrdinal: 0,
      ordinalJudgment: "SUPPORTED",
      expectedPath: "continuation_higher",
      invalidationConditions: ["structure_break"],
      supportingEvidence: [{ evidenceId: "ev-for", contentDigest: "digest-for", direction: "FOR", eventTime: "2026-01-01T11:00:00.000Z", ingestTime: "2026-01-01T11:01:00.000Z" }],
      contradictingEvidence: [{ evidenceId: "ev-against", contentDigest: "digest-against", direction: "AGAINST", eventTime: "2026-01-01T11:10:00.000Z", ingestTime: "2026-01-01T11:11:00.000Z" }],
      knowledgeRefs: [{ knowledgeEdgeId: "edge-1", knowledgeState: "RESOLVED_CORRECT" }],
      supersedesHypothesisIds: [],
    }, ...(includeUnrelatedEvidence ? [{
      hypothesisId: "hyp-unrelated",
      hypothesisKey: "mean-reversion",
      definitionDigest: "unrelated-definition-digest",
      createdAt: "2026-01-01T09:00:00.000Z",
      hypothesisType: "mean_reversion" as const,
      lifecycleState: "RETIRED" as const,
      rankOrdinal: 1,
      ordinalJudgment: "WEAKENED" as const,
      expectedPath: "unrelated_path",
      invalidationConditions: ["unrelated_condition"],
      supportingEvidence: [{ evidenceId: "ev-unrelated", contentDigest: "digest-unrelated", direction: "FOR" as const, eventTime: "2026-01-01T09:30:00.000Z", ingestTime: "2026-01-01T09:31:00.000Z" }],
      contradictingEvidence: [],
      knowledgeRefs: [],
      supersedesHypothesisIds: [],
    }] : [])],
  });
  const hypothesisSet = buildHypothesisSet({
    reconstruction: reconstruction(),
    evaluatedAt: PIT,
    organizationId: "org-1",
    symbol: "BTC/USDT",
    sessionState: createEmptyHypothesisSessionState(),
    canonicalRuntimeIntelligenceState: authority,
  }).hypothesisSet;
  const snapshot: MarketStateSnapshot = {
    schemaVersion: MARKET_STATE_SNAPSHOT_SCHEMA_VERSION,
    evaluatedAt: PIT,
    instrumentId: "BTC/USDT",
    reconstruction: reconstruction(),
    understanding: null,
    hypotheses: hypothesisSet,
    activeOpportunity: null,
    tradingPermission: "STOP_TRADING",
    terminalReasonCode: "NO_PREDICTIVE_ADMISSION",
    conviction: 0,
    eligibleStrategyFamilies: [],
  };
  const decisionChain: DecisionChain = {
    schemaVersion: DECISION_CHAIN_SCHEMA_VERSION,
    evaluatedAt: PIT,
    steps: ["RECONSTRUCTION", "HYPOTHESES", "FINALIZATION"],
    terminalReasonCode: "NO_PREDICTIVE_ADMISSION",
    reasonCodes: ["NO_PREDICTIVE_ADMISSION"],
    observation: { expectedPath: "continuation_higher", observedOutcome: "UNKNOWN", deviation: "UNKNOWN", invalidationStatus: "ACTIVE", terminalReasonCode: "NO_PREDICTIVE_ADMISSION" },
    reconstructionSummary: "test",
    activeHypothesisType: "trend_continuation",
    opportunityAuthorized: false,
    tradingPermission: "STOP_TRADING",
  };
  const bundle = buildIntelligenceCycleBundle({ organizationId: "org-1", runId: "run-1", cycleId: "cycle-1", symbol: "BTC/USDT", accountId: null, analyticalTimeframe: "1m", marketStateSnapshot: snapshot, decisionChain });
  return { hypothesisSet, bundle };
}

function forecastsFor(fixture: ReturnType<typeof buildFixture>) {
  return buildForecastRecords(
    { intelligenceCycleBundle: fixture.bundle, hypothesesByType: Object.fromEntries(fixture.hypothesisSet.hypotheses.map((item) => [item.hypothesisType, item])) },
    admitResearchForecastDecisionConstruction(fixture.bundle),
    fixture.bundle,
  );
}

describe("DEE-626 canonical causal lineage", () => {
  it("preserves one byte-identical lineage through Hypothesis, record and Forecast", () => {
    const fixture = buildFixture();
    const hypothesis = fixture.hypothesisSet.activeHypothesis!;
    const record = fixture.bundle.hypotheses[0]!;
    const forecast = forecastsFor(fixture)[0]!;
    expect(forecast).toBeDefined();
    expect(record.canonicalCausalLineageJson).toBe(hypothesis.canonicalCausalLineageJson);
    expect(forecast.canonicalCausalLineageJson).toBe(record.canonicalCausalLineageJson);
    expect(forecast.canonicalCausalLineageDigest).toBe(record.canonicalCausalLineageDigest);
  });

  it("fails closed to no Forecast on missing or mutated lineage", () => {
    const fixture = buildFixture();
    const active = fixture.hypothesisSet.activeHypothesis!;
    const missing = { ...fixture, hypothesisSet: { ...fixture.hypothesisSet, hypotheses: [{ ...active, canonicalCausalLineageJson: null, canonicalCausalLineageDigest: null }], activeHypothesis: { ...active, canonicalCausalLineageJson: null, canonicalCausalLineageDigest: null } } };
    expect(forecastsFor(missing)).toEqual([]);
    const mutated = { ...fixture, hypothesisSet: { ...fixture.hypothesisSet, hypotheses: [{ ...active, canonicalCausalLineageDigest: "mutated" }], activeHypothesis: { ...active, canonicalCausalLineageDigest: "mutated" } } };
    expect(forecastsFor(mutated)).toEqual([]);
  });

  it("does not perturb lineage when unrelated evidence exists outside the hypothesis", () => {
    const first = buildFixture();
    const second = buildFixture(true);
    expect(second.hypothesisSet.activeHypothesis?.canonicalCausalLineageJson).toBe(first.hypothesisSet.activeHypothesis?.canonicalCausalLineageJson);
  });
});
