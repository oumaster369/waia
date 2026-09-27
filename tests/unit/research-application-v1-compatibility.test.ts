import { describe, expect, it } from "vitest";
import { foldCanonicalRuntimeIntelligenceStateV1, sealHistoricalKnowledgeEdgeV1 } from
  "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import { selectKnowledgeForQuestionV2, type KnowledgeNavigatorCandidateV2 } from
  "@/lib/trader/knowledge/navigator/knowledge-navigator-v2";
import type { CanonicalRuntimeIntelligenceFoldDepsV1 } from
  "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import type { MiHypothesis, MiHypothesisLifecycleEvent } from "@/lib/trader/mi/hypothesis.types";
import type { MiEvidence } from "@/lib/trader/mi/evidence.types";
import type { KnowledgeEdge } from "@/lib/trader/knowledge/knowledge.types";

const at = new Date("2026-01-01T12:00:00.000Z");
const createdAt = new Date("2026-01-01T10:00:00.000Z");
const hypothesis: MiHypothesis = { id: "h", organizationId: "org", hypothesisKind: "market_claim", hypothesisKey: "key", name: "claim",
  schemaVersion: "mi-hypothesis-v1", definitionJson: JSON.stringify({ claimShape: { relationshipType: "predictive", isDirectional: false, isTrendEdge: true, isTimingEdge: false },
    prior: { ordinal: "low", band: "wide" }, falsificationConditions: ["break"], requiredNulls: ["always-flat-cash", "simple-trend-baseline"], patternRefs: [], measurementRefs: [], regimeScope: { description: "trend" } }),
  definitionDigest: "definition", supersedesJson: null, versionSeq: 1, revisionOf: null, authoredBy: "fixture", createdAt };
const lifecycle: MiHypothesisLifecycleEvent = { id: "l", organizationId: "org", hypothesisId: "h", hypothesisKey: "key", lifecycleState: "VALIDATED",
  rationale: "fixture", recordedBy: "fixture", seq: 1, contentDigest: "l-digest", createdAt };
const evidence: MiEvidence = { id: "e", organizationId: "org", evidenceKind: "observed", direction: "FOR", hypothesisId: "h", hypothesisKey: "key",
  hypothesisDefinitionDigest: "definition", measurementRefsJson: "[]", observationRefsJson: "[]", eventTime: createdAt, ingestTime: createdAt,
  recordedBy: "fixture", seq: 1, contentDigest: "e-digest", nullComparatorRef: null, regimeContextRef: null, trialRegistrationRef: null, createdAt };
const edge: KnowledgeEdge = { id: "k", organizationId: "org", fromRef: "evidence:e", toRef: "hypothesis:h", relationKind: "supports",
  confidence: "0.8000", strength: "1.0000", regimeScope: "trend", failureCasesJson: "[]", hypothesisId: "h", verified: true, createdAt, updatedAt: createdAt };
function fold(edges: KnowledgeEdge[] = [edge], rows: MiEvidence[] = [evidence]) {
  const deps = { hypotheses: { listHypotheses: () => [hypothesis], listLifecycleEvents: () => [lifecycle] },
    evidence: { listEvidence: () => rows }, knowledgeSource: { loadSnapshot: () => ({ knowledgeEdges: edges, marketPredictions: [] }) } };
  return foldCanonicalRuntimeIntelligenceStateV1({ context: { organizationId: "org" }, symbol: "BTC/USDT", asOf: at,
    projectHypothesis: () => ({ hypothesisType: "trend_continuation", expectedPath: "higher" }) }, deps as unknown as CanonicalRuntimeIntelligenceFoldDepsV1);
}
const candidate: KnowledgeNavigatorCandidateV2 = { knowledgeEdgeId: "edge-a", version: 1, contentDigestHex: "a".repeat(64), organizationId: "org",
  symbol: "BTC/USDT", questionId: "WHAT", pitEventAt: createdAt.toISOString(), lifecycleState: "ACTIVE", verified: true,
  fromRef: "one", toRef: "two", relationKind: "supports" };
