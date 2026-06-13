import "server-only";

import { eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { traderOrgProfiles } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type TraderOrgProfileRow = {
  id: string;
  organizationId: string;
};

export function getTraderOrgProfileSqlite(
  db: WaiaDb,
  context: OrgContext,
): TraderOrgProfileRow | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select({
      id: traderOrgProfiles.id,
      organizationId: traderOrgProfiles.organizationId,
    })
    .from(traderOrgProfiles)
    .where(orgScopedWhere(traderOrgProfiles.organizationId, scoped))
    .limit(1)
    .all()[0];

  return row ?? null;
}

export async function getTraderOrgProfilePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
): Promise<TraderOrgProfileRow | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select({
      id: pgSchema.traderOrgProfiles.id,
      organizationId: pgSchema.traderOrgProfiles.organizationId,
    })
    .from(pgSchema.traderOrgProfiles)
    .where(orgScopedWhere(pgSchema.traderOrgProfiles.organizationId, scoped))
    .limit(1);

  return rows[0] ?? null;
}

export function insertTraderOrgProfileSqlite(
  db: WaiaDb,
  organizationId: string,
): TraderOrgProfileRow {
  const scoped = requireOrgContext(organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(traderOrgProfiles)
    .values({
      id,
      organizationId: scoped.organizationId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { id, organizationId: scoped.organizationId };
}

export async function insertTraderOrgProfilePostgres(
  ex: PgWriteExecutor,
  organizationId: string,
): Promise<TraderOrgProfileRow> {
  const scoped = requireOrgContext(organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderOrgProfiles).values({
    id,
    organizationId: scoped.organizationId,
    createdAt: now,
    updatedAt: now,
  });

  return { id, organizationId: scoped.organizationId };
}

/** Direct lookup by primary key (admin/test paths only — not org-scoped). */
export function getTraderOrgProfileByIdSqlite(
  db: WaiaDb,
  profileId: string,
): TraderOrgProfileRow | null {
  const row = db
    .select({
      id: traderOrgProfiles.id,
      organizationId: traderOrgProfiles.organizationId,
    })
    .from(traderOrgProfiles)
    .where(eq(traderOrgProfiles.id, profileId))
    .limit(1)
    .all()[0];

  return row ?? null;
}
