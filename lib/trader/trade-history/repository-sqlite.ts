import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderTradeHistorySnapshots } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
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

function mapRow(row: typeof traderTradeHistorySnapshots.$inferSelect): TradeHistorySnapshotRow {
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

export function insertTradeHistorySnapshotRowSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: InsertTradeHistorySnapshotRowInput,
): TradeHistorySnapshotRow {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(traderTradeHistorySnapshots)
    .values({
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
    })
    .run();

  const row = db
    .select()
    .from(traderTradeHistorySnapshots)
    .where(
      and(
        eq(traderTradeHistorySnapshots.id, id),
        orgScopedWhere(traderTradeHistorySnapshots.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[trader] trade history snapshot insert failed");
  }
  return mapRow(row);
}

export function listTradeHistorySnapshotRowsSqlite(
  db: WaiaDb,
  context: OrgContext,
  query: ListTradeHistorySnapshotsQuery = {},
): TradeHistorySnapshotRow[] {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);

  const conditions = [orgScopedWhere(traderTradeHistorySnapshots.organizationId, scoped)];
  if (query.credentialId) {
    conditions.push(eq(traderTradeHistorySnapshots.credentialId, query.credentialId));
  }
  if (query.symbol) {
    conditions.push(eq(traderTradeHistorySnapshots.symbol, query.symbol));
  }

  return db
    .select()
    .from(traderTradeHistorySnapshots)
    .where(and(...conditions))
    .orderBy(desc(traderTradeHistorySnapshots.syncedAt))
    .limit(limit)
    .all()
    .map(mapRow);
}
