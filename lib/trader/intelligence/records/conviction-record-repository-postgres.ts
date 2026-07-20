import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { IntelligenceRecordsIdempotencyConflictError } from "@/lib/trader/intelligence/records/errors";
import type { TraderIntelligenceConvictionRecord } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { ConvictionRecordRepository } from "@/lib/trader/intelligence/records/repository-adapters";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderIntelligenceConvictionRecord.$inferSelect,
): TraderIntelligenceConvictionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    cycleEnvelopeId: row.cycleEnvelopeId,
    activeHypothesisRecordId: row.activeHypothesisRecordId,
    convictionScope: row.convictionScope as TraderIntelligenceConvictionRecord["convictionScope"],
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    evaluatedAt: row.evaluatedAt.toISOString(),
    convictionValue: row.convictionValue,
    convictionClass: row.convictionClass,
    reasonCodes: JSON.parse(row.reasonCodesJson) as string[],
    sustainedCycles: row.sustainedCycles,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceConvictionRecord["schemaVersion"],
  };
}

function assertIdempotentMatch(
  existing: TraderIntelligenceConvictionRecord,
  incoming: TraderIntelligenceConvictionRecord,
): void {
  if (
    existing.id !== incoming.id ||
    existing.organizationId !== incoming.organizationId ||
    existing.runId !== incoming.runId ||
    existing.cycleId !== incoming.cycleId ||
    existing.symbol !== incoming.symbol ||
    existing.schemaVersion !== incoming.schemaVersion ||
    existing.contentDigest !== incoming.contentDigest
  ) {
    throw new IntelligenceRecordsIdempotencyConflictError(
      "conviction record business key conflict with mismatched identity or digest",
    );
  }
}

export function createConvictionRecordRepositoryPostgres(
  ex: PgExecutor,
): ConvictionRecordRepository {
  return {
    async findByBusinessKey(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceConvictionRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceConvictionRecord.organizationId, scoped),
            eq(pgSchema.traderIntelligenceConvictionRecord.runId, key.runId),
            eq(pgSchema.traderIntelligenceConvictionRecord.cycleId, key.cycleId),
            eq(pgSchema.traderIntelligenceConvictionRecord.symbol, key.symbol),
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
      });
      if (existing) {
        assertIdempotentMatch(existing, record);
        return;
      }

      const insertResult = await runIdempotentInsertWithSavepoint(
        ex,
        "conviction_record",
        async () => {
          await ex.insert(pgSchema.traderIntelligenceConvictionRecord).values({
            id: record.id,
            organizationId: scoped.organizationId,
            cycleEnvelopeId: record.cycleEnvelopeId,
            activeHypothesisRecordId: record.activeHypothesisRecordId,
            convictionScope: record.convictionScope,
            runId: record.runId,
            cycleId: record.cycleId,
            symbol: record.symbol,
            evaluatedAt: new Date(record.evaluatedAt),
            convictionValue: record.convictionValue,
            convictionClass: record.convictionClass,
            reasonCodesJson: JSON.stringify([...record.reasonCodes]),
            sustainedCycles: record.sustainedCycles,
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
        });
        if (!raced) {
          throw new IntelligenceRecordsIdempotencyConflictError(
            "conviction record conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
