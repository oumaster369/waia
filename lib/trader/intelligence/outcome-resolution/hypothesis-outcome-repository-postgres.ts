import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { OutcomeResolutionIdempotencyConflictError } from "@/lib/trader/intelligence/outcome-resolution/errors";
import type { HypothesisOutcomeRecord } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderHypothesisOutcomeRecord.$inferSelect,
): HypothesisOutcomeRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    hypothesisRecordId: row.hypothesisRecordId,
    decisionRecordId: row.decisionRecordId,
    forecastOutcomeIdsJson: row.forecastOutcomeIdsJson,
    modelVersion: row.modelVersion,
    strategyVersion: row.strategyVersion,
    regime: row.regime,
    horizon: row.horizon,
    issuedAt: row.issuedAt.toISOString(),
    eligibleResolutionAt: row.eligibleResolutionAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    pitEvidenceBoundary: row.pitEvidenceBoundary?.toISOString() ?? null,
    outcomeClass: row.outcomeClass as HypothesisOutcomeRecord["outcomeClass"],
    score: row.score,
    sourceRecordIdsJson: row.sourceRecordIdsJson,
    contentDigest: row.contentDigest,
    idempotencyKey: row.idempotencyKey,
    provenance: JSON.parse(row.provenanceJson) as HypothesisOutcomeRecord["provenance"],
    terminalReason: row.terminalReason,
    schemaVersion: row.schemaVersion as HypothesisOutcomeRecord["schemaVersion"],
  };
}

function assertIdempotentMatch(
  existing: HypothesisOutcomeRecord,
  incoming: HypothesisOutcomeRecord,
): void {
  if (existing.contentDigest !== incoming.contentDigest || existing.id !== incoming.id) {
    throw new OutcomeResolutionIdempotencyConflictError(
      "hypothesis outcome business key conflict with mismatched digest",
    );
  }
}

export function createHypothesisOutcomeRepositoryPostgres(ex: PgExecutor) {
  return {
    async findByHypothesisRecordId(
      context: { organizationId: string },
      hypothesisRecordId: string,
    ) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderHypothesisOutcomeRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderHypothesisOutcomeRecord.organizationId, scoped),
            eq(pgSchema.traderHypothesisOutcomeRecord.hypothesisRecordId, hypothesisRecordId),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async insert(context: { organizationId: string }, record: HypothesisOutcomeRecord) {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.findByHypothesisRecordId(context, record.hypothesisRecordId);
      if (existing) {
        assertIdempotentMatch(existing, record);
        return;
      }

      const insertResult = await runIdempotentInsertWithSavepoint(
        ex,
        "hypothesis_outcome",
        async () => {
          await ex.insert(pgSchema.traderHypothesisOutcomeRecord).values({
            id: record.id,
            organizationId: scoped.organizationId,
            runId: record.runId,
            cycleId: record.cycleId,
            symbol: record.symbol,
            hypothesisRecordId: record.hypothesisRecordId,
            decisionRecordId: record.decisionRecordId,
            forecastOutcomeIdsJson: record.forecastOutcomeIdsJson,
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
        const raced = await this.findByHypothesisRecordId(context, record.hypothesisRecordId);
        if (!raced) {
          throw new OutcomeResolutionIdempotencyConflictError(
            "hypothesis outcome conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
