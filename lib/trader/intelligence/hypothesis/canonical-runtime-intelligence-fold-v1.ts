import { createHash } from "node:crypto";

import type { HypothesisType } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import {
  buildCanonicalRuntimeIntelligenceStateV1,
  type RuntimeKnowledgeHypothesisV1,
  type RuntimeKnowledgeAuthorityV1,
} from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";
import { classifyKnowledgeEdgeState } from "@/lib/trader/knowledge/mkb-knowledge-state";
import type { MkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import type { HypothesisDefinition, MiHypothesis } from "@/lib/trader/mi/hypothesis.types";
import { MI_HYPOTHESIS_SCHEMA_VERSION } from "@/lib/trader/mi/hypothesis.types";
import type { MiEvidenceRepository, MiHypothesisRepository } from "@/lib/trader/mi/types";
import type { MiObservationRepository, MiTrialRepository } from "@/lib/trader/mi/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { KnowledgeEdge, MarketPrediction } from
  "@/lib/trader/knowledge/knowledge.types";

export type CanonicalRuntimeIntelligenceFoldDepsV1 = Readonly<{
  hypotheses: MiHypothesisRepository;
  evidence: MiEvidenceRepository;
  knowledgeSource: MkbReadModelSource;
  observations?: MiObservationRepository;
  trials?: MiTrialRepository;
}>;

export type CanonicalHistoricalSealedKnowledgeBindingV1 = Readonly<{
  schemaVersion: "waia.trader.historical_prerun_knowledge_bootstrap.v2";
  organizationId: string;
  runId: string;
  releaseSha: string;
  surfaceKey: string;
  selectedHypothesisType: HypothesisType;
  hypothesisId: string;
  hypothesisKey: string;
  hypothesisDefinitionDigest: string;
  hypothesisCreatedAt: string;
  lifecycleId: string;
  lifecycleContentDigest: string;
  lifecycleState: "VALIDATED";
  lifecycleCreatedAt: string;
  evidence: Readonly<{ id: string; contentDigest: string; eventTime: string;
    ingestTime: string; createdAt: string }>;
  observation: Readonly<{ id: string; contentDigest: string; eventTime: string;
    ingestTime: string; createdAt: string }>;
  trial: Readonly<{ id: string; contentDigest: string; eventTime: string;
    ingestTime: string; createdAt: string }>;
  predictionId: string;
  predictionSealDigestHex: string;
  edgeId: string;
  edgeSealDigestHex: string;
  marketPitBoundary: string;
  snapshotContentDigestHex: string;
}>;

export type CanonicalHypothesisRuntimeProjectionV1 = Readonly<{
  hypothesisType: HypothesisType;
  expectedPath: string;
}>;

export type FoldCanonicalRuntimeIntelligenceStateV1Input = Readonly<{
  context: OrgContext;
  symbol: string;
  /** Historical market-time boundary. Evidence/outcomes after it are never visible. */
  asOf: Date;
  /**
   * Optional database-availability boundary for an explicitly ratified historical replay.
   * It is deliberately distinct from market time: historical evidence may be ingested today,
   * so event/outcome time is bounded by `asOf` while ingest/created time is bounded by this
   * immutable ratification-authorized cutoff.
   */
  epistemicRecordCutoff?: Date;
  epistemicAuthority?: Readonly<{
    schemaVersion: "waia.trader.historical_four_surface_ratified_admission.v2";
    ratifiedAdmissionId: string;
    authorityContentDigestHex: string;
    createdAt: Date;
  }>;
  /** Require every resolved Knowledge edge to be backed by a confirmed market prediction. */
  requireMarketTimestampedKnowledge?: boolean;
  sealedHistoricalKnowledge?: CanonicalHistoricalSealedKnowledgeBindingV1;
  regimeScope?: string;
  projectHypothesis: (hypothesis: MiHypothesis, definition: HypothesisDefinition) => CanonicalHypothesisRuntimeProjectionV1 | null;
}>;

export type CanonicalRuntimeIntelligenceStateProviderV1 = (
  input: Omit<FoldCanonicalRuntimeIntelligenceStateV1Input, "projectHypothesis">,
) => Promise<RuntimeKnowledgeAuthorityV1>;

/** Bounded production composition point used by paper/live controllers. */
export function createCanonicalRuntimeIntelligenceStateProviderV1(
  deps: CanonicalRuntimeIntelligenceFoldDepsV1,
  projectHypothesis: FoldCanonicalRuntimeIntelligenceStateV1Input["projectHypothesis"],
): CanonicalRuntimeIntelligenceStateProviderV1 {
  return (input) => foldCanonicalRuntimeIntelligenceStateV1({ ...input, projectHypothesis }, deps);
}

const JUDGMENT_ORDER = { SUPPORTED: 0, CONTESTED: 1, WEAKENED: 2 } as const;

export async function foldCanonicalRuntimeIntelligenceStateV1(
  input: FoldCanonicalRuntimeIntelligenceStateV1Input,
  deps: CanonicalRuntimeIntelligenceFoldDepsV1,
): Promise<RuntimeKnowledgeAuthorityV1> {
  const epistemicRecordCutoff = input.epistemicRecordCutoff ?? input.asOf;
  if (
    !Number.isFinite(input.asOf.getTime()) ||
    !Number.isFinite(epistemicRecordCutoff.getTime()) ||
    epistemicRecordCutoff.getTime() < input.asOf.getTime() ||
    Boolean(input.epistemicRecordCutoff) !== Boolean(input.epistemicAuthority) ||
    (input.epistemicAuthority &&
      input.epistemicAuthority.createdAt.getTime() !== epistemicRecordCutoff.getTime())
  ) {
    throw new Error("[canonical-runtime-fold] invalid dual-time cutoff");
  }
  const snapshot = await deps.knowledgeSource.loadSnapshot(
    input.context,
    { symbol: input.symbol, regimeScope: input.regimeScope },
    epistemicRecordCutoff,
  );
  if (input.sealedHistoricalKnowledge && (
    input.sealedHistoricalKnowledge.organizationId !== input.context.organizationId ||
    input.sealedHistoricalKnowledge.marketPitBoundary !== input.asOf.toISOString() ||
    computeCanonicalHistoricalSealedKnowledgeSnapshotDigestV1(
      input.sealedHistoricalKnowledge,
    ) !== input.sealedHistoricalKnowledge.snapshotContentDigestHex
  )) {
    throw new Error("[canonical-runtime-fold] sealed knowledge snapshot binding mismatch");
  }
  if (input.sealedHistoricalKnowledge) {
    assertSealedKnowledgeRows(
      input, snapshot.knowledgeEdges, snapshot.marketPredictions, epistemicRecordCutoff,
    );
  }
  const rows = await deps.hypotheses.listHypotheses(input.context, "market_claim");
  if (rows.some((row) => row.organizationId !== input.context.organizationId)) {
    throw new Error("[canonical-runtime-fold] cross-organization hypothesis row");
  }

  const latest = new Map<string, MiHypothesis>();
  for (const row of rows) {
    if (row.schemaVersion !== MI_HYPOTHESIS_SCHEMA_VERSION) {
      throw new Error("[canonical-runtime-fold] unsupported hypothesis schema version");
    }
    if (row.createdAt.getTime() > epistemicRecordCutoff.getTime()) continue;
    const current = latest.get(row.hypothesisKey);
    if (!current || row.versionSeq > current.versionSeq || (row.versionSeq === current.versionSeq && row.id < current.id)) {
      latest.set(row.hypothesisKey, row);
    }
  }

  const candidates: RuntimeKnowledgeHypothesisV1[] = [];
  if (input.sealedHistoricalKnowledge && ![...latest.values()].some((hypothesis) =>
    hypothesis.id === input.sealedHistoricalKnowledge!.hypothesisId &&
    hypothesis.hypothesisKey === input.sealedHistoricalKnowledge!.hypothesisKey &&
    hypothesis.definitionDigest ===
      input.sealedHistoricalKnowledge!.hypothesisDefinitionDigest &&
    hypothesis.createdAt.toISOString() ===
      input.sealedHistoricalKnowledge!.hypothesisCreatedAt)) {
    throw new Error("[canonical-runtime-fold] sealed hypothesis authority mismatch");
  }
  for (const hypothesis of latest.values()) {
    const definition = parseDefinition(hypothesis);
    const sealed = input.sealedHistoricalKnowledge;
    if (sealed && (
      hypothesis.id !== sealed.hypothesisId || hypothesis.hypothesisKey !== sealed.hypothesisKey ||
      hypothesis.definitionDigest !== sealed.hypothesisDefinitionDigest
    )) continue;
    const projection = input.projectHypothesis(hypothesis, definition);
    if (!projection) continue;
    const lifecycleEvents = await deps.hypotheses.listLifecycleEvents(input.context, hypothesis.hypothesisKey);
    const lifecycle = lifecycleEvents
      .filter((row) => row.organizationId === input.context.organizationId && row.createdAt.getTime() <= epistemicRecordCutoff.getTime())
      .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
      .at(-1);
    if (!lifecycle) {
      throw new Error(`[canonical-runtime-fold] missing lifecycle for ${hypothesis.id}`);
    }
    if (sealed && (lifecycle.id !== sealed.lifecycleId ||
        lifecycle.contentDigest !== sealed.lifecycleContentDigest ||
        lifecycle.lifecycleState !== sealed.lifecycleState ||
        lifecycle.createdAt.toISOString() !== sealed.lifecycleCreatedAt)) {
      throw new Error(`[canonical-runtime-fold] sealed lifecycle mismatch for ${hypothesis.id}`);
    }
    const evidence = (await deps.evidence.listEvidence(input.context, hypothesis.hypothesisKey))
      .filter((row) => row.eventTime.getTime() <= input.asOf.getTime() &&
        row.ingestTime.getTime() <= epistemicRecordCutoff.getTime() &&
        row.createdAt.getTime() <= epistemicRecordCutoff.getTime())
      .filter((row) => !sealed || row.id === sealed.evidence.id)
      .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
    if (sealed) {
      const sealedEvidence = evidence.find((row) => row.id === sealed.evidence.id);
      if (!sealedEvidence || sealedEvidence.contentDigest !== sealed.evidence.contentDigest ||
          sealedEvidence.eventTime.toISOString() !== sealed.evidence.eventTime ||
          sealedEvidence.ingestTime.toISOString() !== sealed.evidence.ingestTime ||
          sealedEvidence.createdAt.toISOString() !== sealed.evidence.createdAt ||
          !deps.observations || !deps.trials) {
        throw new Error(`[canonical-runtime-fold] sealed evidence missing for ${hypothesis.id}`);
      }
      await assertSealedEvidenceLineage(input, deps, sealedEvidence, sealed);
    }
    for (const row of evidence) {
      if (row.organizationId !== input.context.organizationId || row.hypothesisId !== hypothesis.id || row.hypothesisDefinitionDigest !== hypothesis.definitionDigest) {
        throw new Error(`[canonical-runtime-fold] evidence lineage mismatch for ${row.id}`);
      }
    }
    const supportingEvidence = evidence.filter((row) => row.direction === "FOR").map(toEvidenceRef);
    const contradictingEvidence = evidence.filter((row) => row.direction === "AGAINST").map(toEvidenceRef);
    const knowledgeRefs = snapshot.knowledgeEdges
      .filter((edge) => edge.organizationId === input.context.organizationId &&
        edge.hypothesisId === hypothesis.id &&
        edge.updatedAt.getTime() <= epistemicRecordCutoff.getTime())
      .filter((edge) => !input.requireMarketTimestampedKnowledge || hasTimelyConfirmedPrediction(
        snapshot.marketPredictions,
        input.context.organizationId,
        hypothesis.id,
        edge.toRef,
        edge.fromRef,
        input.asOf,
        epistemicRecordCutoff,
        sealed,
      ))
      .filter((edge) => !sealed || (edge.id === sealed.edgeId &&
        sealHistoricalKnowledgeEdgeV1(edge) === sealed.edgeSealDigestHex))
      .map((edge) => ({ knowledgeEdgeId: edge.id, knowledgeState: classifyKnowledgeEdgeState(edge, epistemicRecordCutoff) }))
      .filter((ref) => ref.knowledgeState !== "INELIGIBLE" && ref.knowledgeState !== "OBSERVATION_ONLY")
      .sort((a, b) => a.knowledgeEdgeId.localeCompare(b.knowledgeEdgeId));
    const hasVerified = knowledgeRefs.some((ref) => ref.knowledgeState === "RESOLVED_CORRECT");
    const ordinalJudgment = hasVerified && supportingEvidence.length > contradictingEvidence.length
      ? "SUPPORTED"
      : contradictingEvidence.length > 0
        ? "CONTESTED"
        : "WEAKENED";
    candidates.push({
      hypothesisId: hypothesis.id,
      hypothesisKey: hypothesis.hypothesisKey,
      definitionDigest: hypothesis.definitionDigest,
      createdAt: hypothesis.createdAt.toISOString(),
      hypothesisType: projection.hypothesisType,
      lifecycleState: lifecycle.lifecycleState,
      rankOrdinal: -1,
      ordinalJudgment,
      expectedPath: projection.expectedPath,
      invalidationConditions: definition.falsificationConditions,
      supportingEvidence,
      contradictingEvidence,
      knowledgeRefs,
      supersedesHypothesisIds: parseSupersedes(hypothesis.supersedesJson),
    });
  }

  const hypotheses = candidates
    .sort((a, b) =>
      JUDGMENT_ORDER[a.ordinalJudgment] - JUDGMENT_ORDER[b.ordinalJudgment] ||
      b.supportingEvidence.length - a.supportingEvidence.length ||
      a.contradictingEvidence.length - b.contradictingEvidence.length ||
      a.hypothesisKey.localeCompare(b.hypothesisKey) ||
      a.hypothesisId.localeCompare(b.hypothesisId),
    )
    .map((row, rankOrdinal) => ({ ...row, rankOrdinal }));

  return buildCanonicalRuntimeIntelligenceStateV1({
    organizationId: input.context.organizationId,
    symbol: input.symbol,
    pitAnchor: input.asOf.toISOString(),
    ...(input.epistemicRecordCutoff
      ? { epistemicRecordCutoff: epistemicRecordCutoff.toISOString() }
      : {}),
    ...(input.epistemicAuthority ? {
      epistemicAuthority: {
        schemaVersion: input.epistemicAuthority.schemaVersion,
        ratifiedAdmissionId: input.epistemicAuthority.ratifiedAdmissionId,
        authorityContentDigestHex: input.epistemicAuthority.authorityContentDigestHex,
        createdAt: input.epistemicAuthority.createdAt.toISOString(),
      },
    } : {}),
    knowledgeSemanticDigest: snapshotDigest(
      snapshot,
      epistemicRecordCutoff,
      new Set(hypotheses.map((item) => item.hypothesisId)),
    ),
    hypotheses,
  });
}

export function computeCanonicalHistoricalSealedKnowledgeSnapshotDigestV1(
  sealed: Omit<CanonicalHistoricalSealedKnowledgeBindingV1, "snapshotContentDigestHex">,
): string {
  return computeSemanticSha256Hex({
    schemaVersion: sealed.schemaVersion,
    organizationId: sealed.organizationId,
    runId: sealed.runId,
    releaseSha: sealed.releaseSha,
    surfaceKey: sealed.surfaceKey,
    selectedHypothesisId: sealed.hypothesisId,
    selectedHypothesisKey: sealed.hypothesisKey,
    selectedHypothesisType: sealed.selectedHypothesisType,
    marketPitBoundary: sealed.marketPitBoundary,
    hypothesis: {
      id: sealed.hypothesisId,
      hypothesisKey: sealed.hypothesisKey,
      definitionDigest: sealed.hypothesisDefinitionDigest,
      createdAt: sealed.hypothesisCreatedAt,
    },
    lifecycle: {
      id: sealed.lifecycleId,
      contentDigest: sealed.lifecycleContentDigest,
      state: sealed.lifecycleState,
      createdAt: sealed.lifecycleCreatedAt,
    },
    trial: sealed.trial,
    observation: sealed.observation,
    evidence: sealed.evidence,
    prediction: { id: sealed.predictionId, sealDigestHex: sealed.predictionSealDigestHex },
    knowledgeEdge: { id: sealed.edgeId, sealDigestHex: sealed.edgeSealDigestHex },
  });
}

function assertSealedKnowledgeRows(
  input: FoldCanonicalRuntimeIntelligenceStateV1Input,
  edges: readonly KnowledgeEdge[],
  predictions: readonly MarketPrediction[],
  cutoff: Date,
): void {
  const sealed = input.sealedHistoricalKnowledge!;
  const edge = edges.find((row) => row.id === sealed.edgeId);
  const prediction = predictions.find((row) => row.id === sealed.predictionId);
  if (!edge || edge.organizationId !== input.context.organizationId ||
      edge.hypothesisId !== sealed.hypothesisId ||
      edge.toRef !== `hypothesis:${sealed.hypothesisId}` ||
      edge.fromRef !== `market_prediction:${sealed.predictionId}` ||
      edge.createdAt.getTime() > cutoff.getTime() ||
      edge.updatedAt.getTime() > cutoff.getTime() || !edge.verified ||
      sealHistoricalKnowledgeEdgeV1(edge) !== sealed.edgeSealDigestHex) {
    throw new Error("[canonical-runtime-fold] sealed knowledge edge authority mismatch");
  }
  if (!prediction || prediction.organizationId !== input.context.organizationId ||
      prediction.subjectRef !== `hypothesis:${sealed.hypothesisId}` ||
      prediction.createdAt.getTime() > cutoff.getTime() ||
      prediction.predictedAt.getTime() > input.asOf.getTime() ||
      prediction.verifiedAt === null ||
      prediction.verifiedAt.getTime() > input.asOf.getTime() ||
      prediction.verificationResult !== "confirmed" ||
      sealHistoricalMarketPredictionV1(prediction) !== sealed.predictionSealDigestHex) {
    throw new Error("[canonical-runtime-fold] sealed market prediction authority mismatch");
  }
}

export function sealHistoricalMarketPredictionV1(prediction: MarketPrediction): string {
  return computeSemanticSha256Hex({
    schemaVersion: "waia.trader.historical_market_prediction_seal.v1",
    id: prediction.id,
    organizationId: prediction.organizationId,
    subjectRef: prediction.subjectRef,
    predictionJson: prediction.predictionJson,
    predictedAt: prediction.predictedAt.toISOString(),
    outcomeJson: prediction.outcomeJson,
    verifiedAt: prediction.verifiedAt?.toISOString() ?? null,
    verificationResult: prediction.verificationResult,
    contentDigest: prediction.contentDigest,
    createdAt: prediction.createdAt.toISOString(),
  });
}

export function sealHistoricalKnowledgeEdgeV1(edge: KnowledgeEdge): string {
  return computeSemanticSha256Hex({
    schemaVersion: "waia.trader.historical_knowledge_edge_seal.v1",
    id: edge.id,
    organizationId: edge.organizationId,
    fromRef: edge.fromRef,
    toRef: edge.toRef,
    relationKind: edge.relationKind,
    confidence: edge.confidence,
    strength: edge.strength,
    regimeScope: edge.regimeScope,
    failureCasesJson: edge.failureCasesJson,
    hypothesisId: edge.hypothesisId,
    verified: edge.verified,
    createdAt: edge.createdAt.toISOString(),
    updatedAt: edge.updatedAt.toISOString(),
  });
}

async function assertSealedEvidenceLineage(
  input: FoldCanonicalRuntimeIntelligenceStateV1Input,
  deps: CanonicalRuntimeIntelligenceFoldDepsV1,
  evidence: Awaited<ReturnType<MiEvidenceRepository["listEvidence"]>>[number],
  sealed: CanonicalHistoricalSealedKnowledgeBindingV1,
): Promise<void> {
  let refs: unknown;
  try { refs = JSON.parse(evidence.observationRefsJson); } catch { refs = null; }
  if (!Array.isArray(refs) || refs.length !== 1 ||
      (refs[0] as { observationId?: unknown }).observationId !== sealed.observation.id ||
      evidence.trialRegistrationRef !== sealed.trial.id) {
    throw new Error("[canonical-runtime-fold] sealed observation/trial references mismatch");
  }
  const observation = await deps.observations!.findObservationById(
    input.context, sealed.observation.id,
  );
  const trial = await deps.trials!.findTrialById(input.context, sealed.trial.id);
  const cutoff = input.epistemicRecordCutoff!;
  if (!observation || observation.organizationId !== input.context.organizationId ||
      observation.contentDigest !== sealed.observation.contentDigest ||
      observation.eventTime.toISOString() !== sealed.observation.eventTime ||
      observation.ingestTime.toISOString() !== sealed.observation.ingestTime ||
      observation.createdAt.toISOString() !== sealed.observation.createdAt ||
      observation.eventTime.getTime() > input.asOf.getTime() ||
      observation.ingestTime.getTime() > cutoff.getTime() ||
      observation.createdAt.getTime() > cutoff.getTime()) {
    throw new Error("[canonical-runtime-fold] sealed observation authority mismatch");
  }
  if (!trial || trial.organizationId !== input.context.organizationId ||
      trial.hypothesisId !== sealed.hypothesisId ||
      trial.hypothesisDefinitionDigest !== sealed.hypothesisDefinitionDigest ||
      trial.contentDigest !== sealed.trial.contentDigest ||
      trial.eventTime.toISOString() !== sealed.trial.eventTime ||
      trial.ingestTime.toISOString() !== sealed.trial.ingestTime ||
      trial.createdAt.toISOString() !== sealed.trial.createdAt ||
      trial.eventTime.getTime() > input.asOf.getTime() ||
      trial.ingestTime.getTime() > cutoff.getTime() || trial.createdAt.getTime() > cutoff.getTime()) {
    throw new Error("[canonical-runtime-fold] sealed trial authority mismatch");
  }
}

function hasTimelyConfirmedPrediction(
  predictions: Awaited<ReturnType<MkbReadModelSource["loadSnapshot"]>>["marketPredictions"],
  organizationId: string,
  hypothesisId: string,
  toRef: string,
  fromRef: string,
  marketAsOf: Date,
  epistemicRecordCutoff: Date,
  sealed?: CanonicalHistoricalSealedKnowledgeBindingV1,
): boolean {
  const match = /^market_prediction:([0-9a-f-]{36})$/i.exec(fromRef);
  if (!match) return false;
  const prediction = predictions.find((row) => row.id === match[1]);
  const edgePredictionMatchesSeal = !sealed || (
    prediction?.id === sealed.predictionId &&
    sealHistoricalMarketPredictionV1(prediction) === sealed.predictionSealDigestHex
  );
  return Boolean(
    prediction && prediction.organizationId === organizationId &&
    prediction.subjectRef === `hypothesis:${hypothesisId}` &&
    toRef === `hypothesis:${hypothesisId}` &&
    prediction.createdAt.getTime() <= epistemicRecordCutoff.getTime() &&
    prediction.predictedAt.getTime() <= marketAsOf.getTime() &&
    prediction.verifiedAt !== null && prediction.verifiedAt.getTime() <= marketAsOf.getTime() &&
    prediction.verificationResult === "confirmed" && edgePredictionMatchesSeal,
  );
}

function toEvidenceRef(row: Awaited<ReturnType<MiEvidenceRepository["listEvidence"]>>[number]) {
  return { evidenceId: row.id, contentDigest: row.contentDigest, direction: row.direction, eventTime: row.eventTime.toISOString(), ingestTime: row.ingestTime.toISOString() } as const;
}

function parseDefinition(hypothesis: MiHypothesis): HypothesisDefinition {
  try {
    return JSON.parse(hypothesis.definitionJson) as HypothesisDefinition;
  } catch {
    throw new Error(`[canonical-runtime-fold] invalid definition JSON for ${hypothesis.id}`);
  }
}

function parseSupersedes(value: string | null): readonly string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error();
    return [...parsed].sort();
  } catch {
    throw new Error("[canonical-runtime-fold] invalid supersession JSON");
  }
}

