import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { StrategyCandidateNotFoundError } from "@/lib/trader/research/errors";
import type {
  BlindValidationResult,
  InsertBlindValidationResultRow,
  InsertStrategyCandidateRow,
  InsertWalkForwardWindowRow,
  StrategyCandidate,
  StrategyCandidateStatus,
  WalkForwardWindowRecord,
} from "@/lib/trader/research/strategy-candidate.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapCandidate(
  row: typeof pgSchema.traderStrategyCandidates.$inferSelect,
): StrategyCandidate {
  return {
    id: row.id,
    organizationId: row.organizationId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    hypothesisId: row.hypothesisId,
    trialId: row.trialId,
    status: row.status,
    paramsJson: row.paramsJson,
    blindUsed: row.blindUsed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapWalkForwardWindow(
  row: typeof pgSchema.traderWalkForwardWindows.$inferSelect,
): WalkForwardWindowRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    candidateId: row.candidateId,
    windowIndex: row.windowIndex,
    inSampleDigest: row.inSampleDigest,
    outOfSampleDigest: row.outOfSampleDigest,
    metricsJson: row.metricsJson,
    createdAt: row.createdAt,
  };
}

function mapBlindValidationResult(
  row: typeof pgSchema.traderBlindValidationResults.$inferSelect,
): BlindValidationResult {
  return {
    id: row.id,
    organizationId: row.organizationId,
    candidateId: row.candidateId,
    datasetId: row.datasetId,
    metricsJson: row.metricsJson,
    evidenceDigest: row.evidenceDigest,
    validatedAt: row.validatedAt,
    createdAt: row.createdAt,
  };
}

export async function getStrategyCandidateByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  candidateId: string,
): Promise<StrategyCandidate | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderStrategyCandidates)
    .where(
      and(
        eq(pgSchema.traderStrategyCandidates.id, candidateId),
        orgScopedWhere(pgSchema.traderStrategyCandidates.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapCandidate(rows[0]) : null;
}

export async function getLatestCandidateForStrategyPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  strategyId: string,
  strategyVersion: string,
): Promise<StrategyCandidate | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderStrategyCandidates)
    .where(
      and(
        eq(pgSchema.traderStrategyCandidates.strategyId, strategyId),
        eq(pgSchema.traderStrategyCandidates.strategyVersion, strategyVersion),
        orgScopedWhere(pgSchema.traderStrategyCandidates.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderStrategyCandidates.updatedAt))
    .limit(1);

  return rows[0] ? mapCandidate(rows[0]) : null;
}

export async function registerStrategyCandidatePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertStrategyCandidateRow,
): Promise<StrategyCandidate> {
  const scoped = requireOrgContext(context.organizationId);
  const now = row.createdAt ?? new Date();

  await ex.insert(pgSchema.traderStrategyCandidates).values({
    id: row.id,
    organizationId: scoped.organizationId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    hypothesisId: row.hypothesisId ?? null,
    trialId: row.trialId ?? null,
    status: row.status ?? "registered",
    paramsJson: row.paramsJson,
    blindUsed: false,
    createdAt: now,
    updatedAt: row.updatedAt ?? now,
  });

  const created = await getStrategyCandidateByIdPostgres(ex, context, row.id);
  if (!created) {
    throw new Error(`[research] failed to load registered strategy candidate ${row.id}`);
  }
  return created;
}

export async function updateStrategyCandidateStatusPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  candidateId: string,
  status: StrategyCandidateStatus,
): Promise<StrategyCandidate> {
  const scoped = requireOrgContext(context.organizationId);
  const updatedAt = new Date();

  const rows = await ex
    .update(pgSchema.traderStrategyCandidates)
    .set({ status, updatedAt })
    .where(
      and(
        eq(pgSchema.traderStrategyCandidates.id, candidateId),
        orgScopedWhere(pgSchema.traderStrategyCandidates.organizationId, scoped),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) {
    throw new StrategyCandidateNotFoundError(candidateId);
  }
  return mapCandidate(row);
}

export async function markStrategyCandidateBlindUsedPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  candidateId: string,
): Promise<StrategyCandidate> {
  const scoped = requireOrgContext(context.organizationId);
  const updatedAt = new Date();

  const rows = await ex
    .update(pgSchema.traderStrategyCandidates)
    .set({ blindUsed: true, updatedAt })
    .where(
      and(
        eq(pgSchema.traderStrategyCandidates.id, candidateId),
        orgScopedWhere(pgSchema.traderStrategyCandidates.organizationId, scoped),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) {
    throw new StrategyCandidateNotFoundError(candidateId);
  }
  return mapCandidate(row);
}

export async function listWalkForwardWindowsForCandidatePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  candidateId: string,
): Promise<WalkForwardWindowRecord[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderWalkForwardWindows)
    .where(
      and(
        eq(pgSchema.traderWalkForwardWindows.candidateId, candidateId),
        orgScopedWhere(pgSchema.traderWalkForwardWindows.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderWalkForwardWindows.windowIndex);

  return rows.map(mapWalkForwardWindow);
}

export async function insertWalkForwardWindowPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertWalkForwardWindowRow,
): Promise<WalkForwardWindowRecord> {
  const scoped = requireOrgContext(context.organizationId);
  const createdAt = row.createdAt ?? new Date();

  await ex.insert(pgSchema.traderWalkForwardWindows).values({
    id: row.id,
    organizationId: scoped.organizationId,
    candidateId: row.candidateId,
    windowIndex: row.windowIndex,
    inSampleDigest: row.inSampleDigest,
    outOfSampleDigest: row.outOfSampleDigest,
    metricsJson: row.metricsJson,
    createdAt,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderWalkForwardWindows)
    .where(
      and(
        eq(pgSchema.traderWalkForwardWindows.id, row.id),
        orgScopedWhere(pgSchema.traderWalkForwardWindows.organizationId, scoped),
      ),
    )
    .limit(1);

  const inserted = rows[0];
  if (!inserted) {
    throw new Error(`[research] failed to load walk-forward window ${row.id}`);
  }
  return mapWalkForwardWindow(inserted);
}

export async function getBlindValidationResultForCandidatePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  candidateId: string,
): Promise<BlindValidationResult | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderBlindValidationResults)
    .where(
      and(
        eq(pgSchema.traderBlindValidationResults.candidateId, candidateId),
        orgScopedWhere(pgSchema.traderBlindValidationResults.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapBlindValidationResult(rows[0]) : null;
}

export async function insertBlindValidationResultPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertBlindValidationResultRow,
): Promise<BlindValidationResult> {
  const scoped = requireOrgContext(context.organizationId);
  const createdAt = row.createdAt ?? new Date();

  await ex.insert(pgSchema.traderBlindValidationResults).values({
    id: row.id,
    organizationId: scoped.organizationId,
    candidateId: row.candidateId,
    datasetId: row.datasetId,
    metricsJson: row.metricsJson,
    evidenceDigest: row.evidenceDigest,
    validatedAt: row.validatedAt,
    createdAt,
  });

  const result = await getBlindValidationResultForCandidatePostgres(ex, context, row.candidateId);
  if (!result) {
    throw new Error(
      `[research] failed to load blind validation result for candidate ${row.candidateId}`,
    );
  }
  return result;
}
