import { createHash } from "node:crypto";
import {
  canonicalizeSemanticJsonString,
  canonicalDecimalString,
  compareCodePoints,
  computeSemanticSha256Hex,
  sortCodePointStrings,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  deriveAuthoritativeHypothesisLinkDigest,
  deriveHypothesisRecordId,
} from "@/lib/trader/intelligence/hypothesis/hypothesis-link";
import {
  CYCLE_ENVELOPE_SCHEMA_VERSION,
  CONVICTION_RECORD_SCHEMA_VERSION,
  HYPOTHESIS_RECORD_SCHEMA_VERSION,
  type TraderIntelligenceConvictionRecord,
  type TraderIntelligenceCycleEnvelopeRecord,
  type TraderIntelligenceHypothesisRecord,
} from "@/lib/trader/intelligence/records/intelligence-records.types";

function deriveDeterministicUuidV4(seed: string): string {
  const hash = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export type CycleEnvelopeIdentityInput = Readonly<{
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
}>;

export function deriveCycleEnvelopeId(input: CycleEnvelopeIdentityInput): string {
  return deriveDeterministicUuidV4(
    `${CYCLE_ENVELOPE_SCHEMA_VERSION}|${input.organizationId}|${input.runId}|${input.cycleId}|${input.symbol}`,
  );
}

export function deriveConvictionRecordId(input: CycleEnvelopeIdentityInput): string {
  return deriveDeterministicUuidV4(
    `${CONVICTION_RECORD_SCHEMA_VERSION}|${input.organizationId}|${input.runId}|${input.cycleId}|${input.symbol}`,
  );
}

export { deriveHypothesisRecordId };

export function canonicalizeCycleEnvelope(
  record: TraderIntelligenceCycleEnvelopeRecord,
): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    run_id: record.runId,
    cycle_id: record.cycleId,
    symbol: record.symbol,
    evaluated_at: record.evaluatedAt,
    historical_profile_id: record.historicalProfileId,
    historical_profile_digest: record.historicalProfileDigest,
    matrix_digest: record.matrixDigest,
    terminal_reason_code: record.terminalReasonCode,
    input_semantic_digest: record.inputSemanticDigest,
    output_semantic_digest: record.outputSemanticDigest,
  };
}

export function computeCycleEnvelopeContentDigest(
  record: TraderIntelligenceCycleEnvelopeRecord,
): string {
  return computeSemanticSha256Hex(canonicalizeCycleEnvelope(record));
}

export function canonicalizeHypothesisRecord(
  record: TraderIntelligenceHypothesisRecord,
): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    run_id: record.runId,
    cycle_id: record.cycleId,
    symbol: record.symbol,
    evaluated_at: record.evaluatedAt,
    hypothesis_type: record.hypothesisType,
    hypothesis_status: record.hypothesisStatus,
    confidence_value: record.confidenceValue,
    thesis_digest: record.thesisDigest,
    evidence_digest: record.evidenceDigest,
    authoritative_link_digest: record.authoritativeLinkDigest,
    canonical_causal_lineage_json: record.canonicalCausalLineageJson ?? null,
    canonical_causal_lineage_digest: record.canonicalCausalLineageDigest ?? null,
  };
}

export function computeHypothesisRecordContentDigest(
  record: TraderIntelligenceHypothesisRecord,
): string {
  return computeSemanticSha256Hex(canonicalizeHypothesisRecord(record));
}

export function canonicalizeConvictionRecord(
  record: TraderIntelligenceConvictionRecord,
): Record<string, unknown> {
  return {
    schema_version: record.schemaVersion,
    organization_id: record.organizationId,
    run_id: record.runId,
    cycle_id: record.cycleId,
    symbol: record.symbol,
    evaluated_at: record.evaluatedAt,
    conviction_scope: record.convictionScope,
    active_hypothesis_business_key_or_null:
      record.activeHypothesisRecordId === null
        ? null
        : `${record.runId}|${record.cycleId}|${record.symbol}|ACTIVE`,
    conviction_value: record.convictionValue,
    conviction_class: record.convictionClass,
    reason_codes: sortCodePointStrings(record.reasonCodes),
    sustained_cycles: record.sustainedCycles,
  };
}

export function computeConvictionRecordContentDigest(
  record: TraderIntelligenceConvictionRecord,
): string {
  return computeSemanticSha256Hex(canonicalizeConvictionRecord(record));
}

export function sortHypothesesByTypeCodePoint(
  hypotheses: readonly TraderIntelligenceHypothesisRecord[],
): TraderIntelligenceHypothesisRecord[] {
  return [...hypotheses].sort((a, b) => compareCodePoints(a.hypothesisType, b.hypothesisType));
}

export function buildThesisDigest(hypothesisType: string, expectedPath: string): string {
  return computeSemanticSha256Hex({ hypothesis_type: hypothesisType, expected_path: expectedPath });
}

export function buildEvidenceDigest(
  supportingEvidence: readonly string[],
  contradictingEvidence: readonly string[],
): string {
  return computeSemanticSha256Hex({
    supporting_evidence: [...supportingEvidence],
    contradicting_evidence: [...contradictingEvidence],
  });
}

export function buildHypothesisLinkDigestInput(input: {
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  evaluatedAt: string;
  hypothesisType: string;
  thesisDigest: string;
  evidenceDigest: string;
  canonicalCausalLineageDigest?: string;
}) {
  return deriveAuthoritativeHypothesisLinkDigest({
    organizationId: input.organizationId,
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
    evaluatedAt: input.evaluatedAt,
    hypothesisType: input.hypothesisType,
    thesisDigest: input.thesisDigest,
    evidenceDigest: input.evidenceDigest,
    canonicalCausalLineageDigest: input.canonicalCausalLineageDigest,
  });
}

export function canonicalDecimalFromNumber(value: number): string {
  return canonicalDecimalString(value);
}