function snapshotDigest(
  snapshot: Awaited<ReturnType<MkbReadModelSource["loadSnapshot"]>>,
  asOf: Date,
  hypothesisIds: ReadonlySet<string>,
): string {
  const payload = JSON.stringify({
    asOf: asOf.toISOString(),
    knowledgeEdges: snapshot.knowledgeEdges
      .filter((edge) => edge.hypothesisId !== null && hypothesisIds.has(edge.hypothesisId) && edge.updatedAt.getTime() <= asOf.getTime())
      .map((edge) => ({ id: edge.id, hypothesisId: edge.hypothesisId, verified: edge.verified, createdAt: edge.createdAt.toISOString(), updatedAt: edge.updatedAt.toISOString() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    marketPredictions: snapshot.marketPredictions
      .filter((prediction) => hypothesisIds.has(
        prediction.subjectRef.replace(/^hypothesis:/, ""),
      ) && prediction.createdAt.getTime() <= asOf.getTime())
      .map((prediction) => ({
        id: prediction.id,
        organizationId: prediction.organizationId,
        subjectRef: prediction.subjectRef,
        predictedAt: prediction.predictedAt.toISOString(),
        verifiedAt: prediction.verifiedAt?.toISOString() ?? null,
        verificationResult: prediction.verificationResult,
        contentDigest: prediction.contentDigest,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
