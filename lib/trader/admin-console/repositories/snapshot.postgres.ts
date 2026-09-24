import { sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase, PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";

import type * as pgSchema from "@/db/schema.postgres";

export type AdminPostgresDb = PostgresJsDatabase<typeof pgSchema>;
export type AdminReadTx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof pgSchema,
  ExtractTablesWithRelations<typeof pgSchema>
>;

function firstRow(result: unknown): Record<string, unknown> | null {
  if (Array.isArray(result)) {
    const row = result[0];
    return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows) && rows[0] && typeof rows[0] === "object") {
      return rows[0] as Record<string, unknown>;
    }
  }
  return null;
}

export async function readSnapshotXmin(tx: AdminReadTx): Promise<string> {
  const result = await tx.execute(
    sql`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`,
  );
  const xmin = firstRow(result)?.xmin;
  if (typeof xmin !== "string" || xmin.length === 0) {
    throw new Error("ADMIN_SNAPSHOT_XMIN_MISSING");
  }
  return xmin;
}

export async function withAdminReadSnapshot<T>(
  db: AdminPostgresDb,
  fn: (tx: AdminReadTx) => Promise<T>,
): Promise<{ cursor: string; value: T }> {
  return db.transaction(
    async (tx) => {
      const cursor = await readSnapshotXmin(tx);
      const value = await fn(tx);
      return { cursor, value };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Bind a route response and its stream handoff to the same read-only snapshot. */
export async function withAdminRouteSnapshot<T extends { status: number; body: unknown }>(
  db: AdminPostgresDb,
  fn: (tx: AdminReadTx) => Promise<T>,
): Promise<T> {
  const snapshot = await withAdminReadSnapshot(db, fn);
  const result = snapshot.value;
  if (result.status !== 200 || !result.body || typeof result.body !== "object") return result;
  return { ...result, body: { ...result.body, cursor: snapshot.cursor } };
}
