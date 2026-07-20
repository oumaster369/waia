import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

export type BacktestRunStatus = "pending" | "running" | "completed" | "failed";

export type BacktestRunView = {
  id: string;
  organizationId: string;
  datasetId: string;
  strategyId: string;
  strategyVersion: string;
  costModelVersion: string;
  split: "train" | "validation" | "blind";
  status: BacktestRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  evidenceDigest: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

function mapBacktestRun(row: typeof pgSchema.traderBacktestRuns.$inferSelect): BacktestRunView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    datasetId: row.datasetId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    costModelVersion: row.costModelVersion,
    split: row.split,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    evidenceDigest: row.evidenceDigest,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  };
}

export async function listBacktestRunsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  options?: { strategyId?: string; limit?: number },
): Promise<BacktestRunView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(pgSchema.traderBacktestRuns.organizationId, scoped)];
  if (options?.strategyId) {
    conditions.push(eq(pgSchema.traderBacktestRuns.strategyId, options.strategyId));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderBacktestRuns)
    .where(and(...conditions))
    .orderBy(desc(pgSchema.traderBacktestRuns.createdAt))
    .limit(options?.limit ?? 100);

  return rows.map(mapBacktestRun);
}

export async function getBacktestRunByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  runId: string,
): Promise<BacktestRunView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderBacktestRuns)
    .where(
      and(
        eq(pgSchema.traderBacktestRuns.id, runId),
        orgScopedWhere(pgSchema.traderBacktestRuns.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapBacktestRun(rows[0]) : null;
}
