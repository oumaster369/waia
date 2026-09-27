import { createHash } from "node:crypto";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { buildHypothesisDefinitionDigest, computeHypothesisKey, buildLifecycleContentDigest, deriveMandatoryNullFloor, findForbiddenDefinitionKey } from "@/lib/trader/mi/serialize-hypothesis";
import { buildMeasurementDigestFromDefinition, computeMeasurementKey } from "@/lib/trader/mi/serialize-measurement";
import { miHypothesisNullKindValues, type HypothesisDefinition, type MiHypothesis, type MiHypothesisLifecycleEvent } from "@/lib/trader/mi/hypothesis.types";
import type { MiMeasurement, MeasurementDefinition } from "@/lib/trader/mi/measurement.types";
import type { ResearchEvaluation } from "../research-understanding-v1/evaluate";
import { partitionDirectionalEvidenceV1, judgeDirectionalEvidenceV1, rankEvidenceJudgmentsV1 } from "@/lib/trader/intelligence/hypothesis/evidence-judgment-kernel-v1";
import { selectByKnowledgePolicyV2 } from "@/lib/trader/knowledge/navigator/selection-kernel-v2";
import { APPLICATION_AUTHORITY, APPLICATION_BRIDGE, APPLICATION_LIMITS, APPLICATION_PURPOSE, APPLICATION_QUESTION_MAP, APPLICATION_SPECIFICATION,
  applicationBytes, applicationDigest, applicationTime, captureApplicationConfigurationV1, requireApplication, ResearchApplicationRefusal,
  type ResearchApplicationConfigurationV1, type ResearchApplicationMeaningV1, type ReplayedApplicationPairV1,
  type ResearchApplicationRelationV1, type ResearchApplicationFoldV1 } from "./contract";

export const CATEGORICAL_MEASUREMENT_NAME = "understanding.regimeHint / categorical-observable-v1";
export function categoricalMeasurementDefinitionV1(): MeasurementDefinition {
  return { inputs: { observationKinds: ["msv_envelope"] }, outputType: "regime-hint-enum/v1",
    params: { selector: "understanding.regimeHint", selectorVersion: "categorical-observable/v1" },
    description: "Select the existing categorical regimeHint field; no regime recomputation, price forecast, probability or confidence interpretation." };
}
/** Explicit existing prior/null configuration only: this is not a registration or default. */
export function categoricalHypothesisDefinitionV1(config: Pick<ResearchApplicationConfigurationV1, "symbol" | "computation" | "computationManifestDigest" | "measurementKey" | "measurementDefinitionDigest">,
  prior: HypothesisDefinition["prior"], requiredNulls: HypothesisDefinition["requiredNulls"]): HypothesisDefinition {
  requireApplication(typeof prior?.ordinal === "string" && prior.ordinal.length > 0 && typeof prior?.band === "string" && prior.band.length > 0, "APPLICATION_PRIOR_REQUIRED");
  const claimShape = { relationshipType: "predictive" as const, isDirectional: false, isTrendEdge: true, isTimingEdge: false };
  requireApplication(Array.isArray(requiredNulls) && requiredNulls.every(n => miHypothesisNullKindValues.includes(n)) &&
    deriveMandatoryNullFloor(claimShape).every(n => requiredNulls.includes(n)), "APPLICATION_NULL_FLOOR_REQUIRED");
  return { claimShape, prior: { ...prior }, requiredNulls: [...requiredNulls], patternRefs: [],
    measurementRefs: [{ measurementKey: config.measurementKey, measurementDefinitionDigest: config.measurementDefinitionDigest }],
    falsificationConditions: ["An eligible consecutive pair whose first assessed category is TRENDING and whose next assessed category is RANGING, CHOPPING, or STRESSED contradicts this categorical-persistence claim."],
    regimeScope: { description: "For an eligible consecutive pair under categorical-trending-persistence/v1, if the first saved WHAT category is TRENDING, the next saved WHAT category is TRENDING.",
      notes: canonicalJsonString({ application: APPLICATION_SPECIFICATION, symbol: config.symbol, computation: config.computation,
        computationManifest: config.computationManifestDigest, measurementKey: config.measurementKey, measurementDefinitionDigest: config.measurementDefinitionDigest,
        limitation: "categorical-label claim; no price direction, return, probability or execution authority" }) } };
}
export const categoricalHypothesisNameV1 = (symbol: string) => `Categorical TRENDING persistence to the next saved packet / v1 / ${symbol}`;
type VersionMetadata = Pick<MiHypothesis, "id" | "organizationId" | "hypothesisKey" | "versionSeq" | "definitionDigest" | "createdAt">;
export type ApplicationRegistrationReadSetV1 = Readonly<{ hypothesis: MiHypothesis; measurement: MiMeasurement;
  versions: readonly VersionMetadata[]; lifecycles: readonly MiHypothesisLifecycleEvent[] }>;

