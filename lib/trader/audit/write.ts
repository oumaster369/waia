import "server-only";

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeAuditLogPostgres, writeAuditLogSqlite } from "@/lib/waia-core/audit/write";
import type { TraderAuditInput } from "@/lib/trader/types";

type PgAuditExecutor = Pick<WaiaPostgresDb, "insert">;

function assertTraderOrganizationId(organizationId: string): string {
  const trimmed = organizationId.trim();
  if (!trimmed) {
    throw new Error("[trader] audit write requires organizationId");
  }
  return trimmed;
}

/** Append-only trader audit write (SQLite) via WAIA Core audit stream. */
export function writeTraderAuditLogSqlite(db: WaiaDb, input: TraderAuditInput): string {
  return writeAuditLogSqlite(db, {
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    organizationId: assertTraderOrganizationId(input.organizationId),
    metadata: input.metadata,
  });
}

/** Append-only trader audit write (Postgres) via WAIA Core audit stream. */
export async function writeTraderAuditLogPostgres(
  ex: PgAuditExecutor,
  input: TraderAuditInput,
): Promise<string> {
  return writeAuditLogPostgres(ex, {
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    organizationId: assertTraderOrganizationId(input.organizationId),
    metadata: input.metadata,
  });
}
