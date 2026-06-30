import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { traderStrategyPromotionRecords } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
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

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function mapRow(
  row: typeof traderStrategyPromotionRecords.$inferSelect,
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
    costModel: parseJson(row.costModelJson),
    failureModes: parseJson<string[]>(row.failureModesJson),
    reasonCodeDistribution: parseJson<Record<string, number>>(row.reasonCodeDistributionJson),
    paperTradingEvidence: parseJson(row.paperTradingEvidenceJson),
    evidenceContentDigest: row.evidenceContentDigest,
    confidenceAttestation: parseJson(row.confidenceAttestationJson),
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
  return {
    id: input.id,
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    gitCommitSha: input.gitCommitSha,
    targetDeploymentState: input.targetDeploymentState,
    hypothesis: input.hypothesis,
    intendedRegime: input.intendedRegime,
    costModelJson: JSON.stringify(input.costModel),
    failureModesJson: JSON.stringify(input.failureModes),
    reasonCodeDistributionJson: JSON.stringify(input.reasonCodeDistribution),
    paperTradingEvidenceJson: JSON.stringify(input.paperTradingEvidence),
    evidenceContentDigest: input.paperTradingEvidence.contentDigest,
    confidenceAttestationJson: JSON.stringify(input.confidenceAttestation),
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
    createdAt: input.requestedAt ?? new Date(),
    updatedAt: input.requestedAt ?? new Date(),
  };
}

export function insertPromotionRecordSqlite(
  db: WaiaDb,
  input: InsertPromotionRecordInput,
): StrategyPromotionRecordView {
  const values = payloadToRowValues(input);
  db.insert(traderStrategyPromotionRecords).values(values).run();
  return getPromotionRecordByIdSqlite(db, requireOrgContext(input.organizationId), input.id)!;
}

export function getPromotionRecordByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  recordId: string,
): StrategyPromotionRecordView | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderStrategyPromotionRecords)
    .where(
      and(
        eq(traderStrategyPromotionRecords.id, recordId),
        orgScopedWhere(traderStrategyPromotionRecords.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];
  return row ? mapRow(row) : null;
}

export function findPromotionByIdempotencyKeySqlite(
  db: WaiaDb,
  context: OrgContext,
  idempotencyKey: string,
): StrategyPromotionRecordView | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderStrategyPromotionRecords)
    .where(
      and(
        eq(traderStrategyPromotionRecords.idempotencyKey, idempotencyKey),
        orgScopedWhere(traderStrategyPromotionRecords.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];
  return row ? mapRow(row) : null;
}

export function getEffectivePromotionSqlite(
  db: WaiaDb,
  context: OrgContext,
  strategyId: string,
): StrategyPromotionRecordView | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderStrategyPromotionRecords)
    .where(
      and(
        orgScopedWhere(traderStrategyPromotionRecords.organizationId, scoped),
        eq(traderStrategyPromotionRecords.strategyId, strategyId),
        eq(traderStrategyPromotionRecords.state, "EFFECTIVE"),
      ),
    )
    .limit(1)
    .all()[0];
  return row ? mapRow(row) : null;
}

const pendingPromotionStates = ["PENDING_CONFIRM", "COOLING_OFF"] as const;

export function getLatestPendingPromotionSqlite(
  db: WaiaDb,
  context: OrgContext,
  strategyId: string,
): StrategyPromotionRecordView | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderStrategyPromotionRecords)
    .where(
      and(
        orgScopedWhere(traderStrategyPromotionRecords.organizationId, scoped),
        eq(traderStrategyPromotionRecords.strategyId, strategyId),
        inArray(traderStrategyPromotionRecords.state, [...pendingPromotionStates]),
      ),
    )
    .orderBy(desc(traderStrategyPromotionRecords.requestedAt))
    .limit(1)
    .all()[0];
  return row ? mapRow(row) : null;
}

export function updatePromotionGovernanceSqlite(
  db: WaiaDb,
  context: OrgContext,
  recordId: string,
  expectedStateVersion: number,
  patch: PromotionGovernancePatch,
): StrategyPromotionRecordView {
  const scoped = requireOrgContext(context.organizationId);
  const existing = getPromotionRecordByIdSqlite(db, scoped, recordId);
  if (!existing) {
    throw new Error("STRATEGY_PROMOTION_NOT_FOUND");
  }
  if (existing.stateVersion !== expectedStateVersion) {
    throw new Error("STRATEGY_PROMOTION_STATE_VERSION_MISMATCH");
  }

  db.update(traderStrategyPromotionRecords)
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
        eq(traderStrategyPromotionRecords.id, recordId),
        orgScopedWhere(traderStrategyPromotionRecords.organizationId, scoped),
        eq(traderStrategyPromotionRecords.stateVersion, expectedStateVersion),
      ),
    )
    .run();

  return getPromotionRecordByIdSqlite(db, scoped, recordId)!;
}
