import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { StrategyLifecycleEvent } from "@/lib/trader/intelligence/strategies/strategy-lifecycle.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type InsertStrategyLifecycleEventRow = Omit<StrategyLifecycleEvent, "createdAt"> & {
  createdAt?: string;
};

function mapRow(
  row: typeof pgSchema.traderStrategyLifecycleEvent.$inferSelect,
): StrategyLifecycleEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    fromState: row.fromState as StrategyLifecycleEvent["fromState"],
    toState: row.toState as StrategyLifecycleEvent["toState"],
    actor: row.actor as StrategyLifecycleEvent["actor"],
    approvalRef: row.approvalRef,
    reasonCode: row.reasonCode,
    seq: row.seq,
    effectiveAt: row.effectiveAt.toISOString(),
    runId: row.runId,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt.toISOString(),
  };
}

export type StrategyLifecycleRepository = {
  listEvents(
    context: OrgContext,
    strategyId: string,
    strategyVersion: string,
  ): Promise<StrategyLifecycleEvent[]>;
  findBySeq(
    context: OrgContext,
    strategyId: string,
    strategyVersion: string,
    seq: number,
  ): Promise<StrategyLifecycleEvent | null>;
  insert(
    context: OrgContext,
    row: InsertStrategyLifecycleEventRow,
  ): Promise<StrategyLifecycleEvent>;
  getMaxSeq(
    context: OrgContext,
    strategyId: string,
    strategyVersion: string,
  ): Promise<number | null>;
};

export function createStrategyLifecycleRepositoryPostgres(
  ex: PgReadExecutor & PgWriteExecutor,
): StrategyLifecycleRepository {
  return {
    async listEvents(context, strategyId, strategyVersion) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderStrategyLifecycleEvent)
        .where(
          and(
            orgScopedWhere(pgSchema.traderStrategyLifecycleEvent.organizationId, scoped),
            eq(pgSchema.traderStrategyLifecycleEvent.strategyId, strategyId),
            eq(pgSchema.traderStrategyLifecycleEvent.strategyVersion, strategyVersion),
          ),
        )
        .orderBy(pgSchema.traderStrategyLifecycleEvent.seq);
      return rows.map(mapRow);
    },

    async findBySeq(context, strategyId, strategyVersion, seq) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderStrategyLifecycleEvent)
        .where(
          and(
            orgScopedWhere(pgSchema.traderStrategyLifecycleEvent.organizationId, scoped),
            eq(pgSchema.traderStrategyLifecycleEvent.strategyId, strategyId),
            eq(pgSchema.traderStrategyLifecycleEvent.strategyVersion, strategyVersion),
            eq(pgSchema.traderStrategyLifecycleEvent.seq, seq),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async getMaxSeq(context, strategyId, strategyVersion) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select({ seq: pgSchema.traderStrategyLifecycleEvent.seq })
        .from(pgSchema.traderStrategyLifecycleEvent)
        .where(
          and(
            orgScopedWhere(pgSchema.traderStrategyLifecycleEvent.organizationId, scoped),
            eq(pgSchema.traderStrategyLifecycleEvent.strategyId, strategyId),
            eq(pgSchema.traderStrategyLifecycleEvent.strategyVersion, strategyVersion),
          ),
        )
        .orderBy(desc(pgSchema.traderStrategyLifecycleEvent.seq))
        .limit(1);
      return rows[0]?.seq ?? null;
    },

    async insert(context, row) {
      const scoped = requireOrgContext(context.organizationId);
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();

      await ex.insert(pgSchema.traderStrategyLifecycleEvent).values({
        id: row.id,
        organizationId: scoped.organizationId,
        strategyId: row.strategyId,
        strategyVersion: row.strategyVersion,
        fromState: row.fromState,
        toState: row.toState,
        actor: row.actor,
        approvalRef: row.approvalRef,
        reasonCode: row.reasonCode,
        seq: row.seq,
        effectiveAt: new Date(row.effectiveAt),
        runId: row.runId,
        contentDigest: row.contentDigest,
        createdAt,
      });

      const rows = await ex
        .select()
        .from(pgSchema.traderStrategyLifecycleEvent)
        .where(
          and(
            eq(pgSchema.traderStrategyLifecycleEvent.id, row.id),
            orgScopedWhere(pgSchema.traderStrategyLifecycleEvent.organizationId, scoped),
          ),
        )
        .limit(1);

      if (!rows[0]) {
        throw new Error("[wp16] strategy lifecycle event insert failed");
      }
      return mapRow(rows[0]);
    },
  };
}
