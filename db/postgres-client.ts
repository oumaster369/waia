import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const skipServerOnlyGuard =
  process.env.WAIA_POSTGRES_CLI === "1" || process.env.VITEST === "true";

if (!skipServerOnlyGuard) {
  require("server-only");
}

import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";

type GlobalPostgres = typeof globalThis & {
  __waia_postgres_js__?: postgres.Sql;
  __waia_postgres_drizzle__?: PostgresJsDatabase<typeof pgSchema>;
};

const globalStore = globalThis as GlobalPostgres;

function ensurePostgresSingleton(): {
  sql: postgres.Sql;
  db: PostgresJsDatabase<typeof pgSchema>;
} {
  if (!globalStore.__waia_postgres_drizzle__ || !globalStore.__waia_postgres_js__) {
    const url = process.env.DATABASE_URL_POSTGRES?.trim();
    if (!url) {
      throw new Error("[waia] DATABASE_URL_POSTGRES is not set or empty.");
    }
    const sql = postgres(url, { max: 1 });
    const db = drizzle(sql, { schema: pgSchema });
    globalStore.__waia_postgres_js__ = sql;
    globalStore.__waia_postgres_drizzle__ = db;
  }
  return {
    sql: globalStore.__waia_postgres_js__!,
    db: globalStore.__waia_postgres_drizzle__!,
  };
}

/** Lazy Postgres + Drizzle singleton (schema.postgres). Not wired to app runtime yet (DEE-64B2). */
export function getPostgresDrizzle(): PostgresJsDatabase<typeof pgSchema> {
  return ensurePostgresSingleton().db;
}

/** Raw `postgres` driver for low-level SQL (e.g. smoke cleanup). */
export function getPostgresSql(): postgres.Sql {
  return ensurePostgresSingleton().sql;
}

/** Testing only: closes the client and clears cached handles. */
export async function resetPostgresSingletonForTests(): Promise<void> {
  try {
    await globalStore.__waia_postgres_js__?.end({ timeout: 5 });
  } catch {
    /* ignore close errors during parallel teardown */
  }
  globalStore.__waia_postgres_js__ = undefined;
  globalStore.__waia_postgres_drizzle__ = undefined;
}