function registryBody<T>(json: string): T {
  let body: unknown;
  try { body = JSON.parse(json); } catch { throw new ResearchApplicationRefusal("APPLICATION_REGISTRY_JSON_INVALID"); }
  requireApplication(body !== null && typeof body === "object" && !Array.isArray(body), "APPLICATION_REGISTRY_JSON_INVALID");
  return body as T;
}

/** Checks the already bounded selected read set. Does not grant writer or current-frontier authority. */
export function assertCategoricalRegistrationV1(input: ResearchApplicationConfigurationV1, read: ApplicationRegistrationReadSetV1, cutoffs: readonly string[]): HypothesisDefinition {
  const c = captureApplicationConfigurationV1(input), { hypothesis: h, measurement: m } = read;
  requireApplication(cutoffs.length >= 1 && cutoffs.length <= 3, "APPLICATION_CUTOFF_COUNT");
  requireApplication(read.versions.length <= APPLICATION_LIMITS.selectedHistory && read.lifecycles.length <= APPLICATION_LIMITS.selectedHistory, "APPLICATION_REGISTRY_HISTORY_LIMIT");
  requireApplication(applicationBytes({ ...h, createdAt: h.createdAt.toISOString() }) <= APPLICATION_LIMITS.registration &&
    applicationBytes({ ...m, createdAt: m.createdAt.toISOString() }) <= APPLICATION_LIMITS.measurement, "APPLICATION_REGISTRY_ROW_LIMIT");
  requireApplication(h.organizationId === c.organizationId && h.id === c.hypothesisId && h.hypothesisKey === c.hypothesisKey && h.versionSeq === c.hypothesisVersion &&
    h.definitionDigest === c.hypothesisDefinitionDigest && h.hypothesisKind === "market_claim" && h.schemaVersion === "mi-hypothesis-v1" &&
    h.name === categoricalHypothesisNameV1(c.symbol) && (h.supersedesJson === null || h.supersedesJson === "[]"), "APPLICATION_HYPOTHESIS_CONFLICT");
  requireApplication(m.organizationId === c.organizationId && m.id === c.measurementId && m.measurementKey === c.measurementKey && m.versionSeq === c.measurementVersion &&
    m.definitionDigest === c.measurementDefinitionDigest && m.measurementKind === "feature_transform" && m.schemaVersion === "mi-measurement-v1" && m.name === CATEGORICAL_MEASUREMENT_NAME, "APPLICATION_MEASUREMENT_CONFLICT");
  const definition = registryBody<HypothesisDefinition>(h.definitionJson);
  requireApplication(findForbiddenDefinitionKey(definition) === null, "APPLICATION_DEFINITION_FIREWALL");
  const expected = categoricalHypothesisDefinitionV1(c, definition.prior, definition.requiredNulls);
  requireApplication(applicationDigest(definition) === applicationDigest(expected) && computeHypothesisKey(h) === h.hypothesisKey &&
    buildHypothesisDefinitionDigest({ ...h, definition }) === h.definitionDigest, "APPLICATION_DEFINITION_CONFLICT");
  const measurementDefinition = registryBody<MeasurementDefinition>(m.definitionJson);
  requireApplication(applicationDigest(measurementDefinition) === applicationDigest(categoricalMeasurementDefinitionV1()) && computeMeasurementKey(m) === m.measurementKey &&
    buildMeasurementDigestFromDefinition({ ...m, definition: measurementDefinition }) === m.definitionDigest, "APPLICATION_MEASUREMENT_DEFINITION_CONFLICT");
  for (const row of read.versions) requireApplication(row.organizationId === c.organizationId && row.hypothesisKey === c.hypothesisKey &&
    Number.isSafeInteger(row.versionSeq) && row.versionSeq > 0 && Number.isFinite(row.createdAt.getTime()), "APPLICATION_VERSION_SCOPE_CONFLICT");
  for (const row of read.lifecycles) requireApplication(row.organizationId === c.organizationId && row.hypothesisKey === c.hypothesisKey &&
    Number.isSafeInteger(row.seq) && row.seq > 0 && Number.isFinite(row.createdAt.getTime()) && buildLifecycleContentDigest(row) === row.contentDigest &&
    read.versions.some(v => v.id === row.hypothesisId && v.createdAt.getTime() <= row.createdAt.getTime()), "APPLICATION_LIFECYCLE_CONFLICT");
  for (const cutoff of cutoffs) {
    const time = applicationTime(cutoff);
    requireApplication(h.createdAt.getTime() <= time && m.createdAt.getTime() <= time, "APPLICATION_REGISTRATION_NOT_VISIBLE");
    const latest = read.versions.filter(r => r.createdAt.getTime() <= time).sort((a, b) => b.versionSeq - a.versionSeq || a.id.localeCompare(b.id))[0];
    requireApplication(latest?.id === h.id && latest.versionSeq === h.versionSeq && latest.definitionDigest === h.definitionDigest && latest.createdAt.getTime() === h.createdAt.getTime(), "APPLICATION_VERSION_NOT_SELECTED");
    const lifecycle = read.lifecycles.filter(r => r.createdAt.getTime() <= time).sort((a, b) => b.seq - a.seq || b.id.localeCompare(a.id))[0];
    // Existing lifecycle is family-owned. appendHypothesisVersion does not create a new event;
    // preserve that contract while retaining the actual lifecycle-to-version identity above.
    requireApplication(lifecycle?.lifecycleState === "PROPOSED", "APPLICATION_LIFECYCLE_NOT_PROPOSED");
  }
  return structuredClone(definition);
}

