import "server-only";

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
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

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapRow(row: typeof pgSchema.traderPositionSnapshots.$inferSelect): PositionSnapshotRow {
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

export async function insertPositionSnapshotRowPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: InsertPositionSnapshotRowInput,
): Promise<PositionSnapshotRow> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderPositionSnapshots).values({
    id,
    organizationId: scoped.organizationId,
    credentialId: input.credentialId,
    venue: input.venue,
    exchangeAccountId: input.exchangeAccountId,
    positions: JSON.stringify(input.positions),
    positionCount: input.positionCount,
    syncedAt: input.syncedAt,
    createdAt: now,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderPositionSnapshots)
    .where(
      and(
        eq(pgSchema.traderPositionSnapshots.id, id),
        orgScopedWhere(pgSchema.traderPositionSnapshots.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] position snapshot insert failed");
  }
  return mapRow(rows[0]);
}

export async function listPositionSnapshotRowsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  query: ListPositionSnapshotsQuery = {},
): Promise<PositionSnapshotRow[]> {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);

  const conditions = [orgScopedWhere(pgSchema.traderPositionSnapshots.organizationId, scoped)];
  if (query.credentialId) {
    conditions.push(eq(pgSchema.traderPositionSnapshots.credentialId, query.credentialId));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderPositionSnapshots)
    .where(and(...conditions))
    .orderBy(desc(pgSchema.traderPositionSnapshots.syncedAt))
    .limit(limit);

  return rows.map(mapRow);
}
