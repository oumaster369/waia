import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  KNOWLEDGE_CONSOLIDATION_SCHEMA_VERSION,
  type AppendConsolidationRecordInput,
  type ConsolidationRecord,
} from "@/lib/trader/discovery/knowledge-consolidation.types";
import { buildConsolidationRecordContentDigest } from "@/lib/trader/discovery/serialize-discovery";

export class KnowledgeConsolidationError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "KnowledgeConsolidationError";
    this.code = code;
  }
}

export function appendConsolidationRecord(
  input: AppendConsolidationRecordInput,
  organizationId: string,
  id: string,
  createdAt = new Date().toISOString(),
): ConsolidationRecord {
  if (!input.operatorAttestationDigest.trim()) {
    throw new KnowledgeConsolidationError(
      "CONSOLIDATION_ATTESTATION_REQUIRED",
      "Knowledge consolidation requires operator attestation",
    );
  }

  const draft: Omit<ConsolidationRecord, "contentDigest"> = {
    schemaVersion: KNOWLEDGE_CONSOLIDATION_SCHEMA_VERSION,
    id,
    organizationId,
    campaignRef: input.campaignRef,
    action: input.action,
    sourceRefs: input.sourceRefs,
    canonicalRef: input.canonicalRef ?? null,
    rationale: input.rationale,
    operatorAttestationDigest: input.operatorAttestationDigest,
    createdAt,
  };

  return {
    ...draft,
    contentDigest: buildConsolidationRecordContentDigest(draft),
  };
}
