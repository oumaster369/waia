import { describe, expect, it } from "vitest";

import { buildHypothesisSet } from "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
import {
  buildRuntimeKnowledgeAuthorityV1,
  RUNTIME_KNOWLEDGE_DERIVATION_VERSION,
  type BuildRuntimeKnowledgeAuthorityV1Input,
} from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import {
  RECONSTRUCTION_SNAPSHOT_SCHEMA_VERSION,
  type ReconstructionSnapshot,
} from "@/lib/trader/intelligence/reconstruction/reconstruction.types";

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

function authorityInput(): BuildRuntimeKnowledgeAuthorityV1Input {
  return {
    organizationId: "org-1",
    symbol: "BTC/USDT",
    pitAnchor: PIT,
    knowledgeSemanticDigest: "knowledge-snapshot-digest",
    hypotheses: [
      {
        hypothesisId: "hyp-1",
        hypothesisKey: "trend-persistence",
        definitionDigest: "definition-1",
        createdAt: "2026-01-01T10:00:00.000Z",
        hypothesisType: "trend_continuation",
        lifecycleState: "VALIDATED",
        rankOrdinal: 0,
        ordinalJudgment: "SUPPORTED",
        expectedPath: "continuation_higher",
        invalidationConditions: ["structure_break"],
        supportingEvidence: [{ evidenceId: "ev-for", contentDigest: "ev-for-digest", direction: "FOR", eventTime: "2026-01-01T11:00:00.000Z", ingestTime: "2026-01-01T11:01:00.000Z" }],
        contradictingEvidence: [{ evidenceId: "ev-against", contentDigest: "ev-against-digest", direction: "AGAINST", eventTime: "2026-01-01T11:10:00.000Z", ingestTime: "2026-01-01T11:11:00.000Z" }],
        knowledgeRefs: [{ knowledgeEdgeId: "edge-1", knowledgeState: "RESOLVED_CORRECT" }],
        supersedesHypothesisIds: [],
      },
    ],
  };
}

function evaluate(input = authorityInput()) {
  return buildHypothesisSet({
    reconstruction: reconstruction(),
    evaluatedAt: PIT,
    organizationId: "org-1",
    symbol: "BTC/USDT",
    sessionState: createEmptyHypothesisSessionState(),
    canonicalRuntimeIntelligenceState: buildRuntimeKnowledgeAuthorityV1(input),
  }).hypothesisSet;
}

