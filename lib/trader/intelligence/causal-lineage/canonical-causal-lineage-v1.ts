import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  RUNTIME_KNOWLEDGE_DERIVATION_VERSION,
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
    !lineage.hypothesisId ||
    !lineage.hypothesisDefinitionDigest
  ) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_INCOMPLETE");
  }
  const cutoff = Date.parse(cutoffAt);
  if (!Number.isFinite(cutoff) || lineage.pitAnchor !== cutoffAt) {
    throw new Error("CANONICAL_CAUSAL_LINEAGE_CUTOFF_MISMATCH");
  }
  for (const evidence of [...lineage.supportingEvidence, ...lineage.contradictingEvidence]) {
    const eventTime = Date.parse(evidence.eventTime);
    const ingestTime = Date.parse(evidence.ingestTime);
    if (
      !evidence.evidenceId ||
      !evidence.contentDigest ||
      !Number.isFinite(eventTime) ||
      !Number.isFinite(ingestTime) ||
      eventTime > cutoff ||
      ingestTime > cutoff
    ) {
      throw new Error("CANONICAL_CAUSAL_LINEAGE_EVIDENCE_INVALID");
    }
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
  const body: LineageBody = {
    schemaVersion: CANONICAL_CAUSAL_LINEAGE_SCHEMA_VERSION,
    derivationVersion: CANONICAL_CAUSAL_LINEAGE_DERIVATION_VERSION,
    runtimeKnowledgeDerivationVersion: authority.derivationVersion,
    organizationId: authority.organizationId,
    symbol: authority.symbol,
    pitAnchor: authority.pitAnchor,
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
