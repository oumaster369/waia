import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { ForecastDecisionIdempotencyConflictError } from "@/lib/trader/intelligence/forecast-decision/errors";
import type { TraderIntelligenceDecisionRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { DecisionRecordRepository } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import { assertForecastDecisionPersistencePermit } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderIntelligenceDecisionRecord.$inferSelect,
): TraderIntelligenceDecisionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    cycleEnvelopeId: row.cycleEnvelopeId,
    convictionRecordId: row.convictionRecordId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    evaluatedAt: row.evaluatedAt.toISOString(),
    issuedAt: row.issuedAt.toISOString(),
    decisionClass: row.decisionClass as TraderIntelligenceDecisionRecord["decisionClass"],
    universalTerminalReasonCode: row.universalTerminalReasonCode,
    whyNotCashJson: row.whyNotCashJson,
    whyCashOrAbstainJson: row.whyCashOrAbstainJson,
    grossExpectedReward: row.grossExpectedReward,
    expectedFees: row.expectedFees,
    expectedSlippage: row.expectedSlippage,
    expectedOtherCosts: row.expectedOtherCosts,
    expectedRewardAfterCosts: row.expectedRewardAfterCosts,
    costModelId: row.costModelId,
    costModelVersion: row.costModelVersion,
    costEvidenceState:
      row.costEvidenceState as TraderIntelligenceDecisionRecord["costEvidenceState"],
    cdeMsvPermissionSnapshotJson: row.cdeMsvPermissionSnapshotJson,
    reasonCodesJson: row.reasonCodesJson,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceDecisionRecord["schemaVersion"],
  };
}

function assertIdempotentMatch(
  existing: TraderIntelligenceDecisionRecord,
  incoming: TraderIntelligenceDecisionRecord,
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
      "decision record business key conflict with mismatched identity or digest",
    );
  }
}

export function createDecisionRecordRepositoryPostgres(ex: PgExecutor): DecisionRecordRepository {
  return {
    async findByBusinessKey(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceDecisionRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceDecisionRecord.organizationId, scoped),
            eq(pgSchema.traderIntelligenceDecisionRecord.runId, key.runId),
            eq(pgSchema.traderIntelligenceDecisionRecord.cycleId, key.cycleId),
            eq(pgSchema.traderIntelligenceDecisionRecord.symbol, key.symbol),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async insert(context, record, permit) {
      assertForecastDecisionPersistencePermit(permit, "DECISION", record);
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
        "decision_record",
        async () => {
          await ex.insert(pgSchema.traderIntelligenceDecisionRecord).values({
            id: record.id,
            organizationId: scoped.organizationId,
            cycleEnvelopeId: record.cycleEnvelopeId,
            convictionRecordId: record.convictionRecordId,
            runId: record.runId,
            cycleId: record.cycleId,
            symbol: record.symbol,
            evaluatedAt: new Date(record.evaluatedAt),
            issuedAt: new Date(record.issuedAt),
            decisionClass: record.decisionClass,
            universalTerminalReasonCode: record.universalTerminalReasonCode,
            whyNotCashJson: record.whyNotCashJson,
            whyCashOrAbstainJson: record.whyCashOrAbstainJson,
            grossExpectedReward: record.grossExpectedReward,
            expectedFees: record.expectedFees,
            expectedSlippage: record.expectedSlippage,
            expectedOtherCosts: record.expectedOtherCosts,
            expectedRewardAfterCosts: record.expectedRewardAfterCosts,
            costModelId: record.costModelId,
            costModelVersion: record.costModelVersion,
            costEvidenceState: record.costEvidenceState,
            cdeMsvPermissionSnapshotJson: record.cdeMsvPermissionSnapshotJson,
            reasonCodesJson: record.reasonCodesJson,
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
            "decision record conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
