import { describe, expect, it } from "vitest";

import { foldCanonicalRuntimeIntelligenceStateV1 } from "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import type { KnowledgeEdge } from "@/lib/trader/knowledge/knowledge.types";
import type { MiEvidence } from "@/lib/trader/mi/evidence.types";
import type { MiHypothesis, MiHypothesisLifecycleEvent } from "@/lib/trader/mi/hypothesis.types";
import type { MiEvidenceRepository, MiHypothesisRepository } from "@/lib/trader/mi/types";

const ORG = "org-1";
const AS_OF = new Date("2026-01-01T12:00:00.000Z");

function hypothesis(id: string, key: string, versionSeq = 1, createdAt = "2026-01-01T10:00:00.000Z"): MiHypothesis {
  return {
    id, organizationId: ORG, hypothesisKind: "market_claim", hypothesisKey: key, name: key,
    schemaVersion: "mi-hypothesis-v1",
    definitionJson: JSON.stringify({ claimShape: { relationshipType: "predictive", isDirectional: true, isTrendEdge: true, isTimingEdge: false }, prior: { ordinal: "low", band: "wide" }, falsificationConditions: ["break"], requiredNulls: ["always-flat-cash"], patternRefs: [], measurementRefs: [], regimeScope: { description: "trend" } }),
    definitionDigest: `definition-${id}`, supersedesJson: null, versionSeq, revisionOf: null,
    authoredBy: "test", createdAt: new Date(createdAt),
  };
}

function lifecycle(row: MiHypothesis, state: MiHypothesisLifecycleEvent["lifecycleState"] = "VALIDATED"): MiHypothesisLifecycleEvent {
  return { id: `life-${row.id}`, organizationId: ORG, hypothesisId: row.id, hypothesisKey: row.hypothesisKey, lifecycleState: state, rationale: "test", recordedBy: "test", seq: 1, contentDigest: `life-digest-${row.id}`, createdAt: new Date("2026-01-01T10:10:00.000Z") };
}

function evidence(row: MiHypothesis, direction: MiEvidence["direction"], id: string, ingest = "2026-01-01T11:00:00.000Z"): MiEvidence {
  return { id, organizationId: ORG, evidenceKind: "observed", direction, hypothesisId: row.id, hypothesisKey: row.hypothesisKey, hypothesisDefinitionDigest: row.definitionDigest, measurementRefsJson: "[]", observationRefsJson: "[]", eventTime: new Date("2026-01-01T10:50:00.000Z"), ingestTime: new Date(ingest), recordedBy: "test", seq: 1, contentDigest: `digest-${id}`, nullComparatorRef: null, regimeContextRef: null, trialRegistrationRef: null, createdAt: new Date(ingest) };
}

function deps(hypotheses: MiHypothesis[], evidenceRows: MiEvidence[], knowledgeEdges: readonly KnowledgeEdge[] = []) {
  const events = hypotheses.map((row) => lifecycle(row));
  const hypothesisRepo = {
    listHypotheses: () => hypotheses,
    listLifecycleEvents: (_context, key) => events.filter((row) => row.hypothesisKey === key),
    getLatestHypothesis: () => null, listHypothesisHistory: () => [], findHypothesisByDigest: () => null,
    findHypothesisById: () => null, insertHypothesisVersion: () => { throw new Error("write forbidden"); },
    getLatestLifecycleEvent: () => null, insertLifecycleEvent: () => { throw new Error("write forbidden"); },
  } satisfies MiHypothesisRepository;
  const evidenceRepo = {
    listEvidence: (_context, key) => evidenceRows.filter((row) => row.hypothesisKey === key),
    getLatestEvidence: () => null, listEvidenceByDirection: () => [], findEvidenceById: () => null,
    insertEvidence: () => { throw new Error("write forbidden"); },
  } satisfies MiEvidenceRepository;
  const source = createInMemoryMkbReadModelSource({ snapshotsByOrganizationId: { [ORG]: { cycleEnvelopes: [], hypotheses: [], convictions: [], forecasts: [], decisions: [], links: [], entryPurposes: [], knowledgeEdges, marketPredictions: [], marketEvents: [] } } });
  return { hypotheses: hypothesisRepo, evidence: evidenceRepo, knowledgeSource: source };
}

