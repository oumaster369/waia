import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  RUNTIME_KNOWLEDGE_DERIVATION_VERSION,
  assertCanonicalRuntimeIntelligenceStateV1,
  type CanonicalRuntimeIntelligenceStateV1,
  type RuntimeKnowledgeHypothesisV1,
} from "@/lib/trader/intelligence/hypothesis/runtime-knowledge-authority-v1";

export const CANONICAL_CAUSAL_LINEAGE_SCHEMA_VERSION =
  "waia.trader.canonical_causal_lineage.v1" as const;
export const CANONICAL_CAUSAL_LINEAGE_DERIVATION_VERSION = "dee-626-causal-lineage/v1" as const;

export type CanonicalCausalLineageV1 = Readonly<{
  schemaVersion: typeof CANONICAL_CAUSAL_LINEAGE_SCHEMA_VERSION;
  derivationVersion: typeof CANONICAL_CAUSAL_LINEAGE_DERIVATION_VERSION;
  runtimeKnowledgeDerivationVersion: typeof RUNTIME_KNOWLEDGE_DERIVATION_VERSION;
  organizationId: string;
  symbol: string;
  pitAnchor: string;
  /** Historical replay only; absent preserves byte parity for live/legacy lineages. */
  epistemicRecordCutoff?: string;
  /** Durable authority that authenticates the historical dual-time cutoff. */
  epistemicAuthority?: NonNullable<CanonicalRuntimeIntelligenceStateV1["epistemicAuthority"]>;
  hypothesisCausalStateDigest: string;
  hypothesisId: string;
  hypothesisDefinitionDigest: string;
  supportingEvidence: RuntimeKnowledgeHypothesisV1["supportingEvidence"];
  contradictingEvidence: RuntimeKnowledgeHypothesisV1["contradictingEvidence"];
  knowledgeRefs: RuntimeKnowledgeHypothesisV1["knowledgeRefs"];
  invalidationConditions: readonly string[];
  supersedesHypothesisIds: readonly string[];
  contentDigest: string;
}>;

type LineageBody = Omit<CanonicalCausalLineageV1, "contentDigest">;

const LINEAGE_KEYS = ["schemaVersion", "derivationVersion", "runtimeKnowledgeDerivationVersion", "organizationId", "symbol", "pitAnchor", "hypothesisCausalStateDigest", "hypothesisId", "hypothesisDefinitionDigest", "supportingEvidence", "contradictingEvidence", "knowledgeRefs", "invalidationConditions", "supersedesHypothesisIds", "contentDigest"].sort();
const HISTORICAL_LINEAGE_KEYS = [
  ...LINEAGE_KEYS,
  "epistemicRecordCutoff",
  "epistemicAuthority",
].sort();
const EVIDENCE_KEYS = ["evidenceId", "contentDigest", "direction", "eventTime", "ingestTime"].sort();
const KNOWLEDGE_KEYS = ["knowledgeEdgeId", "knowledgeState"].sort();
const EPISTEMIC_AUTHORITY_KEYS = [
  "schemaVersion",
  "ratifiedAdmissionId",
  "authorityContentDigestHex",
  "createdAt",
].sort();
const KNOWLEDGE_STATES = new Set(["OBSERVATION_ONLY", "RESOLVED_CORRECT", "RESOLVED_INCORRECT", "UNRESOLVED", "INSUFFICIENT_EVIDENCE", "STALE", "INELIGIBLE"]);

function exactKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function hypothesisCausalStateDigest(hypothesis: RuntimeKnowledgeHypothesisV1): string {
  return createHash("sha256").update(canonicalizeSemanticJsonString(hypothesis), "utf8").digest("hex");
}

function digest(body: LineageBody): string {
  return createHash("sha256")
    .update(canonicalizeSemanticJsonString(body), "utf8")
    .digest("hex");
}