const selection = (candidates: KnowledgeNavigatorCandidateV2[]) => selectKnowledgeForQuestionV2({ organizationId: "org", runId: "run", symbol: "BTC/USDT", purpose: "NEW_OPPORTUNITY_SEARCH",
  questionId: "WHAT", pitAnchor: at.toISOString(), informationNeedPlanDigestHex: "b".repeat(64), evidenceBudget: 1, maxStalenessMs: 7_200_000, candidates });

describe("DEE1132 legacy wrappers preserve accepted semantics", () => {
  it("retains ACTIVE and legacy digest bytes while RETIRED withdraws support", async () => {
    const legacy = await fold();
    expect(await fold([{ ...edge, lifecycleState: "ACTIVE" }])).toEqual(legacy);
    expect(legacy.hypotheses[0]?.ordinalJudgment).toBe("SUPPORTED");
    const retired = await fold([{ ...edge, lifecycleState: "RETIRED" }]);
    expect(retired.hypotheses[0]?.ordinalJudgment).toBe("WEAKENED");
    expect(retired.knowledgeSemanticDigest).not.toBe(legacy.knowledgeSemanticDigest);
    expect(sealHistoricalKnowledgeEdgeV1({ ...edge, lifecycleState: "ACTIVE" })).toBe(sealHistoricalKnowledgeEdgeV1(edge));
    expect(legacy.semanticDigest).toBe("80c6254b29cd58213e3ee6c91fefe32f2f799a6c12de19cc43a244b821636b60");
    expect(legacy.knowledgeSemanticDigest).toBe("082dfaa80d8b7ae142e411e55354e8f85e03be3e85dcca8ff5cb63f8312df6c5");
    expect(selection([candidate]).contentDigestHex).toBe("0d812d2a017f610cb0dda3255ad82d551d11f5d5a0dcccfc73cb2b6cd40d2732");
    expect(sealHistoricalKnowledgeEdgeV1(edge)).toBe("f5ec59f3e4b9e8e483fe735caa65e39784408cc2f4f350d70e784aa73f3e1ca7");
  });
  it("does not change direction partition or the existing verified support precedence", async () => {
    const against = { ...evidence, id: "against", direction: "AGAINST" as const, contentDigest: "against" };
    const state = await fold([edge], [evidence, { ...evidence, id: "e2" }, against]);
    expect(state.hypotheses[0]?.ordinalJudgment).toBe("SUPPORTED");
    expect(state.hypotheses[0]?.supportingEvidence.map(r => r.evidenceId)).toEqual(["e", "e2"]);
    expect(state.hypotheses[0]?.contradictingEvidence.map(r => r.evidenceId)).toEqual(["against"]);
  });
  it("preserves shuffled duplicate and contradictory Navigator outcomes", () => {
    const duplicate = { ...candidate, knowledgeEdgeId: "z", fromRef: "other" };
    expect(selection([duplicate, candidate])).toEqual(selection([candidate, duplicate]));
    expect(selection([candidate, { ...candidate, knowledgeEdgeId: "against", relationKind: "against", contentDigestHex: "c".repeat(64) }]).outcome).toBe("UNKNOWN_UNRESOLVED");
  });
  it("refuses an explicit research evidence marker in an injected ordinary repository", async () => {
    await expect(fold([edge], [{ ...evidence, authority: "RESEARCH_APPLICATION_ONLY" } as MiEvidence])).rejects.toThrow("RESEARCH_APPLICATION_BOUNDARY");
  });
  it("refuses an explicit research relation marker before ordinary Knowledge classification", async () => {
    await expect(fold([{ ...edge, schemaVersion: "waia.trader.research_application_relation.v1" } as KnowledgeEdge])).rejects.toThrow("RESEARCH_APPLICATION_BOUNDARY");
  });
  it("refuses a research relation cast into the old Navigator receipt path", () => {
    expect(() => selection([{ ...candidate, authority: "RESEARCH_APPLICATION_ONLY" } as KnowledgeNavigatorCandidateV2])).toThrow("RESEARCH_APPLICATION_BOUNDARY");
  });
});