async function fold(hypotheses: MiHypothesis[], evidenceRows: MiEvidence[]) {
  return foldCanonicalRuntimeIntelligenceStateV1({
    context: { organizationId: ORG }, symbol: "BTC/USDT", asOf: AS_OF,
    projectHypothesis: (row) => ({ hypothesisType: row.hypothesisKey === "a" ? "trend_continuation" : "reversal", expectedPath: row.hypothesisKey }),
  }, deps(hypotheses, evidenceRows));
}

describe("DEE-629 canonical PIT fold", () => {
  it("is shuffle deterministic with an exact lexical tie-break", async () => {
    const a = hypothesis("hyp-a", "a");
    const b = hypothesis("hyp-b", "b");
    const rows = [evidence(a, "FOR", "ev-a"), evidence(b, "FOR", "ev-b")];
    const first = await fold([b, a], [rows[1]!, rows[0]!]);
    const second = await fold([a, b], rows);
    expect(first).toEqual(second);
    expect(first.hypotheses.map((row) => row.hypothesisKey)).toEqual(["a", "b"]);
  });

  it("keeps future revisions and evidence outside the current PIT digest", async () => {
    const current = hypothesis("hyp-a", "a");
    const future = hypothesis("hyp-a-v2", "a", 2, "2026-01-01T12:00:00.001Z");
    const currentEvidence = evidence(current, "FOR", "ev-a");
    const futureEvidence = evidence(current, "AGAINST", "ev-future", "2026-01-01T12:00:00.001Z");
    expect(await fold([current], [currentEvidence])).toEqual(await fold([future, current], [futureEvidence, currentEvidence]));
  });

  it("excludes a Knowledge edge whose mutable state was updated after the PIT anchor", async () => {
    const a = hypothesis("hyp-a", "a");
    const futureVerifiedEdge: KnowledgeEdge = {
      id: "edge-future-verification", organizationId: ORG, fromRef: "evidence:ev-a", toRef: "hypothesis:hyp-a",
      relationKind: "supports", confidence: "high", strength: "strong", regimeScope: "trend", failureCasesJson: "[]",
      hypothesisId: a.id, verified: true, createdAt: new Date("2026-01-01T11:00:00.000Z"), updatedAt: new Date("2026-01-01T12:00:00.001Z"),
    };
    const base = deps([a], [evidence(a, "FOR", "ev-a")]);
    const withFutureMutation = deps([a], [evidence(a, "FOR", "ev-a")], [futureVerifiedEdge]);
    const input = { context: { organizationId: ORG }, symbol: "BTC/USDT", asOf: AS_OF, projectHypothesis: () => ({ hypothesisType: "trend_continuation" as const, expectedPath: "a" }) };
    expect(await foldCanonicalRuntimeIntelligenceStateV1(input, withFutureMutation)).toEqual(
      await foldCanonicalRuntimeIntelligenceStateV1(input, base),
    );
    expect((await foldCanonicalRuntimeIntelligenceStateV1(input, withFutureMutation)).hypotheses[0]?.ordinalJudgment).toBe("WEAKENED");
  });

  it("preserves exact FOR and AGAINST evidence without scalar netting", async () => {
    const a = hypothesis("hyp-a", "a");
    const state = await fold([a], [evidence(a, "FOR", "ev-for"), evidence(a, "AGAINST", "ev-against")]);
    expect(state.hypotheses[0]?.supportingEvidence.map((row) => row.evidenceId)).toEqual(["ev-for"]);
    expect(state.hypotheses[0]?.contradictingEvidence.map((row) => row.evidenceId)).toEqual(["ev-against"]);
    expect(state.hypotheses[0]?.ordinalJudgment).toBe("CONTESTED");
  });

  it("fails closed on cross-organization and missing lifecycle rows", async () => {
    const cross = { ...hypothesis("hyp-a", "a"), organizationId: "org-other" };
    await expect(fold([cross], [])).rejects.toThrow(/cross-organization/);
    const a = hypothesis("hyp-a", "a");
    const broken = deps([a], []);
    broken.hypotheses.listLifecycleEvents = () => [];
    await expect(foldCanonicalRuntimeIntelligenceStateV1({ context: { organizationId: ORG }, symbol: "BTC/USDT", asOf: AS_OF, projectHypothesis: () => ({ hypothesisType: "trend_continuation", expectedPath: "x" }) }, broken)).rejects.toThrow(/missing lifecycle/);
  });
});
