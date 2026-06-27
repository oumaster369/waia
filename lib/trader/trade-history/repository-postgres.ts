import "server-only";

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  InsertTradeHistorySnapshotRowInput,
  ListTradeHistorySnapshotsQuery,
  TradeHistorySnapshotRow,
} from "@/lib/trader/trade-history/types";
import {
  DEFAULT_TRADE_HISTORY_SNAPSHOTS_LIST_LIMIT,
  MAX_TRADE_HISTORY_SNAPSHOTS_LIST_LIMIT,
} from "@/lib/trader/trade-history/sync-api.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapRow(
  row: typeof pgSchema.traderTradeHistorySnapshots.$inferSelect,
): TradeHistorySnapshotRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    credentialId: row.credentialId,
    venue: row.venue,
    exchangeAccountId: row.exchangeAccountId,
    symbol: row.symbol,
    trades: row.trades,
    tradeCount: row.tradeCount,
    syncedAt: row.syncedAt,
    createdAt: row.createdAt,
  };
}

function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_TRADE_HISTORY_SNAPSHOTS_LIST_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (normalized <= 0) {
    return DEFAULT_TRADE_HISTORY_SNAPSHOTS_LIST_LIMIT;
  }
  return Math.min(normalized, MAX_TRADE_HISTORY_SNAPSHOTS_LIST_LIMIT);
}

export async function insertTradeHistorySnapshotRowPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: InsertTradeHistorySnapshotRowInput,
): Promise<TradeHistorySnapshotRow> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderTradeHistorySnapshots).values({
    id,
    organizationId: scoped.organizationId,
    credentialId: input.credentialId,
    venue: input.venue,
    exchangeAccountId: input.exchangeAccountId,
    symbol: input.symbol,
    trades: JSON.stringify(input.trades),
    tradeCount: input.tradeCount,
    syncedAt: input.syncedAt,
    createdAt: now,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderTradeHistorySnapshots)
    .where(
      and(
        eq(pgSchema.traderTradeHistorySnapshots.id, id),
        orgScopedWhere(pgSchema.traderTradeHistorySnapshots.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] trade history snapshot insert failed");
  }
  return mapRow(rows[0]);
}

export async function listTradeHistorySnapshotRowsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  query: ListTradeHistorySnapshotsQuery = {},
): Promise<TradeHistorySnapshotRow[]> {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);

  const conditions = [orgScopedWhere(pgSchema.traderTradeHistorySnapshots.organizationId, scoped)];
  if (query.credentialId) {
    conditions.push(eq(pgSchema.traderTradeHistorySnapshots.credentialId, query.credentialId));
  }
  if (query.symbol) {
    conditions.push(eq(pgSchema.traderTradeHistorySnapshots.symbol, query.symbol));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderTradeHistorySnapshots)
    .where(and(...conditions))
    .orderBy(desc(pgSchema.traderTradeHistorySnapshots.syncedAt))
    .limit(limit);

  return rows.map(mapRow);
}
