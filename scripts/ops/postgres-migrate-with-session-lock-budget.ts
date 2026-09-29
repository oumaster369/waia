/**
 * Operator Postgres migrate (DEE-1151).
 *
 * Apply only with writers of the locked tables stopped. Do not run this during
 * a live session. A timeout is not permission to migrate concurrently: stop
 * the writers and retry the whole migrate.
 *
 * Sets session `lock_timeout` and `statement_timeout` once on the single
 * connection, then calls drizzle `migrate()`. Those are session settings, not
 * `SET LOCAL`, and this process never sets either value to `0`. The whole
 * `migrate()` transaction inherits them. The connection closes when migrate
 * returns, so nothing restores a timeout mid-transaction.
 *
 * Already-applied migration files, including 0225, stay byte-for-byte. Editing
 * them would fork `drizzle.__drizzle_migrations.hash` and fail closed with
 * APPLIED_MIGRATION_HASH_MISMATCH.
 */
import { pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { resolveDatabaseUrlPostgresForKit } from "../../drizzle/load-postgres-env-for-kit";

export const POSTGRES_MIGRATE_LOCK_TIMEOUT = "5s";
export const POSTGRES_MIGRATE_STATEMENT_TIMEOUT = "120s";
/** Raw `pg_settings.setting` units are milliseconds. SHOW pretty-prints `120s` as `2min`. */
const POSTGRES_MIGRATE_LOCK_TIMEOUT_MS = "5000";
const POSTGRES_MIGRATE_STATEMENT_TIMEOUT_MS = "120000";

export async function migratePostgresWithSessionLockBudget(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.unsafe(`SET lock_timeout = '${POSTGRES_MIGRATE_LOCK_TIMEOUT}'`);
    await sql.unsafe(`SET statement_timeout = '${POSTGRES_MIGRATE_STATEMENT_TIMEOUT}'`);
    const [row] = await sql<{ lock_timeout_ms: string; statement_timeout_ms: string }[]>`
      select (select setting from pg_settings where name = 'lock_timeout') as lock_timeout_ms,
             (select setting from pg_settings where name = 'statement_timeout') as statement_timeout_ms`;
    if (
      row?.lock_timeout_ms !== POSTGRES_MIGRATE_LOCK_TIMEOUT_MS ||
      row?.statement_timeout_ms !== POSTGRES_MIGRATE_STATEMENT_TIMEOUT_MS
    ) {
      throw new Error(
        `[waia] session lock budget was not applied before migrate() (lock_timeout=${row?.lock_timeout_ms ?? "missing"}ms statement_timeout=${row?.statement_timeout_ms ?? "missing"}ms)`,
      );
    }
    await migrate(drizzle(sql), { migrationsFolder: "db/migrations_postgres" });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}

if (isDirectRun()) {
  migratePostgresWithSessionLockBudget(resolveDatabaseUrlPostgresForKit()).catch(
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
