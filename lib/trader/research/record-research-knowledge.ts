import { createHash } from "node:crypto";

import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { insertKnowledgeEdgePostgres } from "@/lib/trader/knowledge/knowledge-edge-repository-postgres";
import { insertMarketEventPostgres } from "@/lib/trader/knowledge/market-event-repository-postgres";
import type { ResearchEvidenceDocument } from "@/lib/trader/research/research-evidence-export.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function stableDigest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export type RecordResearchKnowledgeInput = {
  evidenceDocument: ResearchEvidenceDocument;
  candidateId: string;
  recordedAt?: Date;
};

/**
 * Deterministic knowledge updates after a completed research pipeline run.
 * Writes market events + knowledge edges — no LLM involvement.
 */
export async function recordResearchPipelineKnowledgePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: RecordResearchKnowledgeInput,
): Promise<{ marketEventId: string; knowledgeEdgeId: string }> {
  const scoped = context.organizationId;
  const recordedAt = input.recordedAt ?? new Date();
  const body = input.evidenceDocument.evidenceBody;
  const envelope = input.evidenceDocument.envelope;

  const eventPayload = {
    schemaVersion: "research_pipeline_completion_v1",
    strategyId: envelope.strategyId,
    strategyVersion: envelope.strategyVersion,
    datasetId: body.datasetId,
    backtestRunId: body.backtestRunId,
    strategyCandidateId: body.strategyCandidateId,
    blindValidationResultId: body.blindValidationResultId,
    regimeCoverage: body.regimeCoverage,
    evidenceDigest: envelope.contentDigest,
  };

  const eventDigest = stableDigest({
    organizationId: scoped,
    eventKind: "research_pipeline_completed",
    subjectRef: envelope.strategyId,
    payload: eventPayload,
    eventTime: recordedAt.toISOString(),
  });

  const marketEvent = await insertMarketEventPostgres(ex, context, {
    id: crypto.randomUUID(),
    eventKind: "research_pipeline_completed",
    subjectRef: envelope.strategyId,
    payloadJson: JSON.stringify(eventPayload),
    eventTime: recordedAt,
    confidence: "1.0000",
    contentDigest: eventDigest,
    createdAt: recordedAt,
  });

  const edgePayload = {
    fromRef: `dataset:${body.datasetId}`,
    toRef: `strategy:${envelope.strategyId}@${envelope.strategyVersion}`,
    relationKind: "validated_by_research_pipeline",
    candidateId: input.candidateId,
    evidenceDigest: envelope.contentDigest,
  };

  const knowledgeEdge = await insertKnowledgeEdgePostgres(ex, context, {
    id: crypto.randomUUID(),
    fromRef: edgePayload.fromRef,
    toRef: edgePayload.toRef,
    relationKind: edgePayload.relationKind,
    confidence: body.regimeCoverage.satisfiesRequirement ? "0.7500" : "0.2500",
    strength: "0.5000",
    regimeScope: body.regimeCoverage.regimes.join("|") || "unknown",
    failureCasesJson: "[]",
    verified: body.regimeCoverage.satisfiesRequirement,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  });

  return {
    marketEventId: marketEvent.id,
    knowledgeEdgeId: knowledgeEdge.id,
  };
}
