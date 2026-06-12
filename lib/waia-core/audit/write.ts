import "server-only";

import type { WaiaDb } from "@/db/types";
import { auditLogs } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { AuditLogInput } from "@/lib/waia-core/types";

type PgWriteExecutor = Pick<WaiaPostgresDb, "insert">;

/** Append-only audit write (SQLite). Updates/deletes are rejected by app discipline + Postgres RLS. */
export function writeAuditLogSqlite(db: WaiaDb, input: AuditLogInput): string {
  const id = crypto.randomUUID();
  db.insert(auditLogs)
    .values({
      id,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      organizationId: input.organizationId ?? null,
      metadataJson: JSON.stringify(input.metadata ?? {}),
    })
    .run();
  return id;
}

/** Append-only audit write (Postgres). `metadata_json` is jsonb (object passed directly). */
export async function writeAuditLogPostgres(
  ex: PgWriteExecutor,
  input: AuditLogInput,
): Promise<string> {
  const id = crypto.randomUUID();
  await ex.insert(pgSchema.auditLogs).values({
    id,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    organizationId: input.organizationId ?? null,
    metadataJson: input.metadata ?? {},
  });
  return id;
}
