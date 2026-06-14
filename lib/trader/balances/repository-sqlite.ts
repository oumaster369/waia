import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderBalanceSnapshots } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type {
  BalanceSnapshotRow,
  InsertBalanceSnapshotRowInput,
  ListBalanceSnapshotsQuery,
} from "@/lib/trader/balances/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

import {
  DEFAULT_BALANCE_SNAPSHOTS_LIST_LIMIT,
  MAX_BALANCE_SNAPSHOTS_LIST_LIMIT,
} from "@/lib/trader/balances/sync-api.types";

function mapRow(row: typeof traderBalanceSnapshots.$inferSelect): BalanceSnapshotRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    credentialId: row.credentialId,
    venue: row.venue,
    exchangeAccountId: row.exchangeAccountId,
    balances: row.balances,
    assetCount: row.assetCount,
    syncedAt: row.syncedAt,
    createdAt: row.createdAt,
  };
}

function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_BALANCE_SNAPSHOTS_LIST_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (normalized <= 0) {
    return DEFAULT_BALANCE_SNAPSHOTS_LIST_LIMIT;
  }
  return Math.min(normalized, MAX_BALANCE_SNAPSHOTS_LIST_LIMIT);
}

export function insertBalanceSnapshotRowSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: InsertBalanceSnapshotRowInput,
): BalanceSnapshotRow {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(traderBalanceSnapshots)
    .values({
      id,
      organizationId: scoped.organizationId,
      credentialId: input.credentialId,
      venue: input.venue,
      exchangeAccountId: input.exchangeAccountId,
      balances: JSON.stringify(input.balances),
      assetCount: input.assetCount,
      syncedAt: input.syncedAt,
      createdAt: now,
    })
    .run();

  const row = db
    .select()
    .from(traderBalanceSnapshots)
    .where(
      and(
        eq(traderBalanceSnapshots.id, id),
        orgScopedWhere(traderBalanceSnapshots.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[trader] balance snapshot insert failed");
  }
  return mapRow(row);
}

export function listBalanceSnapshotRowsSqlite(
  db: WaiaDb,
  context: OrgContext,
  query: ListBalanceSnapshotsQuery = {},
): BalanceSnapshotRow[] {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);

  const conditions = [orgScopedWhere(traderBalanceSnapshots.organizationId, scoped)];
  if (query.credentialId) {
    conditions.push(eq(traderBalanceSnapshots.credentialId, query.credentialId));
  }

  return db
    .select()
    .from(traderBalanceSnapshots)
    .where(and(...conditions))
    .orderBy(desc(traderBalanceSnapshots.syncedAt))
    .limit(limit)
    .all()
    .map(mapRow);
}