/** A fixed replay caller supplies entire evaluated bodies, never a label/confidence projection. */
export function assessedSavedWhatV1(value: ResearchEvaluation): string | null {
  const { contentDigest, ...body } = value;
  requireApplication(createHash("sha256").update(canonicalJsonString(body)).digest("hex") === contentDigest && value.schemaVersion === "waia.trader.saved_research_understanding.v1", "APPLICATION_EVALUATION_INTEGRITY");
  requireApplication(value.artifact.claims.length === 12 && new Set(value.artifact.claims.map(c => c.marketQuestionId)).size === 12, "APPLICATION_QUESTION_SET_CONFLICT");
  const claims = value.artifact.claims.filter(c => c.marketQuestionId === "Q_WHAT_HAPPENING");
  const questions = value.questionEvaluations.filter(q => q.questionId === "Q_WHAT_HAPPENING");
  requireApplication(claims.length === 1 && questions.length === 1, "APPLICATION_WHAT_CONFLICT");
  const claim = claims[0]!, question = questions[0]!;
  requireApplication(["TRENDING", "RANGING", "CHOPPING", "STRESSED", "UNCLEAR"].includes(question.answerSummary), "APPLICATION_CATEGORY_INVALID");
  const supported = claim.claimState === "SUPPORTED" && question.status === "ANSWERED" && question.answerSummary !== "UNCLEAR" && value.receipt.status === "SUFFICIENT";
  requireApplication((value.disposition === "COMPLETED_SUPPORTED") === supported, "APPLICATION_SUPPORT_CONFLICT");
  return supported ? question.answerSummary : null;
}
export function evaluateCategoricalApplicationMeaningV1(pair: ReplayedApplicationPairV1): ResearchApplicationMeaningV1 {
  const p = pair.previous, a = pair.current;
  requireApplication(p.assignmentDigest === a.assignmentDigest && applicationDigest(p.declarations) === applicationDigest(a.declarations) &&
    applicationTime(p.analysisPitAnchor) < applicationTime(a.analysisPitAnchor), "APPLICATION_PAIR_SCOPE_CONFLICT");
  const before = assessedSavedWhatV1(p), after = assessedSavedWhatV1(a);
  const disposition = before === null || after === null ? "UNASSESSED_INPUT" : before !== "TRENDING" ? "UNASSESSED_ANTECEDENT"
    : after === "TRENDING" ? "OBSERVED_FOR" : "OBSERVED_AGAINST";
  return { schemaVersion: "waia.trader.research_application_meaning.v1", authority: APPLICATION_AUTHORITY, purpose: APPLICATION_PURPOSE,
    specification: APPLICATION_SPECIFICATION, bridge: APPLICATION_BRIDGE, previousEvaluationDigest: p.contentDigest, currentEvaluationDigest: a.contentDigest, disposition,
    direction: disposition === "OBSERVED_FOR" ? "FOR" : disposition === "OBSERVED_AGAINST" ? "AGAINST" : null,
    relationKind: disposition === "OBSERVED_FOR" ? "observed_categorical_persistence_for/v1" : disposition === "OBSERVED_AGAINST" ? "observed_categorical_persistence_against/v1" : null };
}

