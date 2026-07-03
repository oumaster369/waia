import "server-only";

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { BacktestRegimeMetrics } from "@/lib/trader/backtest/backtest-evaluation-export.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgBacktestReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgBacktestExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

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

export type BacktestResultView = {
  id: string;
  organizationId: string;
  runId: string;
  regimeLabel: string;
  metrics: BacktestRegimeMetrics[];
  createdAt: Date;
};

export type CreateBacktestRunInput = {
  id: string;
  datasetId: string;
  strategyId: string;
  strategyVersion: string;
  costModelVersion: string;
  split: "train" | "validation" | "blind";
  startedAt?: Date;
};

export type CompleteBacktestRunInput = {
  runId: string;
  status: Extract<BacktestRunStatus, "completed" | "failed">;
  evidenceDigest?: string;
  errorMessage?: string;
  completedAt?: Date;
};

export type InsertBacktestResultInput = {
  id: string;
  runId: string;
  regimeLabel: string;
  metrics: BacktestRegimeMetrics[];
};

function mapRunRow(row: typeof pgSchema.traderBacktestRuns.$inferSelect): BacktestRunView {
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

function mapResultRow(row: typeof pgSchema.traderBacktestResults.$inferSelect): BacktestResultView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    runId: row.runId,
    regimeLabel: row.regimeLabel,
    metrics: JSON.parse(row.metricsJson) as BacktestRegimeMetrics[],
    createdAt: row.createdAt,
  };
}

export async function createBacktestRunPostgres(
  ex: PgBacktestExecutor,
  context: OrgContext,
  input: CreateBacktestRunInput,
): Promise<BacktestRunView> {
  const scoped = requireOrgContext(context.organizationId);
  const now = input.startedAt ?? new Date();

  await ex.insert(pgSchema.traderBacktestRuns).values({
    id: input.id,
    organizationId: scoped.organizationId,
    datasetId: input.datasetId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    costModelVersion: input.costModelVersion,
    split: input.split,
    status: "running",
    startedAt: now,
    completedAt: null,
    evidenceDigest: null,
    errorMessage: null,
    createdAt: now,
  });

  const run = await getBacktestRunByIdPostgres(ex, context, input.id);
  if (!run) {
    throw new Error("BACKTEST_RUN_INSERT_FAILED");
  }
  return run;
}

export async function getValidationBacktestRunForDatasetPostgres(
  ex: PgBacktestReadExecutor,
  context: OrgContext,
  datasetId: string,
): Promise<BacktestRunView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderBacktestRuns)
    .where(
      and(
        eq(pgSchema.traderBacktestRuns.datasetId, datasetId),
        eq(pgSchema.traderBacktestRuns.split, "validation"),
        orgScopedWhere(pgSchema.traderBacktestRuns.organizationId, scoped),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? mapRunRow(row) : null;
}

export async function getBacktestRunByIdPostgres(
  ex: PgBacktestReadExecutor,
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
  const row = rows[0];
  return row ? mapRunRow(row) : null;
}

export async function completeBacktestRunPostgres(
  ex: PgBacktestExecutor,
  context: OrgContext,
  input: CompleteBacktestRunInput,
): Promise<BacktestRunView> {
  const scoped = requireOrgContext(context.organizationId);
  const completedAt = input.completedAt ?? new Date();

  await ex
    .update(pgSchema.traderBacktestRuns)
    .set({
      status: input.status,
      evidenceDigest: input.evidenceDigest ?? null,
      errorMessage: input.errorMessage ?? null,
      completedAt,
    })
    .where(
      and(
        eq(pgSchema.traderBacktestRuns.id, input.runId),
        orgScopedWhere(pgSchema.traderBacktestRuns.organizationId, scoped),
      ),
    );

  const run = await getBacktestRunByIdPostgres(ex, context, input.runId);
  if (!run) {
    throw new Error("BACKTEST_RUN_COMPLETE_FAILED");
  }
  return run;
}

export async function insertBacktestResultPostgres(
  ex: PgBacktestExecutor,
  context: OrgContext,
  input: InsertBacktestResultInput,
): Promise<BacktestResultView> {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date();

  await ex.insert(pgSchema.traderBacktestResults).values({
    id: input.id,
    organizationId: scoped.organizationId,
    runId: input.runId,
    regimeLabel: input.regimeLabel,
    metricsJson: JSON.stringify(input.metrics),
    createdAt: now,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderBacktestResults)
    .where(
      and(
        eq(pgSchema.traderBacktestResults.id, input.id),
        orgScopedWhere(pgSchema.traderBacktestResults.organizationId, scoped),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("BACKTEST_RESULT_INSERT_FAILED");
  }
  return mapResultRow(row);
}
