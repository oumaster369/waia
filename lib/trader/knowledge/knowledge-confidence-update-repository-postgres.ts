import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { OutcomeResolutionIdempotencyConflictError } from "@/lib/trader/intelligence/outcome-resolution/errors";
import {
  type KnowledgeConfidenceUpdateRecord,
  computeKnowledgeConfidenceUpdateContentDigest,
} from "@/lib/trader/knowledge/knowledge-confidence-update";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderKnowledgeConfidenceUpdateRecord.$inferSelect,
): KnowledgeConfidenceUpdateRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    knowledgeEdgeId: row.knowledgeEdgeId,
    updateKind: row.updateKind as KnowledgeConfidenceUpdateRecord["updateKind"],
    updateModelVersion: row.updateModelVersion,
    priorConfidence: row.priorConfidence,
    posteriorConfidence: row.posteriorConfidence,
    delta: row.delta,
    issuedAt: row.issuedAt.toISOString(),
    eligibleResolutionAt: row.eligibleResolutionAt.toISOString(),
    resolvedAt: row.resolvedAt.toISOString(),
    pitEvidenceBoundary: row.pitEvidenceBoundary.toISOString(),
    outcomeClass: row.outcomeClass,
    score: row.score,
    sourceRecordIdsJson: row.sourceRecordIdsJson,
    contentDigest: row.contentDigest,
    idempotencyKey: row.idempotencyKey,
    provenance: JSON.parse(row.provenanceJson) as KnowledgeConfidenceUpdateRecord["provenance"],
    terminalReason: row.terminalReason,
    schemaVersion: row.schemaVersion as KnowledgeConfidenceUpdateRecord["schemaVersion"],
  };
}

export function createKnowledgeConfidenceUpdateRepositoryPostgres(ex: PgExecutor) {
  return {
    async findByIdempotencyKey(context: { organizationId: string }, idempotencyKey: string) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderKnowledgeConfidenceUpdateRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderKnowledgeConfidenceUpdateRecord.organizationId, scoped),
            eq(pgSchema.traderKnowledgeConfidenceUpdateRecord.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async insert(context: { organizationId: string }, record: KnowledgeConfidenceUpdateRecord) {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.findByIdempotencyKey(context, record.idempotencyKey);
      if (existing) {
        if (existing.contentDigest !== record.contentDigest) {
          throw new OutcomeResolutionIdempotencyConflictError(
            "knowledge confidence update conflict with mismatched digest",
          );
        }
        return;
      }

      const expectedDigest = computeKnowledgeConfidenceUpdateContentDigest(record);
      if (expectedDigest !== record.contentDigest) {
        throw new Error("knowledge confidence update digest mismatch");
      }

      await runIdempotentInsertWithSavepoint(ex, "knowledge_confidence_update", async () => {
        await ex.insert(pgSchema.traderKnowledgeConfidenceUpdateRecord).values({
          id: record.id,
          organizationId: scoped.organizationId,
          runId: record.runId,
          cycleId: record.cycleId,
          symbol: record.symbol,
          knowledgeEdgeId: record.knowledgeEdgeId,
          updateKind: record.updateKind,
          updateModelVersion: record.updateModelVersion,
          priorConfidence: record.priorConfidence,
          posteriorConfidence: record.posteriorConfidence,
          delta: record.delta,
          issuedAt: new Date(record.issuedAt),
          eligibleResolutionAt: new Date(record.eligibleResolutionAt),
          resolvedAt: new Date(record.resolvedAt),
          pitEvidenceBoundary: new Date(record.pitEvidenceBoundary),
          outcomeClass: record.outcomeClass,
          score: record.score,
          sourceRecordIdsJson: record.sourceRecordIdsJson,
          contentDigest: record.contentDigest,
          idempotencyKey: record.idempotencyKey,
          provenanceJson: JSON.stringify(record.provenance),
          terminalReason: record.terminalReason,
          schemaVersion: record.schemaVersion,
        });
      });
    },
  };
}

export type KnowledgeConfidenceUpdateRepository = ReturnType<
  typeof createKnowledgeConfidenceUpdateRepositoryPostgres
>;

export type ConfidenceUpdateSink = Readonly<{
  confidenceUpdateRepository: KnowledgeConfidenceUpdateRepository;
}>;
