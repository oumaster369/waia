import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { ForecastDecisionIdempotencyConflictError } from "@/lib/trader/intelligence/forecast-decision/errors";
import type { TraderIntelligenceEntryPurposeRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { EntryPurposeRecordRepository } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderIntelligenceEntryPurposeRecord.$inferSelect,
): TraderIntelligenceEntryPurposeRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    decisionRecordId: row.decisionRecordId,
    primaryForecastRecordId: row.primaryForecastRecordId,
    hypothesisRecordId: row.hypothesisRecordId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    originalThesisJson: row.originalThesisJson,
    expectedPath: row.expectedPath,
    forecastHorizon: row.forecastHorizon,
    entryReason: row.entryReason,
    entryConditionJson: row.entryConditionJson,
    invalidationConditionJson: row.invalidationConditionJson,
    initialStopModelJson: row.initialStopModelJson,
    targetModelJson: row.targetModelJson,
    optionalPartialTargetsJson: row.optionalPartialTargetsJson,
    maximumHoldingUntil: row.maximumHoldingUntil.toISOString(),
    whyNotCashJson: row.whyNotCashJson,
    riskAmountJson: row.riskAmountJson,
    expectedRewardAfterCosts: row.expectedRewardAfterCosts,
    evidenceDigest: row.evidenceDigest,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceEntryPurposeRecord["schemaVersion"],
  };
}

function assertIdempotentMatch(
  existing: TraderIntelligenceEntryPurposeRecord,
  incoming: TraderIntelligenceEntryPurposeRecord,
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
    throw new ForecastDecisionIdempotencyConflictError(
      "entry-purpose record business key conflict with mismatched identity or digest",
    );
  }
}

export function createEntryPurposeRecordRepositoryPostgres(
  ex: PgExecutor,
): EntryPurposeRecordRepository {
  return {
    async findByBusinessKey(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceEntryPurposeRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceEntryPurposeRecord.organizationId, scoped),
            eq(pgSchema.traderIntelligenceEntryPurposeRecord.runId, key.runId),
            eq(pgSchema.traderIntelligenceEntryPurposeRecord.cycleId, key.cycleId),
            eq(pgSchema.traderIntelligenceEntryPurposeRecord.symbol, key.symbol),
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
        "entry_purpose_record",
        async () => {
          await ex.insert(pgSchema.traderIntelligenceEntryPurposeRecord).values({
            id: record.id,
            organizationId: scoped.organizationId,
            decisionRecordId: record.decisionRecordId,
            primaryForecastRecordId: record.primaryForecastRecordId,
            hypothesisRecordId: record.hypothesisRecordId,
            runId: record.runId,
            cycleId: record.cycleId,
            symbol: record.symbol,
            originalThesisJson: record.originalThesisJson,
            expectedPath: record.expectedPath,
            forecastHorizon: record.forecastHorizon,
            entryReason: record.entryReason,
            entryConditionJson: record.entryConditionJson,
            invalidationConditionJson: record.invalidationConditionJson,
            initialStopModelJson: record.initialStopModelJson,
            targetModelJson: record.targetModelJson,
            optionalPartialTargetsJson: record.optionalPartialTargetsJson,
            maximumHoldingUntil: new Date(record.maximumHoldingUntil),
            whyNotCashJson: record.whyNotCashJson,
            riskAmountJson: record.riskAmountJson,
            expectedRewardAfterCosts: record.expectedRewardAfterCosts,
            evidenceDigest: record.evidenceDigest,
            strategyId: record.strategyId,
            strategyVersion: record.strategyVersion,
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
          throw new ForecastDecisionIdempotencyConflictError(
            "entry-purpose record conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
