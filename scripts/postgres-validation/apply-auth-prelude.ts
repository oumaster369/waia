/**
 * Applies the Postgres migration-validation prelude (see prelude-auth-stub.sql):
 *   * NOLOGIN `authenticated` / `anon` role stubs (RLS policies from 0004 onward)
 *   * minimal `auth.users` stub (migration FKs)
 *
 * The SQL file is the single source of truth — this script reads and executes it
 * verbatim so the programmatic path and the documented `psql -f` path cannot drift.
 *
 * Local / CI only — not production auth. Host guard restricts to localhost.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const PRELUDE_SQL_PATH = fileURLToPath(new URL("./prelude-auth-stub.sql", import.meta.url));

function assertLocalPostgres(connectionString: string): void {
  let host: string;
  try {
    const normalized = connectionString.replace(/^postgresql:\/\//i, "http://");
    host = new URL(normalized).hostname;
  } catch {
    throw new Error("DATABASE_URL_POSTGRES is not a valid URL.");
  }
  const allowed = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!allowed) {
    throw new Error(
      `host "${host}" is not allowed for auth prelude — use local Postgres only (127.0.0.1 / localhost).`,
    );
  }
}

async function main(): Promise<void> {
  const databaseUrlPostgres = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!databaseUrlPostgres) {
    throw new Error("DATABASE_URL_POSTGRES is not set.");
  }

  assertLocalPostgres(databaseUrlPostgres);

  const preludeSql = readFileSync(PRELUDE_SQL_PATH, "utf8");

  const sql = postgres(databaseUrlPostgres, { max: 1 });
  try {
    // Simple query protocol so the multi-statement prelude (DO block + DDL) runs as one batch.
    await sql.unsafe(preludeSql).simple();
    console.log(
      "[waia] Postgres auth prelude applied (authenticated/anon roles + auth.users stub).",
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error("[waia] auth prelude failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
