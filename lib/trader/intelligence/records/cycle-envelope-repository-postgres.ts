import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { isUniqueConstraintError } from "@/lib/trader/execution/order-repository.types";
import { IntelligenceRecordsIdempotencyConflictError } from "@/lib/trader/intelligence/records/errors";
import type { TraderIntelligenceCycleEnvelopeRecord } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { CycleEnvelopeRepository } from "@/lib/trader/intelligence/records/repository-adapters";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapRow(
  row: typeof pgSchema.traderIntelligenceCycleEnvelope.$inferSelect,
): TraderIntelligenceCycleEnvelopeRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    evaluatedAt: row.evaluatedAt.toISOString(),
    historicalProfileId: row.historicalProfileId,
    historicalProfileDigest: row.historicalProfileDigest,
    matrixDigest: row.matrixDigest,
    terminalReasonCode: row.terminalReasonCode,
    inputSemanticDigest: row.inputSemanticDigest,
    outputSemanticDigest: row.outputSemanticDigest,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceCycleEnvelopeRecord["schemaVersion"],
  };
}

function assertIdempotentMatch(
  existing: TraderIntelligenceCycleEnvelopeRecord,
  incoming: TraderIntelligenceCycleEnvelopeRecord,
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
      "cycle envelope business key conflict with mismatched identity or digest",
    );
  }
}

export function createCycleEnvelopeRepositoryPostgres(ex: PgExecutor): CycleEnvelopeRepository {
  return {
    async findByBusinessKey(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceCycleEnvelope)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceCycleEnvelope.organizationId, scoped),
            eq(pgSchema.traderIntelligenceCycleEnvelope.runId, key.runId),
            eq(pgSchema.traderIntelligenceCycleEnvelope.cycleId, key.cycleId),
            eq(pgSchema.traderIntelligenceCycleEnvelope.symbol, key.symbol),
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

      try {
        await ex.insert(pgSchema.traderIntelligenceCycleEnvelope).values({
          id: record.id,
          organizationId: scoped.organizationId,
          runId: record.runId,
          cycleId: record.cycleId,
          symbol: record.symbol,
          evaluatedAt: new Date(record.evaluatedAt),
          historicalProfileId: record.historicalProfileId,
          historicalProfileDigest: record.historicalProfileDigest,
          matrixDigest: record.matrixDigest,
          terminalReasonCode: record.terminalReasonCode,
          inputSemanticDigest: record.inputSemanticDigest,
          outputSemanticDigest: record.outputSemanticDigest,
          contentDigest: record.contentDigest,
          schemaVersion: record.schemaVersion,
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
        const raced = await this.findByBusinessKey(context, {
          runId: record.runId,
          cycleId: record.cycleId,
          symbol: record.symbol,
        });
        if (!raced) {
          throw new IntelligenceRecordsIdempotencyConflictError(
            "cycle envelope conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
