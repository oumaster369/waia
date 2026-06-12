import "server-only";

import { desc, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { auditLogs, userPlatformRoles } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

export type AuditLogRow = {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  organizationId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export function listAuditLogsForAdminSqlite(
  db: WaiaDb,
  params: { adminUserId: string; organizationId?: string; limit?: number },
): AuditLogRow[] {
  const roleRow = db
    .select({ role: userPlatformRoles.role })
    .from(userPlatformRoles)
    .where(eq(userPlatformRoles.userId, params.adminUserId))
    .limit(1)
    .all()[0];

  if (roleRow?.role !== "admin") {
    return [];
  }

  const rows = params.organizationId
    ? db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, params.organizationId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(params.limit ?? 50)
        .all()
    : db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(params.limit ?? 50)
        .all();

  return rows.map((row) => ({
    id: row.id,
    actorType: row.actorType,
    actorId: row.actorId ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId ?? null,
    organizationId: row.organizationId ?? null,
    metadata: JSON.parse(row.metadataJson ?? "{}") as Record<string, unknown>,
    createdAt: new Date(row.createdAt),
  }));
}

/** Postgres parity for {@link listAuditLogsForAdminSqlite}. Admin-only; returns [] for non-admins. */
export async function listAuditLogsForAdminPostgres(
  ex: PgReadExecutor,
  params: { adminUserId: string; organizationId?: string; limit?: number },
): Promise<AuditLogRow[]> {
  const roleRows = await ex
    .select({ role: pgSchema.userPlatformRoles.role })
    .from(pgSchema.userPlatformRoles)
    .where(eq(pgSchema.userPlatformRoles.userId, params.adminUserId))
    .limit(1);

  if (roleRows[0]?.role !== "admin") {
    return [];
  }

  const base = ex.select().from(pgSchema.auditLogs);
  const rows = params.organizationId
    ? await base
        .where(eq(pgSchema.auditLogs.organizationId, params.organizationId))
        .orderBy(desc(pgSchema.auditLogs.createdAt))
        .limit(params.limit ?? 50)
    : await base.orderBy(desc(pgSchema.auditLogs.createdAt)).limit(params.limit ?? 50);

  return rows.map((row) => ({
    id: row.id,
    actorType: row.actorType,
    actorId: row.actorId ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId ?? null,
    organizationId: row.organizationId ?? null,
    metadata: (row.metadataJson ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.createdAt),
  }));
}
