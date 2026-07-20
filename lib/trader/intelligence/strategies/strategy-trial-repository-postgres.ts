import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { StrategyTrialEvent } from "@/lib/trader/intelligence/strategies/strategy-trial.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type InsertStrategyTrialRow = Omit<StrategyTrialEvent, "createdAt"> & {
  createdAt?: string;
};

function mapRow(row: typeof pgSchema.traderStrategyTrial.$inferSelect): StrategyTrialEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    accountKey: row.accountKey,
    portfolioId: row.portfolioId,
    seq: row.seq,
    eventTime: row.eventTime.toISOString(),
    ingestTime: row.ingestTime.toISOString(),
    registeredBy: row.registeredBy,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt.toISOString(),
  };
}

export type StrategyTrialRepository = {
  findByBusinessKey(
    context: OrgContext,
    key: {
      strategyId: string;
      strategyVersion: string;
      runId: string;
      cycleId: string;
      symbol: string;
    },
  ): Promise<StrategyTrialEvent | null>;
  countByRun(
    context: OrgContext,
    strategyId: string,
    strategyVersion: string,
    runId: string,
  ): Promise<number>;
  getMaxSeq(
    context: OrgContext,
    strategyId: string,
    strategyVersion: string,
    runId: string,
  ): Promise<number | null>;
  insert(context: OrgContext, row: InsertStrategyTrialRow): Promise<StrategyTrialEvent>;
};

export function createStrategyTrialRepositoryPostgres(
  ex: PgReadExecutor & PgWriteExecutor,
): StrategyTrialRepository {
  return {
    async findByBusinessKey(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderStrategyTrial)
        .where(
          and(
            orgScopedWhere(pgSchema.traderStrategyTrial.organizationId, scoped),
            eq(pgSchema.traderStrategyTrial.strategyId, key.strategyId),
            eq(pgSchema.traderStrategyTrial.strategyVersion, key.strategyVersion),
            eq(pgSchema.traderStrategyTrial.runId, key.runId),
            eq(pgSchema.traderStrategyTrial.cycleId, key.cycleId),
            eq(pgSchema.traderStrategyTrial.symbol, key.symbol),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async countByRun(context, strategyId, strategyVersion, runId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select({ count: sql<number>`count(*)::int` })
        .from(pgSchema.traderStrategyTrial)
        .where(
          and(
            orgScopedWhere(pgSchema.traderStrategyTrial.organizationId, scoped),
            eq(pgSchema.traderStrategyTrial.strategyId, strategyId),
            eq(pgSchema.traderStrategyTrial.strategyVersion, strategyVersion),
            eq(pgSchema.traderStrategyTrial.runId, runId),
          ),
        );
      return rows[0]?.count ?? 0;
    },

    async getMaxSeq(context, strategyId, strategyVersion, runId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select({ seq: pgSchema.traderStrategyTrial.seq })
        .from(pgSchema.traderStrategyTrial)
        .where(
          and(
            orgScopedWhere(pgSchema.traderStrategyTrial.organizationId, scoped),
            eq(pgSchema.traderStrategyTrial.strategyId, strategyId),
            eq(pgSchema.traderStrategyTrial.strategyVersion, strategyVersion),
            eq(pgSchema.traderStrategyTrial.runId, runId),
          ),
        )
        .orderBy(sql`${pgSchema.traderStrategyTrial.seq} DESC`)
        .limit(1);
      return rows[0]?.seq ?? null;
    },

    async insert(context, row) {
      const scoped = requireOrgContext(context.organizationId);
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();

      await ex.insert(pgSchema.traderStrategyTrial).values({
        id: row.id,
        organizationId: scoped.organizationId,
        strategyId: row.strategyId,
        strategyVersion: row.strategyVersion,
        runId: row.runId,
        cycleId: row.cycleId,
        symbol: row.symbol,
        accountKey: row.accountKey,
        portfolioId: row.portfolioId,
        seq: row.seq,
        eventTime: new Date(row.eventTime),
        ingestTime: new Date(row.ingestTime),
        registeredBy: row.registeredBy,
        contentDigest: row.contentDigest,
        createdAt,
      });

      const rows = await ex
        .select()
        .from(pgSchema.traderStrategyTrial)
        .where(
          and(
            eq(pgSchema.traderStrategyTrial.id, row.id),
            orgScopedWhere(pgSchema.traderStrategyTrial.organizationId, scoped),
          ),
        )
        .limit(1);

      if (!rows[0]) {
        throw new Error("[wp16] strategy trial insert failed");
      }
      return mapRow(rows[0]);
    },
  };
}