export function serializeCanonicalCausalLineageV1(lineage: CanonicalCausalLineageV1): string {
  return canonicalizeSemanticJsonString(lineage);
}

export function parseCanonicalCausalLineageV1(value: string): CanonicalCausalLineageV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_INVALID_JSON");
  }
  const lineage = parsed as CanonicalCausalLineageV1;
  const expectedKeys = lineage.epistemicRecordCutoff === undefined &&
      lineage.epistemicAuthority === undefined
    ? LINEAGE_KEYS
    : HISTORICAL_LINEAGE_KEYS;
  if (!exactKeys(lineage, expectedKeys)) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_UNEXPECTED_FIELD");
  }
  assertCanonicalCausalLineageV1(lineage);
  if (serializeCanonicalCausalLineageV1(lineage) !== value) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_NON_CANONICAL_JSON");
  }
  return lineage;
}

export function assertCanonicalCausalLineageV1(
  lineage: CanonicalCausalLineageV1,
  cutoffAt = lineage.pitAnchor,
): void {
  if (
    lineage.schemaVersion !== CANONICAL_CAUSAL_LINEAGE_SCHEMA_VERSION ||
    lineage.derivationVersion !== CANONICAL_CAUSAL_LINEAGE_DERIVATION_VERSION ||
    lineage.runtimeKnowledgeDerivationVersion !== RUNTIME_KNOWLEDGE_DERIVATION_VERSION
  ) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_UNSUPPORTED_VERSION");
  }
  if (
    !lineage.organizationId ||
    !lineage.symbol ||
    !lineage.hypothesisCausalStateDigest ||
    !lineage.hypothesisId ||
    !lineage.hypothesisDefinitionDigest
  ) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_INCOMPLETE");
  }
  const cutoff = Date.parse(cutoffAt);
  if (!Number.isFinite(cutoff) || lineage.pitAnchor !== cutoffAt) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_CUTOFF_MISMATCH");
  }
  const epistemicRecordCutoff = lineage.epistemicRecordCutoff as unknown;
  const epistemicAuthority = lineage.epistemicAuthority as unknown;
  const hasEpistemicCutoff = epistemicRecordCutoff !== undefined;
  const hasEpistemicAuthority = epistemicAuthority !== undefined;
  if (hasEpistemicCutoff !== hasEpistemicAuthority) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_EPISTEMIC_AUTHORITY_INVALID");
  }
  const epistemicCutoff = hasEpistemicCutoff
    && typeof epistemicRecordCutoff === "string"
    ? Date.parse(epistemicRecordCutoff)
    : cutoff;
  const authority = epistemicAuthority as NonNullable<
    CanonicalCausalLineageV1["epistemicAuthority"]
  >;
  if (
    (hasEpistemicCutoff && typeof epistemicRecordCutoff !== "string") ||
    !Number.isFinite(epistemicCutoff) ||
    epistemicCutoff < cutoff ||
    (hasEpistemicAuthority && (
      !epistemicAuthority ||
      typeof epistemicAuthority !== "object" ||
      Array.isArray(epistemicAuthority) ||
      !exactKeys(epistemicAuthority, EPISTEMIC_AUTHORITY_KEYS) ||
      authority.schemaVersion !==
          "waia.trader.historical_four_surface_ratified_admission.v2" ||
      authority.createdAt !== epistemicRecordCutoff ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(authority.ratifiedAdmissionId) ||
        !/^[0-9a-f]{64}$/.test(
          authority.authorityContentDigestHex,
        )
    ))
  ) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_EPISTEMIC_AUTHORITY_INVALID");
  }
  if (!Array.isArray(lineage.supportingEvidence) || !Array.isArray(lineage.contradictingEvidence) || !Array.isArray(lineage.knowledgeRefs)) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_INCOMPLETE");
  }
  const evidenceIds = new Set<string>();
  for (const evidence of [...lineage.supportingEvidence, ...lineage.contradictingEvidence]) {
    if (!evidence || typeof evidence !== "object" || !exactKeys(evidence, EVIDENCE_KEYS) || evidenceIds.has(evidence.evidenceId)) {
      throw new Error("CANONICAL_CAUSAL_LINEAGE_EVIDENCE_INVALID");
    }
    evidenceIds.add(evidence.evidenceId);
    const eventTime = Date.parse(evidence.eventTime);
    const ingestTime = Date.parse(evidence.ingestTime);
    if (
      !evidence.evidenceId ||
      !evidence.contentDigest ||
      !Number.isFinite(eventTime) ||
      !Number.isFinite(ingestTime) ||
      eventTime > cutoff ||
      ingestTime > epistemicCutoff
    ) {
      throw new Error("CANONICAL_CAUSAL_LINEAGE_EVIDENCE_INVALID");
    }
  }
  if (lineage.supportingEvidence.some((item) => item.direction !== "FOR") || lineage.contradictingEvidence.some((item) => item.direction !== "AGAINST")) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_EVIDENCE_INVALID");
  }
  const knowledgeIds = new Set<string>();
  for (const ref of lineage.knowledgeRefs) {
    if (!ref || typeof ref !== "object" || !exactKeys(ref, KNOWLEDGE_KEYS) || !ref.knowledgeEdgeId || !KNOWLEDGE_STATES.has(ref.knowledgeState) || knowledgeIds.has(ref.knowledgeEdgeId)) {
      throw new Error("CANONICAL_CAUSAL_LINEAGE_KNOWLEDGE_REF_INVALID");
    }
    knowledgeIds.add(ref.knowledgeEdgeId);
  }
  if (!Array.isArray(lineage.invalidationConditions) || !lineage.invalidationConditions.every((item) => typeof item === "string" && item.length > 0) || !Array.isArray(lineage.supersedesHypothesisIds) || !lineage.supersedesHypothesisIds.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_HYPOTHESIS_REF_INVALID");
  }
  const body = Object.fromEntries(
    Object.entries(lineage).filter(([key]) => key !== "contentDigest"),
  ) as LineageBody;
  if (digest(body) !== lineage.contentDigest) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_DIGEST_MISMATCH");
  }
}

