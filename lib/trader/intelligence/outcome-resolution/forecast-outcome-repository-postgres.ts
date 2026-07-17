import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { OutcomeResolutionIdempotencyConflictError } from "@/lib/trader/intelligence/outcome-resolution/errors";
import type { ForecastOutcomeRecord } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderForecastOutcomeRecord.$inferSelect,
): ForecastOutcomeRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    forecastRecordId: row.forecastRecordId,
    decisionRecordId: row.decisionRecordId,
    hypothesisRecordId: row.hypothesisRecordId,
    modelVersion: row.modelVersion,
    strategyVersion: row.strategyVersion,
    regime: row.regime,
    horizon: row.horizon,
    issuedAt: row.issuedAt.toISOString(),
    eligibleResolutionAt: row.eligibleResolutionAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    pitEvidenceBoundary: row.pitEvidenceBoundary?.toISOString() ?? null,
    outcomeClass: row.outcomeClass as ForecastOutcomeRecord["outcomeClass"],
    outcomeVerdict: row.outcomeVerdict as ForecastOutcomeRecord["outcomeVerdict"],
    score: row.score,
    sourceRecordIdsJson: row.sourceRecordIdsJson,
    contentDigest: row.contentDigest,
    idempotencyKey: row.idempotencyKey,
    provenance: JSON.parse(row.provenanceJson) as ForecastOutcomeRecord["provenance"],
    terminalReason: row.terminalReason,
    schemaVersion: row.schemaVersion as ForecastOutcomeRecord["schemaVersion"],
  };
}

function assertIdempotentMatch(
  existing: ForecastOutcomeRecord,
  incoming: ForecastOutcomeRecord,
): void {
  if (existing.contentDigest !== incoming.contentDigest || existing.id !== incoming.id) {
    throw new OutcomeResolutionIdempotencyConflictError(
      "forecast outcome business key conflict with mismatched digest",
    );
  }
}

export function createForecastOutcomeRepositoryPostgres(ex: PgExecutor) {
  return {
    async findByForecastRecordId(context: { organizationId: string }, forecastRecordId: string) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderForecastOutcomeRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderForecastOutcomeRecord.organizationId, scoped),
            eq(pgSchema.traderForecastOutcomeRecord.forecastRecordId, forecastRecordId),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async listForRun(context: { organizationId: string }, runId: string) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderForecastOutcomeRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderForecastOutcomeRecord.organizationId, scoped),
            eq(pgSchema.traderForecastOutcomeRecord.runId, runId),
          ),
        );
      return rows.map(mapRow);
    },

    async listUnresolvedForRun(context: { organizationId: string }, runId: string) {
      return this.listForRun(context, runId);
    },

    async insert(context: { organizationId: string }, record: ForecastOutcomeRecord) {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.findByForecastRecordId(context, record.forecastRecordId);
      if (existing) {
        assertIdempotentMatch(existing, record);
        return;
      }

      const insertResult = await runIdempotentInsertWithSavepoint(
        ex,
        "forecast_outcome",
        async () => {
          await ex.insert(pgSchema.traderForecastOutcomeRecord).values({
            id: record.id,
            organizationId: scoped.organizationId,
            runId: record.runId,
            cycleId: record.cycleId,
            symbol: record.symbol,
            forecastRecordId: record.forecastRecordId,
            decisionRecordId: record.decisionRecordId,
            hypothesisRecordId: record.hypothesisRecordId,
            modelVersion: record.modelVersion,
            strategyVersion: record.strategyVersion,
            regime: record.regime,
            horizon: record.horizon,
            issuedAt: new Date(record.issuedAt),
            eligibleResolutionAt: new Date(record.eligibleResolutionAt),
            resolvedAt: record.resolvedAt ? new Date(record.resolvedAt) : null,
            pitEvidenceBoundary: record.pitEvidenceBoundary
              ? new Date(record.pitEvidenceBoundary)
              : null,
            outcomeClass: record.outcomeClass,
            outcomeVerdict: record.outcomeVerdict,
            score: record.score,
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
        const raced = await this.findByForecastRecordId(context, record.forecastRecordId);
        if (!raced) {
          throw new OutcomeResolutionIdempotencyConflictError(
            "forecast outcome conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
