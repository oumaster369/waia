import { createHash } from "node:crypto";

import type { HypothesisType } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";

export const RUNTIME_KNOWLEDGE_AUTHORITY_SCHEMA_VERSION =
  "waia.trader.runtime_knowledge_authority.v1" as const;
export const RUNTIME_KNOWLEDGE_DERIVATION_VERSION = "dee-629-pit-fold/v1" as const;

export type RuntimeKnowledgeRefV1 = Readonly<{
  knowledgeEdgeId: string;
  knowledgeState: "OBSERVATION_ONLY" | "RESOLVED_CORRECT" | "RESOLVED_INCORRECT" | "UNRESOLVED" | "INSUFFICIENT_EVIDENCE" | "STALE" | "INELIGIBLE";
}>;

export type RuntimeEvidenceRefV1 = Readonly<{
  evidenceId: string;
  contentDigest: string;
  direction: "FOR" | "AGAINST" | "NEUTRAL";
  eventTime: string;
  ingestTime: string;
}>;

export type RuntimeKnowledgeHypothesisV1 = Readonly<{
  hypothesisId: string;
  hypothesisKey: string;
  definitionDigest: string;
  createdAt: string;
  hypothesisType: HypothesisType;
  lifecycleState: "PROPOSED" | "VALIDATING" | "VALIDATED" | "DECAYING" | "RETIRED" | "QUARANTINED";
  rankOrdinal: number;
  ordinalJudgment: "SUPPORTED" | "CONTESTED" | "WEAKENED";
  expectedPath: string;
  invalidationConditions: readonly string[];
  supportingEvidence: readonly RuntimeEvidenceRefV1[];
  contradictingEvidence: readonly RuntimeEvidenceRefV1[];
  knowledgeRefs: readonly RuntimeKnowledgeRefV1[];
  supersedesHypothesisIds: readonly string[];
}>;

export type CanonicalRuntimeIntelligenceStateV1 = Readonly<{
  schemaVersion: typeof RUNTIME_KNOWLEDGE_AUTHORITY_SCHEMA_VERSION;
  authority: "CANONICAL_PIT_KNOWLEDGE";
  derivationVersion: typeof RUNTIME_KNOWLEDGE_DERIVATION_VERSION;
  organizationId: string;
  symbol: string;
  pitAnchor: string;
  /** Present only for a durable, human-ratified historical replay dual-time fold. */
  epistemicRecordCutoff?: string;
  epistemicAuthority?: Readonly<{
    schemaVersion: "waia.trader.historical_four_surface_ratified_admission.v2";
    ratifiedAdmissionId: string;
    authorityContentDigestHex: string;
    createdAt: string;
  }>;
  knowledgeSemanticDigest: string;
  hypotheses: readonly RuntimeKnowledgeHypothesisV1[];
  semanticDigest: string;
}>;

/** @deprecated Use CanonicalRuntimeIntelligenceStateV1. */
export type RuntimeKnowledgeAuthorityV1 = CanonicalRuntimeIntelligenceStateV1;

export type BuildRuntimeKnowledgeAuthorityV1Input = Omit<CanonicalRuntimeIntelligenceStateV1, "schemaVersion" | "derivationVersion" | "authority" | "semanticDigest">;

function canonicalPayload(input: BuildRuntimeKnowledgeAuthorityV1Input): string {
  return JSON.stringify({
    schemaVersion: RUNTIME_KNOWLEDGE_AUTHORITY_SCHEMA_VERSION,
    authority: "CANONICAL_PIT_KNOWLEDGE",
    derivationVersion: RUNTIME_KNOWLEDGE_DERIVATION_VERSION,
    organizationId: input.organizationId,
    symbol: input.symbol,
    pitAnchor: input.pitAnchor,
    ...(input.epistemicRecordCutoff
      ? { epistemicRecordCutoff: input.epistemicRecordCutoff }
      : {}),
    ...(input.epistemicAuthority ? { epistemicAuthority: input.epistemicAuthority } : {}),
    knowledgeSemanticDigest: input.knowledgeSemanticDigest,
    hypotheses: input.hypotheses,
  });
}

function digest(input: BuildRuntimeKnowledgeAuthorityV1Input): string {
  return createHash("sha256").update(canonicalPayload(input), "utf8").digest("hex");
}

function assertIsoAtOrBefore(value: string, pitAnchor: string, field: string): void {
  const timestamp = Date.parse(value);
  const anchor = Date.parse(pitAnchor);
  if (!Number.isFinite(timestamp) || !Number.isFinite(anchor) || timestamp > anchor) {
    throw new Error(`[runtime-knowledge-authority] ${field} must be knowable at pitAnchor`);
  }
}

