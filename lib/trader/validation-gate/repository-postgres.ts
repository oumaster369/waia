import "server-only";

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  InsertPromotionRecordInput,
  PromotionGovernancePatch,
  StrategyPromotionRecordView,
} from "@/lib/trader/validation-gate/strategy-promotion-record.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgPromotionExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapRow(
  row: typeof pgSchema.traderStrategyPromotionRecords.$inferSelect,
): StrategyPromotionRecordView {
  return {
    id: row.id,
    schemaVersion: row.schemaVersion as StrategyPromotionRecordView["schemaVersion"],
    organizationId: row.organizationId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    gitCommitSha: row.gitCommitSha,
    targetDeploymentState: row.targetDeploymentState,
    hypothesis: row.hypothesis,
    intendedRegime: row.intendedRegime,
    costModel: row.costModelJson as StrategyPromotionRecordView["costModel"],
    failureModes: row.failureModesJson as string[],
    reasonCodeDistribution: row.reasonCodeDistributionJson as Record<string, number>,
    paperTradingEvidence:
      row.paperTradingEvidenceJson as StrategyPromotionRecordView["paperTradingEvidence"],
    evidenceContentDigest: row.evidenceContentDigest,
    confidenceAttestation:
      row.confidenceAttestationJson as StrategyPromotionRecordView["confidenceAttestation"],
    recordContentDigest: row.recordContentDigest,
    state: row.state,
    actorId: row.actorId,
    requestedAt: row.requestedAt,
    confirmedAt: row.confirmedAt,
    coolingOffEndsAt: row.coolingOffEndsAt,
    effectiveAt: row.effectiveAt,
    cancelledAt: row.cancelledAt,
    revokedAt: row.revokedAt,
    supersededByRecordId: row.supersededByRecordId,
    stateVersion: row.stateVersion,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function payloadToRowValues(input: InsertPromotionRecordInput) {
  const now = input.requestedAt ?? new Date();
  return {
    id: input.id,
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    gitCommitSha: input.gitCommitSha,
    targetDeploymentState: input.targetDeploymentState,
    hypothesis: input.hypothesis,
    intendedRegime: input.intendedRegime,
    costModelJson: input.costModel,
    failureModesJson: input.failureModes,
    reasonCodeDistributionJson: input.reasonCodeDistribution,
    paperTradingEvidenceJson: input.paperTradingEvidence,
    evidenceContentDigest: input.paperTradingEvidence.contentDigest,
    confidenceAttestationJson: input.confidenceAttestation,
    recordContentDigest: input.recordContentDigest,
    schemaVersion: input.schemaVersion,
    state: input.state,
    actorId: input.actorId,
    requestedAt: input.requestedAt,
    confirmedAt: null,
    coolingOffEndsAt: null,
    effectiveAt: null,
    cancelledAt: null,
    revokedAt: null,
    supersededByRecordId: null,
    stateVersion: 1,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
}

export async function insertPromotionRecordPostgres(
  ex: PgPromotionExecutor,
  input: InsertPromotionRecordInput,
): Promise<StrategyPromotionRecordView> {
  await ex.insert(pgSchema.traderStrategyPromotionRecords).values(payloadToRowValues(input));
  const record = await getPromotionRecordByIdPostgres(
    ex,
    requireOrgContext(input.organizationId),
    input.id,
  );
  if (!record) {
    throw new Error("STRATEGY_PROMOTION_INSERT_FAILED");
  }
  return record;
}

export async function getPromotionRecordByIdPostgres(
  ex: PgPromotionExecutor,
  context: OrgContext,
  recordId: string,
): Promise<StrategyPromotionRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderStrategyPromotionRecords)
    .where(
      and(
        eq(pgSchema.traderStrategyPromotionRecords.id, recordId),
        orgScopedWhere(pgSchema.traderStrategyPromotionRecords.organizationId, scoped),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function findPromotionByIdempotencyKeyPostgres(
  ex: PgPromotionExecutor,
  context: OrgContext,
  idempotencyKey: string,
): Promise<StrategyPromotionRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderStrategyPromotionRecords)
    .where(
      and(
        eq(pgSchema.traderStrategyPromotionRecords.idempotencyKey, idempotencyKey),
        orgScopedWhere(pgSchema.traderStrategyPromotionRecords.organizationId, scoped),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function getEffectivePromotionPostgres(
  ex: PgPromotionExecutor,
  context: OrgContext,
  strategyId: string,
): Promise<StrategyPromotionRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderStrategyPromotionRecords)
    .where(
      and(
        orgScopedWhere(pgSchema.traderStrategyPromotionRecords.organizationId, scoped),
        eq(pgSchema.traderStrategyPromotionRecords.strategyId, strategyId),
        eq(pgSchema.traderStrategyPromotionRecords.state, "EFFECTIVE"),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function updatePromotionGovernancePostgres(
  ex: PgPromotionExecutor,
  context: OrgContext,
  recordId: string,
  expectedStateVersion: number,
  patch: PromotionGovernancePatch,
): Promise<StrategyPromotionRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  const existing = await getPromotionRecordByIdPostgres(ex, scoped, recordId);
  if (!existing) {
    throw new Error("STRATEGY_PROMOTION_NOT_FOUND");
  }
  if (existing.stateVersion !== expectedStateVersion) {
    throw new Error("STRATEGY_PROMOTION_STATE_VERSION_MISMATCH");
  }

  await ex
    .update(pgSchema.traderStrategyPromotionRecords)
    .set({
      state: patch.state,
      confirmedAt: patch.confirmedAt,
      coolingOffEndsAt: patch.coolingOffEndsAt,
      effectiveAt: patch.effectiveAt,
      cancelledAt: patch.cancelledAt,
      revokedAt: patch.revokedAt,
      supersededByRecordId: patch.supersededByRecordId,
      stateVersion: patch.stateVersion,
      updatedAt: patch.updatedAt,
    })
    .where(
      and(
        eq(pgSchema.traderStrategyPromotionRecords.id, recordId),
        orgScopedWhere(pgSchema.traderStrategyPromotionRecords.organizationId, scoped),
        eq(pgSchema.traderStrategyPromotionRecords.stateVersion, expectedStateVersion),
      ),
    );

  const updated = await getPromotionRecordByIdPostgres(ex, scoped, recordId);
  if (!updated) {
    throw new Error("STRATEGY_PROMOTION_UPDATE_FAILED");
  }
  return updated;
}
