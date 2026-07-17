import { and, eq, lte } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import type { TraderIntelligenceDecisionRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { TraderIntelligenceForecastRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type {
  ForecastOutcomeRecord,
  OutcomeResolutionSource,
} from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import type { TraderIntelligenceHypothesisRecord } from "@/lib/trader/intelligence/records/intelligence-records.types";
import { createForecastOutcomeRepositoryPostgres } from "@/lib/trader/intelligence/outcome-resolution/forecast-outcome-repository-postgres";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapForecastRow(
  row: typeof pgSchema.traderIntelligenceForecastRecord.$inferSelect,
): TraderIntelligenceForecastRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    cycleEnvelopeId: row.cycleEnvelopeId,
    hypothesisRecordId: row.hypothesisRecordId,
    convictionRecordId: row.convictionRecordId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    forecastKeyDigest: row.forecastKeyDigest,
    evaluatedAt: row.evaluatedAt.toISOString(),
    issuedAt: row.issuedAt.toISOString(),
    evidenceCutoffAt: row.evidenceCutoffAt.toISOString(),
    targetWindowStartAt: row.targetWindowStartAt.toISOString(),
    targetWindowEndAt: row.targetWindowEndAt.toISOString(),
    marketQuestion: row.marketQuestion,
    invalidationConditionsJson: row.invalidationConditionsJson,
    scenarioSetJson: row.scenarioSetJson,
    forecastConfidenceJson: row.forecastConfidenceJson,
    historicalProfileId: row.historicalProfileId,
    historicalProfileDigest: row.historicalProfileDigest,
    matrixDigest: row.matrixDigest,
    evidenceDigest: row.evidenceDigest,
    authoritativeLinkDigest: row.authoritativeLinkDigest,
    forecastModelVersion: row.forecastModelVersion,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceForecastRecord["schemaVersion"],
  };
}

function mapDecisionRow(
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

function mapHypothesisRow(
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
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceHypothesisRecord["schemaVersion"],
  };
}

export function createOutcomeResolutionSourcePostgres(ex: PgExecutor): OutcomeResolutionSource {
  const forecastOutcomeRepo = createForecastOutcomeRepositoryPostgres(ex);

  return {
    async listForecastsEligibleForResolution(context, runId, asOf) {
      const scoped = requireOrgContext(context.organizationId);
      const asOfDate = new Date(asOf);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceForecastRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceForecastRecord.organizationId, scoped),
            eq(pgSchema.traderIntelligenceForecastRecord.runId, runId),
            lte(pgSchema.traderIntelligenceForecastRecord.targetWindowEndAt, asOfDate),
          ),
        );
      const forecasts = rows.map(mapForecastRow);
      const unresolved: TraderIntelligenceForecastRecord[] = [];
      for (const forecast of forecasts) {
        const outcome = await forecastOutcomeRepo.findByForecastRecordId(context, forecast.id);
        if (!outcome) {
          unresolved.push(forecast);
        }
      }
      return unresolved;
    },

    async listHypothesesEligibleForResolution(context, runId, asOf) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceHypothesisRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceHypothesisRecord.organizationId, scoped),
            eq(pgSchema.traderIntelligenceHypothesisRecord.runId, runId),
          ),
        );
      return rows.map(mapHypothesisRow);
    },

    async listNoTradeDecisionsEligibleForScoring(context, runId, asOf) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceDecisionRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceDecisionRecord.organizationId, scoped),
            eq(pgSchema.traderIntelligenceDecisionRecord.runId, runId),
            eq(pgSchema.traderIntelligenceDecisionRecord.decisionClass, "NO_TRADE"),
          ),
        );
      return rows
        .map(mapDecisionRow)
        .filter((row) => new Date(row.issuedAt).getTime() <= new Date(asOf).getTime());
    },

    findForecastOutcomeByForecastId: (context, forecastRecordId) =>
      forecastOutcomeRepo.findByForecastRecordId(context, forecastRecordId),

    async listForecastOutcomesForRun(context, runId) {
      return forecastOutcomeRepo.listForRun(context, runId);
    },
  };
}
