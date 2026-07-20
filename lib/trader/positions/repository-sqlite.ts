import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { traderPositionSnapshots } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type {
  InsertPositionSnapshotRowInput,
  ListPositionSnapshotsQuery,
  PositionSnapshotRow,
} from "@/lib/trader/positions/types";
import {
  DEFAULT_POSITION_SNAPSHOTS_LIST_LIMIT,
  MAX_POSITION_SNAPSHOTS_LIST_LIMIT,
} from "@/lib/trader/positions/sync-api.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapRow(row: typeof traderPositionSnapshots.$inferSelect): PositionSnapshotRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    credentialId: row.credentialId,
    venue: row.venue,
    exchangeAccountId: row.exchangeAccountId,
    positions: row.positions,
    positionCount: row.positionCount,
    syncedAt: row.syncedAt,
    createdAt: row.createdAt,
  };
}

function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_POSITION_SNAPSHOTS_LIST_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (normalized <= 0) {
    return DEFAULT_POSITION_SNAPSHOTS_LIST_LIMIT;
  }
  return Math.min(normalized, MAX_POSITION_SNAPSHOTS_LIST_LIMIT);
}

export function insertPositionSnapshotRowSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: InsertPositionSnapshotRowInput,
): PositionSnapshotRow {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(traderPositionSnapshots)
    .values({
      id,
      organizationId: scoped.organizationId,
      credentialId: input.credentialId,
      venue: input.venue,
      exchangeAccountId: input.exchangeAccountId,
      positions: JSON.stringify(input.positions),
      positionCount: input.positionCount,
      syncedAt: input.syncedAt,
      createdAt: now,
    })
    .run();

  const row = db
    .select()
    .from(traderPositionSnapshots)
    .where(
      and(
        eq(traderPositionSnapshots.id, id),
        orgScopedWhere(traderPositionSnapshots.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[trader] position snapshot insert failed");
  }
  return mapRow(row);
}

export function listPositionSnapshotRowsSqlite(
  db: WaiaDb,
  context: OrgContext,
  query: ListPositionSnapshotsQuery = {},
): PositionSnapshotRow[] {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);

  const conditions = [orgScopedWhere(traderPositionSnapshots.organizationId, scoped)];
  if (query.credentialId) {
    conditions.push(eq(traderPositionSnapshots.credentialId, query.credentialId));
  }

  return db
    .select()
    .from(traderPositionSnapshots)
    .where(and(...conditions))
    .orderBy(desc(traderPositionSnapshots.syncedAt))
    .limit(limit)
    .all()
    .map(mapRow);
}
