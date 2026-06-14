import "server-only";

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  BalanceSnapshotRow,
  InsertBalanceSnapshotRowInput,
  ListBalanceSnapshotsQuery,
} from "@/lib/trader/balances/types";
import {
  DEFAULT_BALANCE_SNAPSHOTS_LIST_LIMIT,
  MAX_BALANCE_SNAPSHOTS_LIST_LIMIT,
} from "@/lib/trader/balances/sync-api.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapRow(row: typeof pgSchema.traderBalanceSnapshots.$inferSelect): BalanceSnapshotRow {
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

export async function insertBalanceSnapshotRowPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: InsertBalanceSnapshotRowInput,
): Promise<BalanceSnapshotRow> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderBalanceSnapshots).values({
    id,
    organizationId: scoped.organizationId,
    credentialId: input.credentialId,
    venue: input.venue,
    exchangeAccountId: input.exchangeAccountId,
    balances: JSON.stringify(input.balances),
    assetCount: input.assetCount,
    syncedAt: input.syncedAt,
    createdAt: now,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderBalanceSnapshots)
    .where(
      and(
        eq(pgSchema.traderBalanceSnapshots.id, id),
        orgScopedWhere(pgSchema.traderBalanceSnapshots.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] balance snapshot insert failed");
  }
  return mapRow(rows[0]);
}

export async function listBalanceSnapshotRowsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  query: ListBalanceSnapshotsQuery = {},
): Promise<BalanceSnapshotRow[]> {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);

  const conditions = [orgScopedWhere(pgSchema.traderBalanceSnapshots.organizationId, scoped)];
  if (query.credentialId) {
    conditions.push(eq(pgSchema.traderBalanceSnapshots.credentialId, query.credentialId));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderBalanceSnapshots)
    .where(and(...conditions))
    .orderBy(desc(pgSchema.traderBalanceSnapshots.syncedAt))
    .limit(limit);

  return rows.map(mapRow);
}