/** Pure policy reuse over an owner-validated relation. No DB read, fact construction or authority assertion. */
export function foldResearchApplicationRelationV1(relation: ResearchApplicationRelationV1): ResearchApplicationFoldV1 {
  requireApplication(relation.schemaVersion === "waia.trader.research_application_relation.v1" && relation.authority === APPLICATION_AUTHORITY &&
    relation.purpose === APPLICATION_PURPOSE && relation.version === 1 && relation.verified === false && relation.confidenceState === "NOT_ASSESSED" &&
    ["observed_categorical_persistence_for/v1", "observed_categorical_persistence_against/v1"].includes(relation.relationKind), "APPLICATION_RELATION_INVALID");
  const direction = relation.relationKind === "observed_categorical_persistence_for/v1" ? "FOR" : "AGAINST";
  const parts = partitionDirectionalEvidenceV1([{ id: relation.evidenceId, direction }]);
  const ordinalJudgment = judgeDirectionalEvidenceV1(false, parts.supportingEvidence.length, parts.contradictingEvidence.length);
  requireApplication(ordinalJudgment !== "SUPPORTED", "APPLICATION_AUTHORITY_WIDENING");
  return { schemaVersion: "waia.trader.research_application_fold.v1", authority: APPLICATION_AUTHORITY, purpose: APPLICATION_PURPOSE,
    researchJudgments: rankEvidenceJudgmentsV1([{ hypothesisId: relation.hypothesisId, hypothesisKey: relation.hypothesisKey, definitionDigest: relation.hypothesisDefinitionDigest,
      lifecycleState: "PROPOSED" as const, ordinalJudgment, supportingEvidence: parts.supportingEvidence.map(e => e.id), contradictingEvidence: parts.contradictingEvidence.map(e => e.id) }]) };
}

export function selectResearchApplicationRelationV1(input: { config: ResearchApplicationConfigurationV1; applicationId: string;
  relation: ResearchApplicationRelationV1; availabilityTime: string; consumer: ResearchEvaluation }) {
  const c = captureApplicationConfigurationV1(input.config), r = input.relation;
  // Validate intrinsic research scope even on a non-supporting consumer; never silently reinterpret an ordinary edge.
  foldResearchApplicationRelationV1(r);
  requireApplication(r.organizationId === c.organizationId && r.symbol === c.symbol && r.applicationId === input.applicationId &&
    r.assignmentDigest === applicationDigest(c) && r.hypothesisId === c.hypothesisId && r.hypothesisKey === c.hypothesisKey && r.hypothesisDefinitionDigest === c.hypothesisDefinitionDigest &&
    input.consumer.assignmentDigest === c.researchAssignmentDigest, "APPLICATION_RELATION_SCOPE_CONFLICT");
  const event = applicationTime(r.eventTime), recorded = applicationTime(r.recordedTime), available = applicationTime(input.availabilityTime), cutoff = applicationTime(input.consumer.analysisPitAnchor);
  requireApplication(recorded > event && available >= recorded && cutoff > available, "APPLICATION_NOT_YET_AVAILABLE");
  const antecedent = assessedSavedWhatV1(input.consumer);
  const policy = selectByKnowledgePolicyV2({ organizationId: c.organizationId, runId: input.applicationId, symbol: c.symbol, purpose: APPLICATION_PURPOSE,
    questionId: "Q_HISTORICAL_ANALOGUES", pitAnchor: input.consumer.analysisPitAnchor, evidenceBudget: 1, maxStalenessMs: c.maxAgeMs,
    candidates: antecedent === "TRENDING" ? [{ knowledgeEdgeId: r.id, version: r.version, contentDigestHex: r.contentDigest, organizationId: r.organizationId, symbol: r.symbol,
      questionId: "Q_HISTORICAL_ANALOGUES", pitEventAt: r.eventTime, lifecycleState: "ACTIVE", verified: false,
      fromRef: `research_application:${r.applicationId}`, toRef: `hypothesis:${r.hypothesisId}`, relationKind: r.relationKind }] : [] });
  return { schemaVersion: "waia.trader.research_application_selection.v1" as const, authority: APPLICATION_AUTHORITY, purpose: APPLICATION_PURPOSE,
    questionMap: APPLICATION_QUESTION_MAP, applicationId: input.applicationId, assignmentDigest: applicationDigest(c), consumerEvaluationDigest: input.consumer.contentDigest,
    disposition: antecedent === "TRENDING" ? "ASSESSED" as const : "UNASSESSED_ANTECEDENT" as const,
    // Kernel field names stay internal; the public research receipt cannot masquerade as a Knowledge receipt.
    policyOutcome: policy.outcome, selectedRelations: policy.selected.map(v => ({ relationId: v.knowledgeEdgeId, version: v.version, contentDigest: v.contentDigestHex })),
    rejectedRelations: policy.rejected.map(v => ({ relationId: v.knowledgeEdgeId, version: v.version, reason: v.reason })) };
}
