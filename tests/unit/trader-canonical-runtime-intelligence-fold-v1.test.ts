import { describe, expect, it } from "vitest";

import {
  computeCanonicalHistoricalSealedKnowledgeSnapshotDigestV1,
  foldCanonicalRuntimeIntelligenceStateV1,
  sealHistoricalKnowledgeEdgeV1,
  sealHistoricalMarketPredictionV1,
} from "@/lib/trader/intelligence/hypothesis/canonical-runtime-intelligence-fold-v1";
import { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import type { KnowledgeEdge, MarketPrediction } from "@/lib/trader/knowledge/knowledge.types";
import type { MiEvidence } from "@/lib/trader/mi/evidence.types";
import type { MiHypothesis, MiHypothesisLifecycleEvent } from "@/lib/trader/mi/hypothesis.types";
import type { PitObservation } from "@/lib/trader/mi/observation.types";
import type { MiTrial } from "@/lib/trader/mi/trial.types";
import type {
  MiEvidenceRepository,
  MiHypothesisRepository,
  MiObservationRepository,
  MiTrialRepository,
} from "@/lib/trader/mi/types";

const ORG = "org-1";
const AS_OF = new Date("2026-01-01T12:00:00.000Z");
const EPISTEMIC_CUTOFF = new Date("2026-09-01T10:04:00.000Z");
const EPISTEMIC_AUTHORITY = {
  schemaVersion: "waia.trader.historical_four_surface_ratified_admission.v2" as const,
  ratifiedAdmissionId: "00000000-0000-4000-8000-000000000019",
  authorityContentDigestHex: "a".repeat(64),
  createdAt: EPISTEMIC_CUTOFF,
};

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

function deps(
  hypotheses: MiHypothesis[],
  evidenceRows: MiEvidence[],
  knowledgeEdges: readonly KnowledgeEdge[] = [],
  marketPredictions: readonly MarketPrediction[] = [],
  observationRows: readonly PitObservation[] = [],
  trialRows: readonly MiTrial[] = [],
) {
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
  const source = createInMemoryMkbReadModelSource({ snapshotsByOrganizationId: { [ORG]: { cycleEnvelopes: [], hypotheses: [], convictions: [], forecasts: [], decisions: [], links: [], entryPurposes: [], knowledgeEdges, marketPredictions, marketEvents: [] } } });
  const observations = {
    findObservationById: (_context, id) => observationRows.find((row) => row.id === id) ?? null,
    getLatestObservation: () => null, listObservationHistory: () => [],
    listObservations: () => [...observationRows],
    insertObservation: () => { throw new Error("write forbidden"); },
  } satisfies MiObservationRepository;
  const trials = {
    findTrialById: (_context, id) => trialRows.find((row) => row.id === id) ?? null,
    getLatestTrial: () => null, listTrials: () => [], listTrialsByHypothesisId: () => [],
    insertTrial: () => { throw new Error("write forbidden"); },
  } satisfies MiTrialRepository;
  return { hypotheses: hypothesisRepo, evidence: evidenceRepo, knowledgeSource: source,
    observations, trials };
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

  it("accepts late-recorded old evidence only under a durable epistemic cutoff", async () => {
    const a = hypothesis("00000000-0000-4000-8000-00000000000a", "a", 1, "2026-09-01T10:00:00.000Z");
    const late = {
      ...evidence(a, "FOR", "ev-late", "2026-09-01T10:01:00.000Z"),
      createdAt: new Date("2026-09-01T10:01:00.000Z"),
    };
    const edge: KnowledgeEdge = {
      id: "edge-confirmed", organizationId: ORG,
      fromRef: "market_prediction:00000000-0000-4000-8000-00000000000b",
      toRef: `hypothesis:${a.id}`, relationKind: "wf_predictive_supports_hypothesis",
      confidence: "0.7300", strength: "1.0000", regimeScope: "",
      failureCasesJson: "[]", hypothesisId: a.id, verified: true,
      createdAt: new Date("2026-09-01T10:02:00.000Z"),
      updatedAt: new Date("2026-09-01T10:03:00.000Z"),
    };
    const prediction: MarketPrediction = {
      id: "00000000-0000-4000-8000-00000000000b", organizationId: ORG,
      subjectRef: `hypothesis:${a.id}`, predictionJson: "{}",
      predictedAt: new Date("2026-01-01T10:00:00.000Z"), outcomeJson: "{}",
      verifiedAt: new Date("2026-01-01T11:30:00.000Z"), verificationResult: "confirmed",
      contentDigest: "prediction-digest", createdAt: new Date("2026-09-01T10:00:30.000Z"),
    };
    const state = await foldCanonicalRuntimeIntelligenceStateV1({
      context: { organizationId: ORG }, symbol: "BTC/USDT", asOf: AS_OF,
      epistemicRecordCutoff: EPISTEMIC_CUTOFF,
      epistemicAuthority: EPISTEMIC_AUTHORITY,
      requireMarketTimestampedKnowledge: true,
      projectHypothesis: () => ({ hypothesisType: "trend_continuation", expectedPath: "higher" }),
    }, deps([a], [late], [edge], [prediction]));
    expect(state.hypotheses[0]?.knowledgeRefs).toEqual([
      { knowledgeEdgeId: "edge-confirmed", knowledgeState: "RESOLVED_CORRECT" },
    ]);
    expect(state.hypotheses[0]?.ordinalJudgment).toBe("SUPPORTED");
  });

  it("rejects a resolved edge whose market outcome is after the forecast PIT", async () => {
    const a = hypothesis("00000000-0000-4000-8000-00000000000a", "a", 1, "2026-09-01T10:00:00.000Z");
    const late = { ...evidence(a, "FOR", "ev-late"), createdAt: new Date("2026-09-01T10:01:00.000Z") };
    const edge: KnowledgeEdge = {
      id: "edge-future-outcome", organizationId: ORG,
      fromRef: "market_prediction:00000000-0000-4000-8000-00000000000b",
      toRef: `hypothesis:${a.id}`, relationKind: "wf_predictive_supports_hypothesis",
      confidence: "0.7300", strength: "1.0000", regimeScope: "", failureCasesJson: "[]",
      hypothesisId: a.id, verified: true, createdAt: new Date("2026-09-01T10:02:00.000Z"),
      updatedAt: new Date("2026-09-01T10:03:00.000Z"),
    };
    const prediction: MarketPrediction = {
      id: "00000000-0000-4000-8000-00000000000b", organizationId: ORG,
      subjectRef: `hypothesis:${a.id}`, predictionJson: "{}",
      predictedAt: new Date("2026-01-01T10:00:00.000Z"), outcomeJson: "{}",
      verifiedAt: new Date("2026-01-01T12:00:00.001Z"), verificationResult: "confirmed",
      contentDigest: "prediction-digest", createdAt: new Date("2026-09-01T10:00:30.000Z"),
    };
    const state = await foldCanonicalRuntimeIntelligenceStateV1({
      context: { organizationId: ORG }, symbol: "BTC/USDT", asOf: AS_OF,
      epistemicRecordCutoff: EPISTEMIC_CUTOFF,
      epistemicAuthority: EPISTEMIC_AUTHORITY,
      requireMarketTimestampedKnowledge: true,
      projectHypothesis: () => ({ hypothesisType: "trend_continuation", expectedPath: "higher" }),
    }, deps([a], [late], [edge], [prediction]));
    expect(state.hypotheses[0]?.ordinalJudgment).toBe("WEAKENED");
  });

  it("rejects an unbound epistemic cutoff and unrelated prediction substitution", async () => {
    const a = hypothesis("00000000-0000-4000-8000-00000000000a", "a", 1,
      "2026-09-01T10:00:00.000Z");
    await expect(foldCanonicalRuntimeIntelligenceStateV1({
      context: { organizationId: ORG }, symbol: "BTC/USDT", asOf: AS_OF,
      epistemicRecordCutoff: EPISTEMIC_CUTOFF,
      projectHypothesis: () => ({ hypothesisType: "trend_continuation", expectedPath: "higher" }),
    }, deps([a], []))).rejects.toThrow(/invalid dual-time cutoff/);

    const edge: KnowledgeEdge = {
      id: "edge-substitution", organizationId: ORG,
      fromRef: "market_prediction:00000000-0000-4000-8000-00000000000b",
      toRef: `hypothesis:${a.id}`, relationKind: "wf_predictive_supports_hypothesis",
      confidence: "0.7300", strength: "1.0000", regimeScope: "", failureCasesJson: "[]",
      hypothesisId: a.id, verified: true, createdAt: new Date("2026-09-01T10:02:00.000Z"),
      updatedAt: new Date("2026-09-01T10:03:00.000Z"),
    };
    const unrelated: MarketPrediction = {
      id: "00000000-0000-4000-8000-00000000000b", organizationId: "org-other",
      subjectRef: "hypothesis:someone-else", predictionJson: "{}",
      predictedAt: new Date("2026-01-01T10:00:00.000Z"), outcomeJson: "{}",
      verifiedAt: new Date("2026-01-01T11:30:00.000Z"), verificationResult: "confirmed",
      contentDigest: "prediction-digest", createdAt: new Date("2026-09-01T10:00:30.000Z"),
    };
    const state = await foldCanonicalRuntimeIntelligenceStateV1({
      context: { organizationId: ORG }, symbol: "BTC/USDT", asOf: AS_OF,
      epistemicRecordCutoff: EPISTEMIC_CUTOFF, epistemicAuthority: EPISTEMIC_AUTHORITY,
      requireMarketTimestampedKnowledge: true,
      projectHypothesis: () => ({ hypothesisType: "trend_continuation", expectedPath: "higher" }),
    }, deps([a], [{ ...evidence(a, "FOR", "ev"),
      createdAt: new Date("2026-09-01T10:01:00.000Z") }], [edge], [unrelated]));
    expect(state.hypotheses[0]?.ordinalJudgment).toBe("WEAKENED");
    expect(state.hypotheses[0]?.knowledgeRefs).toEqual([]);
  });

  it("exactly replays sealed knowledge and rejects mutable prediction or future observation", async () => {
    const a = hypothesis("00000000-0000-4000-8000-00000000000a", "a", 1,
      "2026-09-01T10:00:00.000Z");
    const observation: PitObservation = {
      id: "00000000-0000-4000-8000-00000000000c", organizationId: ORG,
      sourceId: "00000000-0000-4000-8000-00000000000d",
      observationKind: "msv_envelope", observationKey: "sealed-observation",
      subjectRef: "BTC/USDT", schemaVersion: "mi-observation-v1", payloadJson: "{}",
      eventTime: new Date("2026-01-01T11:30:00.000Z"),
      ingestTime: new Date("2026-09-01T10:01:00.000Z"), observedBy: "operator",
      revisionOf: null, revisionSeq: 1, contentDigest: "observation-digest",
      createdAt: new Date("2026-09-01T10:01:01.000Z"),
    };
    const trial: MiTrial = {
      id: "00000000-0000-4000-8000-00000000000e", organizationId: ORG,
      hypothesisId: a.id, hypothesisKey: a.hypothesisKey,
      hypothesisDefinitionDigest: a.definitionDigest, researchProgram: "sealed",
      eventTime: new Date("2026-01-01T10:00:00.000Z"),
      ingestTime: new Date("2026-09-01T10:00:30.000Z"), registeredBy: "operator",
      seq: 1, contentDigest: "trial-digest",
      createdAt: new Date("2026-09-01T10:00:31.000Z"),
    };
    const sealedEvidence = {
      ...evidence(a, "FOR", "ev-sealed", "2026-09-01T10:01:30.000Z"),
      observationRefsJson: JSON.stringify([{ observationId: observation.id }]),
      trialRegistrationRef: trial.id,
      createdAt: new Date("2026-09-01T10:01:31.000Z"),
    };
    const prediction: MarketPrediction = {
      id: "00000000-0000-4000-8000-00000000000b", organizationId: ORG,
      subjectRef: `hypothesis:${a.id}`, predictionJson: "{}",
      predictedAt: new Date("2026-01-01T10:00:00.000Z"), outcomeJson: "{}",
      verifiedAt: new Date("2026-01-01T11:30:00.000Z"), verificationResult: "confirmed",
      contentDigest: "prediction-digest", createdAt: new Date("2026-09-01T10:00:30.000Z"),
    };
    const edge: KnowledgeEdge = {
      id: "edge-sealed", organizationId: ORG,
      fromRef: `market_prediction:${prediction.id}`, toRef: `hypothesis:${a.id}`,
      relationKind: "wf_predictive_supports_hypothesis", confidence: "0.7300",
      strength: "1.0000", regimeScope: "", failureCasesJson: "[]",
      hypothesisId: a.id, verified: true,
      createdAt: new Date("2026-09-01T10:02:00.000Z"),
      updatedAt: new Date("2026-09-01T10:03:00.000Z"),
    };
    const sealedBody = {
      schemaVersion: "waia.trader.historical_prerun_knowledge_bootstrap.v2" as const,
      organizationId: ORG, runId: "sealed-run", releaseSha: "a".repeat(40),
      surfaceKey: "BTCUSDT:30", selectedHypothesisType: "trend_continuation" as const,
      hypothesisId: a.id, hypothesisKey: a.hypothesisKey,
      hypothesisDefinitionDigest: a.definitionDigest,
      hypothesisCreatedAt: a.createdAt.toISOString(), lifecycleId: `life-${a.id}`,
      lifecycleContentDigest: `life-digest-${a.id}`, lifecycleState: "VALIDATED" as const,
      lifecycleCreatedAt: "2026-01-01T10:10:00.000Z",
      evidence: { id: sealedEvidence.id, contentDigest: sealedEvidence.contentDigest,
        eventTime: sealedEvidence.eventTime.toISOString(),
        ingestTime: sealedEvidence.ingestTime.toISOString(),
        createdAt: sealedEvidence.createdAt.toISOString() },
      observation: { id: observation.id, contentDigest: observation.contentDigest,
        eventTime: observation.eventTime.toISOString(),
        ingestTime: observation.ingestTime.toISOString(),
        createdAt: observation.createdAt.toISOString() },
      trial: { id: trial.id, contentDigest: trial.contentDigest,
        eventTime: trial.eventTime.toISOString(), ingestTime: trial.ingestTime.toISOString(),
        createdAt: trial.createdAt.toISOString() },
      predictionId: prediction.id,
      predictionSealDigestHex: sealHistoricalMarketPredictionV1(prediction),
      edgeId: edge.id, edgeSealDigestHex: sealHistoricalKnowledgeEdgeV1(edge),
      marketPitBoundary: observation.eventTime.toISOString(),
    };
    const sealed = { ...sealedBody,
      snapshotContentDigestHex:
        computeCanonicalHistoricalSealedKnowledgeSnapshotDigestV1(sealedBody) };
    const input = {
      context: { organizationId: ORG }, symbol: "BTC/USDT", asOf: AS_OF,
      epistemicRecordCutoff: EPISTEMIC_CUTOFF, epistemicAuthority: EPISTEMIC_AUTHORITY,
      requireMarketTimestampedKnowledge: true, sealedHistoricalKnowledge: sealed,
      projectHypothesis: () => ({ hypothesisType: "trend_continuation" as const,
        expectedPath: "higher" }),
    };
    const valid = deps([a], [sealedEvidence], [edge], [prediction], [observation], [trial]);
    expect((await foldCanonicalRuntimeIntelligenceStateV1(input, valid))
      .hypotheses[0]?.ordinalJudgment).toBe("SUPPORTED");

    await expect(foldCanonicalRuntimeIntelligenceStateV1({
      ...input,
      sealedHistoricalKnowledge: {
        ...sealed,
        marketPitBoundary: "2026-01-01T12:00:00.001Z",
        snapshotContentDigestHex: computeCanonicalHistoricalSealedKnowledgeSnapshotDigestV1({
          ...sealedBody,
          marketPitBoundary: "2026-01-01T12:00:00.001Z",
        }),
      },
    }, valid)).rejects.toThrow(/sealed knowledge snapshot binding mismatch/);

    await expect(foldCanonicalRuntimeIntelligenceStateV1({
      ...input,
      sealedHistoricalKnowledge: {
        ...sealed,
        marketPitBoundary: "2026-01-01T11:29:00.000Z",
      },
    }, valid)).rejects.toThrow(/sealed knowledge snapshot binding mismatch/);

    const mutatedPrediction = { ...prediction,
      outcomeJson: "{\"changed\":true}",
      verifiedAt: new Date("2026-01-01T11:00:00.000Z") };
    await expect(foldCanonicalRuntimeIntelligenceStateV1(input,
      deps([a], [sealedEvidence], [edge], [mutatedPrediction], [observation], [trial])))
      .rejects.toThrow(/sealed market prediction authority mismatch/);

    const futureObservation = {
      ...observation,
      eventTime: new Date("2026-01-01T12:00:00.001Z"),
    };
    await expect(foldCanonicalRuntimeIntelligenceStateV1({
      ...input,
      sealedHistoricalKnowledge: {
        ...sealed,
        observation: { ...sealed.observation,
          eventTime: futureObservation.eventTime.toISOString() },
        snapshotContentDigestHex: computeCanonicalHistoricalSealedKnowledgeSnapshotDigestV1({
          ...sealedBody,
          observation: { ...sealed.observation,
            eventTime: futureObservation.eventTime.toISOString() },
        }),
      },
    }, deps([a], [sealedEvidence], [edge], [prediction], [futureObservation], [trial])))
      .rejects.toThrow(/sealed observation authority mismatch/);
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