describe("DEE-629 runtime Knowledge/Hypothesis authority", () => {
  it("replays an identical PIT authority deterministically and ranks ordinally", () => {
    expect(evaluate()).toEqual(evaluate());
    expect(evaluate().activeHypothesis).toMatchObject({ authority: "CANONICAL_PIT_KNOWLEDGE", rankOrdinal: 0, confidence: 0 });
    expect(evaluate().opportunity).toBeNull();
  });

  it("keeps the legacy fixed-delta set diagnostic and fails closed without a receipt", () => {
    const result = buildHypothesisSet({ reconstruction: reconstruction(), evaluatedAt: PIT, sessionState: createEmptyHypothesisSessionState() }).hypothesisSet;
    expect(result.hypotheses).toHaveLength(8);
    expect(result.hypotheses.every((item) => item.authority === "LEGACY_DIAGNOSTIC")).toBe(true);
    expect(result.activeHypothesis).toBeNull();
    expect(result.opportunity).toBeNull();
  });

  it("rejects future evidence before runtime evaluation", () => {
    const input = authorityInput();
    const hypotheses = input.hypotheses.map((item) => ({ ...item, supportingEvidence: item.supportingEvidence.map((evidence) => ({ ...evidence, ingestTime: "2026-01-01T12:00:00.001Z" })) }));
    expect(() => buildRuntimeKnowledgeAuthorityV1({ ...input, hypotheses })).toThrow(/knowable at pitAnchor/);
  });

  it("rejects receipt mutation and cross-scope use", () => {
    const receipt = buildRuntimeKnowledgeAuthorityV1(authorityInput());
    expect(() => buildHypothesisSet({ reconstruction: reconstruction(), evaluatedAt: PIT, organizationId: "org-1", symbol: "BTC/USDT", sessionState: createEmptyHypothesisSessionState(), canonicalRuntimeIntelligenceState: { ...receipt, knowledgeSemanticDigest: "changed" } })).toThrow(/digest mismatch/);
    expect(() => buildHypothesisSet({ reconstruction: reconstruction(), evaluatedAt: PIT, organizationId: "org-other", symbol: "BTC/USDT", sessionState: createEmptyHypothesisSessionState(), canonicalRuntimeIntelligenceState: receipt })).toThrow(/scope mismatch/);
    expect(() => buildHypothesisSet({ reconstruction: reconstruction(), evaluatedAt: PIT, organizationId: "org-1", symbol: "ETH/USDT", sessionState: createEmptyHypothesisSessionState(), canonicalRuntimeIntelligenceState: receipt })).toThrow(/scope mismatch/);
    expect(() => buildHypothesisSet({ reconstruction: reconstruction(), evaluatedAt: "2026-01-01T12:01:00.000Z", organizationId: "org-1", symbol: "BTC\/USDT", sessionState: createEmptyHypothesisSessionState(), canonicalRuntimeIntelligenceState: receipt })).toThrow(/scope mismatch/);
    expect(() => buildHypothesisSet({ reconstruction: reconstruction(), evaluatedAt: PIT, organizationId: "org-1", symbol: "BTC/USDT", sessionState: createEmptyHypothesisSessionState(), canonicalRuntimeIntelligenceState: { ...receipt, derivationVersion: `${RUNTIME_KNOWLEDGE_DERIVATION_VERSION}-spoofed` as typeof RUNTIME_KNOWLEDGE_DERIVATION_VERSION } })).toThrow(/unsupported authority/);
  });

  it("removes retired, quarantined and superseded hypotheses and preserves contradictions", () => {
    const input = authorityInput();
    const first = input.hypotheses[0]!;
    const result = evaluate({ ...input, hypotheses: [
      { ...first, rankOrdinal: 1 },
      { ...first, hypothesisId: "hyp-2", hypothesisKey: "replacement", definitionDigest: "definition-2", rankOrdinal: 0, supportingEvidence: first.supportingEvidence.map((item) => ({ ...item, evidenceId: "ev-for-2" })), contradictingEvidence: [{ ...first.contradictingEvidence[0]!, evidenceId: "ev-against-2" }, { evidenceId: "ev-against-3", contentDigest: "digest-3", direction: "AGAINST", eventTime: "2026-01-01T11:20:00.000Z", ingestTime: "2026-01-01T11:21:00.000Z" }], knowledgeRefs: [{ knowledgeEdgeId: "edge-2", knowledgeState: "RESOLVED_CORRECT" }], supersedesHypothesisIds: ["hyp-1"] },
      { ...first, hypothesisId: "hyp-3", hypothesisKey: "retired", definitionDigest: "definition-3", lifecycleState: "RETIRED", rankOrdinal: 2, supportingEvidence: first.supportingEvidence.map((item) => ({ ...item, evidenceId: "ev-for-3" })), contradictingEvidence: first.contradictingEvidence.map((item) => ({ ...item, evidenceId: "ev-against-4" })), knowledgeRefs: [{ knowledgeEdgeId: "edge-3", knowledgeState: "RESOLVED_CORRECT" }] },
    ] });
    expect(result.hypotheses.map((item) => item.canonicalHypothesisId)).toEqual(["hyp-2"]);
    expect(result.hypotheses[0]?.contradictingEvidence).toEqual(["ev-against-2", "ev-against-3"]);
  });

  it("allows ordinal rank changes without treating rank as probability", () => {
    const input = authorityInput();
    const first = input.hypotheses[0]!;
    const result = evaluate({ ...input, hypotheses: [
      { ...first, rankOrdinal: 1 },
      { ...first, hypothesisId: "hyp-2", hypothesisKey: "reversal", definitionDigest: "definition-2", hypothesisType: "reversal", rankOrdinal: 0, supportingEvidence: first.supportingEvidence.map((item) => ({ ...item, evidenceId: "ev-for-2" })), contradictingEvidence: first.contradictingEvidence.map((item) => ({ ...item, evidenceId: "ev-against-2" })), knowledgeRefs: [{ knowledgeEdgeId: "edge-2", knowledgeState: "RESOLVED_CORRECT" }] },
    ] });
    expect(result.activeHypothesis?.hypothesisType).toBe("reversal");
    expect(result.activeHypothesis?.rankOrdinal).toBe(0);
    expect(result.activeHypothesis?.confidence).toBe(0);
  });
});