export function buildCanonicalCausalLineageV1(
  authority: CanonicalRuntimeIntelligenceStateV1,
  hypothesis: RuntimeKnowledgeHypothesisV1,
): CanonicalCausalLineageV1 {
  assertCanonicalRuntimeIntelligenceStateV1(authority);
  const body: LineageBody = {
    schemaVersion: CANONICAL_CAUSAL_LINEAGE_SCHEMA_VERSION,
    derivationVersion: CANONICAL_CAUSAL_LINEAGE_DERIVATION_VERSION,
    runtimeKnowledgeDerivationVersion: authority.derivationVersion,
    organizationId: authority.organizationId,
    symbol: authority.symbol,
    pitAnchor: authority.pitAnchor,
    ...(authority.epistemicRecordCutoff
      ? { epistemicRecordCutoff: authority.epistemicRecordCutoff }
      : {}),
    ...(authority.epistemicAuthority
      ? { epistemicAuthority: authority.epistemicAuthority }
      : {}),
    hypothesisCausalStateDigest: hypothesisCausalStateDigest(hypothesis),
    hypothesisId: hypothesis.hypothesisId,
    hypothesisDefinitionDigest: hypothesis.definitionDigest,
    supportingEvidence: hypothesis.supportingEvidence,
    contradictingEvidence: hypothesis.contradictingEvidence,
    knowledgeRefs: hypothesis.knowledgeRefs,
    invalidationConditions: hypothesis.invalidationConditions,
    supersedesHypothesisIds: hypothesis.supersedesHypothesisIds,
  };
  const lineage = Object.freeze({ ...body, contentDigest: digest(body) });
  assertCanonicalCausalLineageV1(lineage);
  return lineage;
}
