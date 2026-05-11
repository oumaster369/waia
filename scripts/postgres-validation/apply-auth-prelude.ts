/**
 * Applies the minimal `auth.users` stub required for `db/migrations_postgres` FKs
 * on bare Postgres (see prelude-auth-stub.sql). Local / CI only — not production auth.
 */

import postgres from "postgres";

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

  const sql = postgres(databaseUrlPostgres, { max: 1 });
  try {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth`);
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS auth.users ( id uuid PRIMARY KEY )`);
    console.log("[waia] Postgres auth prelude applied (auth.users stub).");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error("[waia] auth prelude failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
