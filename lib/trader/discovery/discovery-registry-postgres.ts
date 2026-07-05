import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  InsertComparisonScoreRow,
  InsertConsolidationRecordRow,
  InsertEvidenceRecordRow,
  InsertHypothesisProposalRow,
  InsertObservationRow,
  InsertPromotionProposalRow,
  InsertResearchCampaignRow,
  InsertResearchCampaignStateRecordRow,
  InsertResearchQuestionRow,
  InsertRetirementRecordRow,
  InsertStrategySynthesisRow,
  InsertStructureClusterRow,
} from "@/lib/trader/discovery/discovery-record.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "insert" | "select">;

async function assertInserted<T>(rows: T[], label: string): Promise<T> {
  if (!rows[0]) {
    throw new Error(`[trader] ${label} insert failed`);
  }
  return rows[0];
}

export async function insertDiscoveryResearchCampaignPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertResearchCampaignRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryResearchCampaign).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignKey: row.campaignKey,
    name: row.name,
    researchProgram: row.researchProgram,
    description: row.description,
    symbolScope: row.symbolScope,
    datasetDigest: row.datasetDigest,
    currentState: row.currentState,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryResearchCampaign)
      .where(
        and(
          eq(pgSchema.traderDiscoveryResearchCampaign.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryResearchCampaign.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery research campaign",
  );
}

export async function insertDiscoveryCampaignStateRecordPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertResearchCampaignStateRecordRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryCampaignStateRecord).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    priorState: row.priorState,
    newState: row.newState,
    rationale: row.rationale,
    operatorAttestationDigest: row.operatorAttestationDigest,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryCampaignStateRecord)
      .where(
        and(
          eq(pgSchema.traderDiscoveryCampaignStateRecord.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryCampaignStateRecord.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery campaign state record",
  );
}

export async function insertDiscoveryResearchQuestionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertResearchQuestionRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryResearchQuestion).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    kind: row.kind,
    questionText: row.questionText,
    researchProgram: row.researchProgram,
    observationRefsJson: row.observationRefsJson,
    structureClusterId: row.structureClusterId,
    status: row.status,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryResearchQuestion)
      .where(
        and(
          eq(pgSchema.traderDiscoveryResearchQuestion.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryResearchQuestion.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery research question",
  );
}

export async function insertDiscoveryObservationPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertObservationRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryObservation).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    payloadJson: row.payloadJson,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryObservation)
      .where(
        and(
          eq(pgSchema.traderDiscoveryObservation.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryObservation.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery observation",
  );
}

export async function insertDiscoveryStructureClusterPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertStructureClusterRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryStructureCluster).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    signatureKey: row.signatureKey,
    payloadJson: row.payloadJson,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryStructureCluster)
      .where(
        and(
          eq(pgSchema.traderDiscoveryStructureCluster.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryStructureCluster.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery structure cluster",
  );
}

export async function insertDiscoveryHypothesisProposalPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertHypothesisProposalRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryHypothesisProposal).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    researchQuestionId: row.researchQuestionId,
    payloadJson: row.payloadJson,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryHypothesisProposal)
      .where(
        and(
          eq(pgSchema.traderDiscoveryHypothesisProposal.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryHypothesisProposal.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery hypothesis proposal",
  );
}

export async function insertDiscoveryConsolidationRecordPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertConsolidationRecordRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryConsolidationRecord).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    action: row.action,
    sourceRefsJson: row.sourceRefsJson,
    canonicalRef: row.canonicalRef,
    rationale: row.rationale,
    operatorAttestationDigest: row.operatorAttestationDigest,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryConsolidationRecord)
      .where(
        and(
          eq(pgSchema.traderDiscoveryConsolidationRecord.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryConsolidationRecord.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery consolidation record",
  );
}

export async function insertDiscoveryStrategySynthesisPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertStrategySynthesisRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryStrategySynthesis).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    templateId: row.templateId,
    paramsJson: row.paramsJson,
    parentStrategyVersion: row.parentStrategyVersion,
    hypothesisProposalId: row.hypothesisProposalId,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryStrategySynthesis)
      .where(
        and(
          eq(pgSchema.traderDiscoveryStrategySynthesis.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryStrategySynthesis.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery strategy synthesis",
  );
}

export async function insertDiscoveryEvidenceRecordPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertEvidenceRecordRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryEvidenceRecord).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    hypothesisRef: row.hypothesisRef,
    candidateRef: row.candidateRef,
    dimension: row.dimension,
    direction: row.direction,
    strength: row.strength,
    uncertaintyBandLow: row.uncertaintyBandLow,
    uncertaintyBandHigh: row.uncertaintyBandHigh,
    contradictionRefsJson: row.contradictionRefsJson,
    sourceRunDigest: row.sourceRunDigest,
    relevanceScore: row.relevanceScore,
    rationaleJson: row.rationaleJson,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryEvidenceRecord)
      .where(
        and(
          eq(pgSchema.traderDiscoveryEvidenceRecord.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryEvidenceRecord.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery evidence record",
  );
}

export async function insertDiscoveryComparisonScorePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertComparisonScoreRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryComparisonScore).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    candidateRef: row.candidateRef,
    dimensionScoresJson: row.dimensionScoresJson,
    aggregateRankScore: row.aggregateRankScore,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryComparisonScore)
      .where(
        and(
          eq(pgSchema.traderDiscoveryComparisonScore.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryComparisonScore.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery comparison score",
  );
}

export async function insertDiscoveryPromotionProposalPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertPromotionProposalRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryPromotionProposal).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    candidateId: row.candidateId,
    comparisonDigest: row.comparisonDigest,
    recommends: row.recommends,
    rationale: row.rationale,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryPromotionProposal)
      .where(
        and(
          eq(pgSchema.traderDiscoveryPromotionProposal.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryPromotionProposal.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery promotion proposal",
  );
}

export async function insertDiscoveryRetirementRecordPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertRetirementRecordRow,
) {
  const scoped = requireOrgContext(context.organizationId);
  await ex.insert(pgSchema.traderDiscoveryRetirementRecord).values({
    id: row.id,
    organizationId: scoped.organizationId,
    campaignId: row.campaignId,
    subjectRef: row.subjectRef,
    subjectKind: row.subjectKind,
    rationale: row.rationale,
    operatorAttestationDigest: row.operatorAttestationDigest,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  });
  return assertInserted(
    await ex
      .select()
      .from(pgSchema.traderDiscoveryRetirementRecord)
      .where(
        and(
          eq(pgSchema.traderDiscoveryRetirementRecord.id, row.id),
          orgScopedWhere(pgSchema.traderDiscoveryRetirementRecord.organizationId, scoped),
        ),
      )
      .limit(1),
    "discovery retirement record",
  );
}
