import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, lte } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  KnowledgeEdge,
  MarketEvent,
  MarketPrediction,
} from "@/lib/trader/knowledge/knowledge.types";
import type {
  TraderIntelligenceDecisionForecastLink,
  TraderIntelligenceDecisionRecord,
  TraderIntelligenceEntryPurposeRecord,
  TraderIntelligenceForecastRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type {
  TraderIntelligenceConvictionRecord,
  TraderIntelligenceCycleEnvelopeRecord,
  TraderIntelligenceHypothesisRecord,
} from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { MkbReadModelQuery } from "@/lib/trader/knowledge/mkb-read-model.types";
import type { MkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select">;

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
    canonicalCausalLineageJson: row.canonicalCausalLineageJson,
    canonicalCausalLineageDigest: row.canonicalCausalLineageDigest,
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

function mapLinkRow(
  row: typeof pgSchema.traderIntelligenceDecisionForecastLink.$inferSelect,
): TraderIntelligenceDecisionForecastLink {
  return {
    id: row.id,
    organizationId: row.organizationId,
    decisionRecordId: row.decisionRecordId,
    forecastRecordId: row.forecastRecordId,
    linkRole: row.linkRole as TraderIntelligenceDecisionForecastLink["linkRole"],
    ordinal: row.ordinal,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceDecisionForecastLink["schemaVersion"],
  };
}

function mapEntryPurposeRow(
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

function mapEnvelopeRow(
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
    canonicalCausalLineageJson: row.canonicalCausalLineageJson,
    canonicalCausalLineageDigest: row.canonicalCausalLineageDigest,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceHypothesisRecord["schemaVersion"],
  };
}

function mapConvictionRow(
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

function mapKnowledgeEdge(row: typeof pgSchema.traderKnowledgeEdges.$inferSelect): KnowledgeEdge {
  return {
    id: row.id,
    organizationId: row.organizationId,
    fromRef: row.fromRef,
    toRef: row.toRef,
    relationKind: row.relationKind,
    confidence: row.confidence,
    strength: row.strength,
    regimeScope: row.regimeScope,
    failureCasesJson: row.failureCasesJson,
    hypothesisId: row.hypothesisId,
    verified: row.verified,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMarketPrediction(
  row: typeof pgSchema.traderMarketPredictions.$inferSelect,
): MarketPrediction {
  return {
    id: row.id,
    organizationId: row.organizationId,
    subjectRef: row.subjectRef,
    predictionJson: row.predictionJson,
    predictedAt: row.predictedAt,
    outcomeJson: row.outcomeJson,
    verifiedAt: row.verifiedAt,
    verificationResult: row.verificationResult as MarketPrediction["verificationResult"],
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

function mapMarketEvent(row: typeof pgSchema.traderMarketEvents.$inferSelect): MarketEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    eventKind: row.eventKind,
    subjectRef: row.subjectRef,
    payloadJson: row.payloadJson,
    eventTime: row.eventTime,
    confidence: row.confidence,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

function buildRunCycleSymbolConditions(
  table: {
    organizationId: { name: string };
    runId: { name: string };
    cycleId: { name: string };
    symbol: { name: string };
  },
  scoped: ReturnType<typeof requireOrgContext>,
  query: MkbReadModelQuery,
) {
  const conditions = [
    orgScopedWhere(
      table.organizationId as typeof pgSchema.traderIntelligenceForecastRecord.organizationId,
      scoped,
    ),
  ];
  if (query.runId) {
    conditions.push(
      eq(table.runId as typeof pgSchema.traderIntelligenceForecastRecord.runId, query.runId),
    );
  }
  if (query.cycleId) {
    conditions.push(
      eq(table.cycleId as typeof pgSchema.traderIntelligenceForecastRecord.cycleId, query.cycleId),
    );
  }
  if (query.symbol) {
    conditions.push(
      eq(table.symbol as typeof pgSchema.traderIntelligenceForecastRecord.symbol, query.symbol),
    );
  }
  return conditions;
}

export function createMkbReadModelSourcePostgres(ex: PgExecutor): MkbReadModelSource {
  return {
    async loadSnapshot(_context, query, asOf) {
      const scoped = requireOrgContext(_context.organizationId);
      const limit = query.limit ?? 500;

      const cycleEnvelopes = (
        await ex
          .select()
          .from(pgSchema.traderIntelligenceCycleEnvelope)
          .where(
            and(
              ...buildRunCycleSymbolConditions(
                pgSchema.traderIntelligenceCycleEnvelope,
                scoped,
                query,
              ),
              lte(pgSchema.traderIntelligenceCycleEnvelope.evaluatedAt, asOf),
            ),
          )
          .limit(limit)
      ).map(mapEnvelopeRow);

      const forecasts = (
        await ex
          .select()
          .from(pgSchema.traderIntelligenceForecastRecord)
          .where(
            and(
              ...buildRunCycleSymbolConditions(
                pgSchema.traderIntelligenceForecastRecord,
                scoped,
                query,
              ),
              lte(pgSchema.traderIntelligenceForecastRecord.issuedAt, asOf),
            ),
          )
          .limit(limit)
      ).map(mapForecastRow);

      const decisions = (
        await ex
          .select()
          .from(pgSchema.traderIntelligenceDecisionRecord)
          .where(
            and(
              ...buildRunCycleSymbolConditions(
                pgSchema.traderIntelligenceDecisionRecord,
                scoped,
                query,
              ),
              lte(pgSchema.traderIntelligenceDecisionRecord.issuedAt, asOf),
            ),
          )
          .limit(limit)
      ).map(mapDecisionRow);

      const decisionIds = decisions.map((row) => row.id);
      const links =
        decisionIds.length === 0
          ? []
          : (
              await ex
                .select()
                .from(pgSchema.traderIntelligenceDecisionForecastLink)
                .where(
                  orgScopedWhere(
                    pgSchema.traderIntelligenceDecisionForecastLink.organizationId,
                    scoped,
                  ),
                )
                .limit(limit)
            )
              .map(mapLinkRow)
              .filter((row) => decisionIds.includes(row.decisionRecordId));

      const entryPurposes =
        decisionIds.length === 0
          ? []
          : (
              await ex
                .select()
                .from(pgSchema.traderIntelligenceEntryPurposeRecord)
                .where(
                  orgScopedWhere(
                    pgSchema.traderIntelligenceEntryPurposeRecord.organizationId,
                    scoped,
                  ),
                )
                .limit(limit)
            )
              .map(mapEntryPurposeRow)
              .filter((row) => decisionIds.includes(row.decisionRecordId));

      const envelopeIds = new Set(cycleEnvelopes.map((row) => row.id));
      const hypotheses = (
        await ex
          .select()
          .from(pgSchema.traderIntelligenceHypothesisRecord)
          .where(
            and(
              orgScopedWhere(pgSchema.traderIntelligenceHypothesisRecord.organizationId, scoped),
              lte(pgSchema.traderIntelligenceHypothesisRecord.evaluatedAt, asOf),
            ),
          )
          .limit(limit)
      )
        .map(mapHypothesisRow)
        .filter((row) => envelopeIds.has(row.cycleEnvelopeId));

      const convictions = (
        await ex
          .select()
          .from(pgSchema.traderIntelligenceConvictionRecord)
          .where(
            and(
              orgScopedWhere(pgSchema.traderIntelligenceConvictionRecord.organizationId, scoped),
              lte(pgSchema.traderIntelligenceConvictionRecord.evaluatedAt, asOf),
            ),
          )
          .limit(limit)
      )
        .map(mapConvictionRow)
        .filter((row) => envelopeIds.has(row.cycleEnvelopeId));

      const edgeConditions = [
        orgScopedWhere(pgSchema.traderKnowledgeEdges.organizationId, scoped),
        lte(pgSchema.traderKnowledgeEdges.createdAt, asOf),
        lte(pgSchema.traderKnowledgeEdges.updatedAt, asOf),
      ];
      if (query.regimeScope) {
        edgeConditions.push(eq(pgSchema.traderKnowledgeEdges.regimeScope, query.regimeScope));
      }

      const knowledgeEdges = (
        await ex
          .select()
          .from(pgSchema.traderKnowledgeEdges)
          .where(and(...edgeConditions))
          .limit(limit)
      ).map(mapKnowledgeEdge);

      const marketPredictions = (
        await ex
          .select()
          .from(pgSchema.traderMarketPredictions)
          .where(
            and(
              orgScopedWhere(pgSchema.traderMarketPredictions.organizationId, scoped),
              lte(pgSchema.traderMarketPredictions.predictedAt, asOf),
            ),
          )
          .limit(limit)
      ).map(mapMarketPrediction);

      const marketEvents = (
        await ex
          .select()
          .from(pgSchema.traderMarketEvents)
          .where(
            and(
              orgScopedWhere(pgSchema.traderMarketEvents.organizationId, scoped),
              lte(pgSchema.traderMarketEvents.eventTime, asOf),
            ),
          )
          .limit(limit)
      ).map(mapMarketEvent);

      return {
        cycleEnvelopes,
        hypotheses,
        convictions,
        forecasts,
        decisions,
        links,
        entryPurposes,
        knowledgeEdges,
        marketPredictions,
        marketEvents,
      };
    },
  };
}
