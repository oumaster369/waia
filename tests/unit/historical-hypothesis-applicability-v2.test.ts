import { describe, expect, it } from "vitest";

import { buildHistoricalHypothesisApplicabilitySetV2 } from
  "@/lib/trader/historical-simulation-v2/hypothesis-applicability-v2";
import { buildHypothesisSet } from
  "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
import { assembleDecisionChain } from
  "@/lib/trader/intelligence/decision-chain";
import { buildCanonicalRuntimeIntelligenceStateV1 } from
  "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import { createEmptyHypothesisSessionState } from
  "@/lib/trader/intelligence/mi-core.types";
import { finalizeMarketStateSnapshot } from
  "@/lib/trader/intelligence/market-state-finalization";
import { assembleReconstructionSnapshot } from
  "@/lib/trader/intelligence/reconstruction/reconstruction-assembly";
import type { ReconstructionSnapshot } from
  "@/lib/trader/intelligence/reconstruction/reconstruction.types";
import { buildIntelligenceCycleBundle } from
  "@/lib/trader/intelligence/records/intelligence-records-service";

const PIT = "2026-01-01T00:01:00.000Z";
const SHA = "1".repeat(40);
const DIGEST = "a".repeat(64);

function reconstruction(): ReconstructionSnapshot {
  return assembleReconstructionSnapshot({
    instrumentId: "BTCUSDT",
    evaluatedAt: PIT,
    marketStructure: {
      swingHighs: [], swingLows: [], structureBias: "NEUTRAL",
      higherHighSequence: false, lowerLowSequence: false,
      priorDayHigh: null, priorDayLow: null, sessionHigh: null, sessionLow: null,
      breakOfStructure: false, changeOfCharacter: false,
    },
    liquidityStructure: {
      levels: [], nearestObjectiveAbove: null, nearestObjectiveBelow: null,
      unsweptHighCount: 0, unsweptLowCount: 0,
    },
    trendStructure: { perTimeframeBias: {}, mtfAlignment: "UNCLEAR", regimeBias: "RANGE" },
    volatilityStructure: {
      atrUsdt: null, atrPeriod: 14, volatilityRegime: "UNKNOWN", expansionRatio: null,
    },
    participationStructure: {
      relativeVolume: null, volumeAnomaly: false, effortVsResult: "NEUTRAL",
    },
    contextStructure: {
      sessionPhase: "TEST", fearGreedIndex: null, crossVenueAgreement: null,
      contextOnly: true,
    },
  });
}

function fixture() {
  const canonicalRuntimeIntelligenceState = buildCanonicalRuntimeIntelligenceStateV1({
    organizationId: "org",
    symbol: "BTCUSDT",
    pitAnchor: PIT,
    knowledgeSemanticDigest: DIGEST,
    hypotheses: [{
      hypothesisId: "hypothesis-mean-reversion",
      hypothesisKey: "mean-reversion-range",
      definitionDigest: DIGEST,
      createdAt: PIT,
      hypothesisType: "mean_reversion",
      lifecycleState: "VALIDATED",
      rankOrdinal: 0,
      ordinalJudgment: "SUPPORTED",
      expectedPath: "revert_to_mean",
      invalidationConditions: ["trend_extension"],
      supportingEvidence: [{
        evidenceId: "evidence-for",
        contentDigest: DIGEST,
        direction: "FOR",
        eventTime: PIT,
        ingestTime: PIT,
      }],
      contradictingEvidence: [],
      knowledgeRefs: [{
        knowledgeEdgeId: "00000000-0000-4000-8000-000000000001",
        knowledgeState: "RESOLVED_CORRECT",
      }],
      supersedesHypothesisIds: [],
    }],
  });
  const currentReconstruction = reconstruction();
  const hypothesisSet = buildHypothesisSet({
    reconstruction: currentReconstruction,
    evaluatedAt: PIT,
    organizationId: "org",
    symbol: "BTCUSDT",
    sessionState: createEmptyHypothesisSessionState(),
    canonicalRuntimeIntelligenceState,
    canonicalApplicabilityPurpose: "HISTORICAL_PRE_HOLDOUT_NON_CAPITAL",
  }).hypothesisSet;
  const marketStateSnapshot = finalizeMarketStateSnapshot({
    reconstruction: currentReconstruction,
    hypothesisSet,
    tradingPermission: "ALLOW_TRADING",
    terminalReasonCode: "TEST_CANONICAL_APPLICABILITY",
  });
  const decisionChain = assembleDecisionChain({
    evaluatedAt: PIT,
    reconstruction: currentReconstruction,
    hypothesisSet,
    marketStateSnapshot,
    tradingPermission: "ALLOW_TRADING",
    reasonCodes: [],
  });
  const evaluationEnvelope = buildIntelligenceCycleBundle({
    organizationId: "org",
    runId: "applicability-test-run",
    cycleId: "1",
    symbol: "BTCUSDT",
    accountId: null,
    analyticalTimeframe: "1m",
    marketStateSnapshot,
    decisionChain,
  }).envelope;
  return {
    canonicalRuntimeIntelligenceState,
    currentReconstruction,
    hypothesisSet,
    evaluationEnvelope,
  };
}

function build(overrides: Partial<ReturnType<typeof fixture>> = {}) {
  const value = { ...fixture(), ...overrides };
  return buildHistoricalHypothesisApplicabilitySetV2({
    releaseSha: SHA,
    organizationId: "org",
    symbol: "BTCUSDT",
    pitAnchor: PIT,
    reconstruction: value.currentReconstruction,
    canonicalRuntimeIntelligenceState: value.canonicalRuntimeIntelligenceState,
    evaluationEnvelope: value.evaluationEnvelope,
    hypothesisSet: value.hypothesisSet,
  });
}

describe("historical hypothesis applicability v2", () => {
  it("admits only the receipt replayed from the exact reconstruction and canonical state", () => {
    expect(build().assessments[0]?.status).toBe("APPLICABLE");
    expect(build()).toEqual(build());
  });

  it("records cold start without fabricating applicability", () => {
    const value = fixture();
    expect(build({
      hypothesisSet: {
        ...value.hypothesisSet,
        hypotheses: [],
        activeHypothesis: null,
        opportunity: null,
      },
    }).assessments[0]?.status).toBe("BLOCKED");
  });
});
