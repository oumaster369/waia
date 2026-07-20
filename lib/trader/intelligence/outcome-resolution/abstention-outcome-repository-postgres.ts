import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { OutcomeResolutionIdempotencyConflictError } from "@/lib/trader/intelligence/outcome-resolution/errors";
import type { AbstentionOutcomeRecord } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderAbstentionOutcomeRecord.$inferSelect,
): AbstentionOutcomeRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    decisionRecordId: row.decisionRecordId,
    forecastRecordId: row.forecastRecordId,
    forecastOutcomeId: row.forecastOutcomeId,
    modelVersion: row.modelVersion,
    strategyVersion: row.strategyVersion,
    regime: row.regime,
    horizon: row.horizon,
    issuedAt: row.issuedAt.toISOString(),
    eligibleResolutionAt: row.eligibleResolutionAt.toISOString(),
    resolvedAt: row.resolvedAt.toISOString(),
    pitEvidenceBoundary: row.pitEvidenceBoundary.toISOString(),
    outcomeClass: row.outcomeClass as AbstentionOutcomeRecord["outcomeClass"],
    score: row.score,
    observedOutcomeJson: row.observedOutcomeJson,
    counterfactualTradeSimJson: row.counterfactualTradeSimJson,
    sourceRecordIdsJson: row.sourceRecordIdsJson,
    contentDigest: row.contentDigest,
    idempotencyKey: row.idempotencyKey,
    provenance: JSON.parse(row.provenanceJson) as AbstentionOutcomeRecord["provenance"],
    terminalReason: row.terminalReason,
    schemaVersion: row.schemaVersion as AbstentionOutcomeRecord["schemaVersion"],
  };
}

function assertIdempotentMatch(
  existing: AbstentionOutcomeRecord,
  incoming: AbstentionOutcomeRecord,
): void {
  if (existing.contentDigest !== incoming.contentDigest || existing.id !== incoming.id) {
    throw new OutcomeResolutionIdempotencyConflictError(
      "abstention outcome business key conflict with mismatched digest",
    );
  }
}

export function createAbstentionOutcomeRepositoryPostgres(ex: PgExecutor) {
  return {
    async findByDecisionRecordId(context: { organizationId: string }, decisionRecordId: string) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderAbstentionOutcomeRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderAbstentionOutcomeRecord.organizationId, scoped),
            eq(pgSchema.traderAbstentionOutcomeRecord.decisionRecordId, decisionRecordId),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async insert(context: { organizationId: string }, record: AbstentionOutcomeRecord) {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.findByDecisionRecordId(context, record.decisionRecordId);
      if (existing) {
        assertIdempotentMatch(existing, record);
        return;
      }

      const insertResult = await runIdempotentInsertWithSavepoint(
        ex,
        "abstention_outcome",
        async () => {
          await ex.insert(pgSchema.traderAbstentionOutcomeRecord).values({
            id: record.id,
            organizationId: scoped.organizationId,
            runId: record.runId,
            cycleId: record.cycleId,
            symbol: record.symbol,
            decisionRecordId: record.decisionRecordId,
            forecastRecordId: record.forecastRecordId,
            forecastOutcomeId: record.forecastOutcomeId,
            modelVersion: record.modelVersion,
            strategyVersion: record.strategyVersion,
            regime: record.regime,
            horizon: record.horizon,
            issuedAt: new Date(record.issuedAt),
            eligibleResolutionAt: new Date(record.eligibleResolutionAt),
            resolvedAt: new Date(record.resolvedAt),
            pitEvidenceBoundary: new Date(record.pitEvidenceBoundary),
            outcomeClass: record.outcomeClass,
            score: record.score,
            observedOutcomeJson: record.observedOutcomeJson,
            counterfactualTradeSimJson: record.counterfactualTradeSimJson,
            sourceRecordIdsJson: record.sourceRecordIdsJson,
            contentDigest: record.contentDigest,
            idempotencyKey: record.idempotencyKey,
            provenanceJson: JSON.stringify(record.provenance),
            terminalReason: record.terminalReason,
            schemaVersion: record.schemaVersion,
          });
        },
      );

      if (insertResult === "unique_violation") {
        const raced = await this.findByDecisionRecordId(context, record.decisionRecordId);
        if (!raced) {
          throw new OutcomeResolutionIdempotencyConflictError(
            "abstention outcome conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