export function assertCanonicalRuntimeIntelligenceStateV1(authority: CanonicalRuntimeIntelligenceStateV1): void {
  if (
    authority.schemaVersion !== RUNTIME_KNOWLEDGE_AUTHORITY_SCHEMA_VERSION ||
    authority.derivationVersion !== RUNTIME_KNOWLEDGE_DERIVATION_VERSION ||
    authority.authority !== "CANONICAL_PIT_KNOWLEDGE"
  ) {
    throw new Error("[runtime-knowledge-authority] unsupported authority");
  }
  if (!authority.organizationId || !authority.symbol || !authority.knowledgeSemanticDigest) {
    throw new Error("[runtime-knowledge-authority] incomplete scope or semantic lineage");
  }
  const recordCutoff = authority.epistemicRecordCutoff ?? authority.pitAnchor;
  if (
    Boolean(authority.epistemicRecordCutoff) !== Boolean(authority.epistemicAuthority) ||
    (authority.epistemicAuthority && (
      authority.epistemicAuthority.schemaVersion !==
        "waia.trader.historical_four_surface_ratified_admission.v2" ||
      authority.epistemicAuthority.createdAt !== authority.epistemicRecordCutoff ||
      !/^[0-9a-f-]{36}$/i.test(authority.epistemicAuthority.ratifiedAdmissionId) ||
      !/^[0-9a-f]{64}$/.test(authority.epistemicAuthority.authorityContentDigestHex)
    ))
  ) {
    throw new Error("[runtime-knowledge-authority] unbound epistemic cutoff");
  }
  assertIsoAtOrBefore(authority.pitAnchor, recordCutoff, "pitAnchor");
  const ordinals = new Set<number>();
  const ids = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const hypothesis of authority.hypotheses) {
    if (!hypothesis.hypothesisId || !hypothesis.definitionDigest || !Number.isInteger(hypothesis.rankOrdinal) || hypothesis.rankOrdinal < 0) {
      throw new Error("[runtime-knowledge-authority] incomplete hypothesis identity or rank");
    }
    if (ids.has(hypothesis.hypothesisId) || ordinals.has(hypothesis.rankOrdinal)) {
      throw new Error("[runtime-knowledge-authority] duplicate hypothesis id or rank ordinal");
    }
    ids.add(hypothesis.hypothesisId);
    ordinals.add(hypothesis.rankOrdinal);
    assertIsoAtOrBefore(hypothesis.createdAt, recordCutoff, "hypothesis.createdAt");
    if (hypothesis.knowledgeRefs.some((item) => item.knowledgeState === "RESOLVED_INCORRECT" || item.knowledgeState === "STALE" || item.knowledgeState === "INELIGIBLE")) {
      throw new Error("[runtime-knowledge-authority] terminal or stale Knowledge citation is ineligible");
    }
    if (hypothesis.supportingEvidence.some((item) => item.direction !== "FOR") || hypothesis.contradictingEvidence.some((item) => item.direction !== "AGAINST")) {
      throw new Error("[runtime-knowledge-authority] evidence direction does not match support/contradiction lane");
    }
    for (const evidence of [...hypothesis.supportingEvidence, ...hypothesis.contradictingEvidence]) {
      if (!evidence.evidenceId || !evidence.contentDigest) {
        throw new Error("[runtime-knowledge-authority] evidence identity and digest are required");
      }
      if (evidenceIds.has(evidence.evidenceId)) {
        throw new Error("[runtime-knowledge-authority] duplicate evidence identity");
      }
      evidenceIds.add(evidence.evidenceId);
      assertIsoAtOrBefore(evidence.eventTime, authority.pitAnchor, "eventTime");
      assertIsoAtOrBefore(evidence.ingestTime, recordCutoff, "ingestTime");
    }
  }
  const expected = digest({
    organizationId: authority.organizationId,
    symbol: authority.symbol,
    pitAnchor: authority.pitAnchor,
    ...(authority.epistemicRecordCutoff
      ? { epistemicRecordCutoff: authority.epistemicRecordCutoff }
      : {}),
    ...(authority.epistemicAuthority
      ? { epistemicAuthority: authority.epistemicAuthority }
      : {}),
    knowledgeSemanticDigest: authority.knowledgeSemanticDigest,
    hypotheses: authority.hypotheses,
  });
  if (authority.semanticDigest !== expected) {
    throw new Error("[runtime-knowledge-authority] state digest mismatch");
  }
}

export function buildCanonicalRuntimeIntelligenceStateV1(input: BuildRuntimeKnowledgeAuthorityV1Input): CanonicalRuntimeIntelligenceStateV1 {
  const authority: CanonicalRuntimeIntelligenceStateV1 = {
    schemaVersion: RUNTIME_KNOWLEDGE_AUTHORITY_SCHEMA_VERSION,
    derivationVersion: RUNTIME_KNOWLEDGE_DERIVATION_VERSION,
    authority: "CANONICAL_PIT_KNOWLEDGE",
    ...input,
    semanticDigest: digest(input),
  };
  assertCanonicalRuntimeIntelligenceStateV1(authority);
  return authority;
}

/** @deprecated Use the canonical state names. */
export const buildRuntimeKnowledgeAuthorityV1 = buildCanonicalRuntimeIntelligenceStateV1;
/** @deprecated Use the canonical state names. */
export const assertRuntimeKnowledgeAuthorityV1 = assertCanonicalRuntimeIntelligenceStateV1;
