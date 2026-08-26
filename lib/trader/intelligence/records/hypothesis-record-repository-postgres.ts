import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { IntelligenceRecordsIdempotencyConflictError } from "@/lib/trader/intelligence/records/errors";
import type { TraderIntelligenceHypothesisRecord } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { HypothesisRecordRepository } from "@/lib/trader/intelligence/records/repository-adapters";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderIntelligenceHypothesisRecord.$inferSelect,
): TraderIntelligenceHypothesisRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    cycleEnvelopeId: row.cycleEnvelopeId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    evaluatedAt: row.evaluatedAt.toISOString(),
    hypothesisType: row.hypothesisType,
    hypothesisStatus: row.hypothesisStatus,
    confidenceValue: row.confidenceValue,
    thesisDigest: row.thesisDigest,
    evidenceDigest: row.evidenceDigest,
    miHypothesisId: row.miHypothesisId,
    authoritativeLinkDigest: row.authoritativeLinkDigest,
    canonicalCausalLineageJson: row.canonicalCausalLineageJson,
    canonicalCausalLineageDigest: row.canonicalCausalLineageDigest,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceHypothesisRecord["schemaVersion"],
  };
}

function assertIdempotentMatch(
  existing: TraderIntelligenceHypothesisRecord,
  incoming: TraderIntelligenceHypothesisRecord,
): void {
  if (
    existing.id !== incoming.id ||
    existing.organizationId !== incoming.organizationId ||
    existing.runId !== incoming.runId ||
    existing.cycleId !== incoming.cycleId ||
    existing.symbol !== incoming.symbol ||
    existing.hypothesisType !== incoming.hypothesisType ||
    existing.schemaVersion !== incoming.schemaVersion ||
    existing.contentDigest !== incoming.contentDigest
    || existing.canonicalCausalLineageJson !== (incoming.canonicalCausalLineageJson ?? null)
    || existing.canonicalCausalLineageDigest !== (incoming.canonicalCausalLineageDigest ?? null)
  ) {
    throw new IntelligenceRecordsIdempotencyConflictError(
      "hypothesis record business key conflict with mismatched identity or digest",
    );
  }
}

export function createHypothesisRecordRepositoryPostgres(
  ex: PgExecutor,
): HypothesisRecordRepository {
  return {
    async findByBusinessKey(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceHypothesisRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceHypothesisRecord.organizationId, scoped),
            eq(pgSchema.traderIntelligenceHypothesisRecord.runId, key.runId),
            eq(pgSchema.traderIntelligenceHypothesisRecord.cycleId, key.cycleId),
            eq(pgSchema.traderIntelligenceHypothesisRecord.symbol, key.symbol),
            eq(pgSchema.traderIntelligenceHypothesisRecord.hypothesisType, key.hypothesisType),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async insert(context, record) {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.findByBusinessKey(context, {
        runId: record.runId,
        cycleId: record.cycleId,
        symbol: record.symbol,
        hypothesisType: record.hypothesisType,
      });
      if (existing) {
        assertIdempotentMatch(existing, record);
        return;
      }

      const insertResult = await runIdempotentInsertWithSavepoint(
        ex,
        "hypothesis_record",
        async () => {
          await ex.insert(pgSchema.traderIntelligenceHypothesisRecord).values({
            id: record.id,
            organizationId: scoped.organizationId,
            cycleEnvelopeId: record.cycleEnvelopeId,
            runId: record.runId,
            cycleId: record.cycleId,
            symbol: record.symbol,
            evaluatedAt: new Date(record.evaluatedAt),
            hypothesisType: record.hypothesisType,
            hypothesisStatus: record.hypothesisStatus,
            confidenceValue: record.confidenceValue,
            thesisDigest: record.thesisDigest,
            evidenceDigest: record.evidenceDigest,
            miHypothesisId: record.miHypothesisId,
            authoritativeLinkDigest: record.authoritativeLinkDigest,
            canonicalCausalLineageJson: record.canonicalCausalLineageJson ?? null,
            canonicalCausalLineageDigest: record.canonicalCausalLineageDigest ?? null,
            contentDigest: record.contentDigest,
            schemaVersion: record.schemaVersion,
          });
        },
      );

      if (insertResult === "unique_violation") {
        const raced = await this.findByBusinessKey(context, {
          runId: record.runId,
          cycleId: record.cycleId,
          symbol: record.symbol,
          hypothesisType: record.hypothesisType,
        });
        if (!raced) {
          throw new IntelligenceRecordsIdempotencyConflictError(
            "hypothesis record conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
