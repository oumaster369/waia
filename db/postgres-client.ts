import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";

type GlobalPostgres = typeof globalThis & {
  __waia_postgres_js__?: postgres.Sql;
  __waia_postgres_drizzle__?: PostgresJsDatabase<typeof pgSchema>;
};

const globalStore = globalThis as GlobalPostgres;

/** Inline budget when `waitUntil` is unavailable (tests / Node); close continues in background via isolate GC if needed. */
export const POSTGRES_CLOSE_INLINE_BUDGET_MS = 200;
export const POSTGRES_CLOSE_GRACE_TIMEOUT_S = 5;

/** Result of {@link disposePostgresClientSafely}; omitted from telemetry when close was deferred via `waitUntil`. */
export type PostgresDisposeOutcome = "ok" | "timeout" | "error";

/**
 * Default **true**: one `postgres.js` client per `getWaiaRuntimeDb()` call (DEE-110 / Workers-safe).
 * Set to `false`, `0`, `no`, or `off` for emergency rollback to the legacy global singleton (known unstable on Workers).
 */
export function shouldUsePerRequestPostgresClient(): boolean {
  const raw = process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT?.trim().toLowerCase() ?? "";
  if (raw === "" || raw === "true" || raw === "1" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") {
    return false;
  }
  return true;
}

/**
 * Driver options for `postgres.js` against Supabase **transaction pooler** (and similar PgBouncer
 * transaction modes): prepared statements are unsafe/disallowed — Workers observed hung requests
 * until Cloudflare canceled them (`prepare: false` fixes that path).
 *
 * Opt into prepared statements locally only: `WAIA_POSTGRES_PREPARE_STATEMENTS=true` (direct Postgres /
 * session pooler).
 */
export function waiaPostgresJsDriverOptions(): { max: number; prepare: boolean } {
  return {
    max: 1,
    prepare: process.env.WAIA_POSTGRES_PREPARE_STATEMENTS === "true",
  };
}

function ensurePostgresSingleton(): {
  sql: postgres.Sql;
  db: PostgresJsDatabase<typeof pgSchema>;
} {
  if (!globalStore.__waia_postgres_drizzle__ || !globalStore.__waia_postgres_js__) {
    const url = process.env.DATABASE_URL_POSTGRES?.trim();
    if (!url) {
      throw new Error("[waia] DATABASE_URL_POSTGRES is not set or empty.");
    }
    const sql = postgres(url, waiaPostgresJsDriverOptions());
    const db = drizzle(sql, { schema: pgSchema });
    globalStore.__waia_postgres_js__ = sql;
    globalStore.__waia_postgres_drizzle__ = db;
  }
  return {
    sql: globalStore.__waia_postgres_js__!,
    db: globalStore.__waia_postgres_drizzle__!,
  };
}

/**
 * Creates a fresh Postgres + Drizzle pair for this request only (DEE-110).
 * Caller **must** {@link disposePostgresClientSafely} on `_sql` when done (typically in `finally`).
 */
export function createPerRequestPostgresRuntime(): {
  kind: "postgres";
  db: PostgresJsDatabase<typeof pgSchema>;
  _sql: postgres.Sql;
} {
  const url = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!url) {
    throw new Error("[waia] DATABASE_URL_POSTGRES is not set or empty.");
  }
  const sql = postgres(url, waiaPostgresJsDriverOptions());
  const db = drizzle(sql, { schema: pgSchema });
  return { kind: "postgres", db, _sql: sql };
}

/**
 * Never block the HTTP response on socket teardown: prefer `waitUntil(close)`, else bounded inline wait.
 */
export async function disposePostgresClientSafely(
  sql: postgres.Sql,
): Promise<PostgresDisposeOutcome | undefined> {
  let resolvedOutcome: PostgresDisposeOutcome = "ok";

  const closePromise = sql.end({ timeout: POSTGRES_CLOSE_GRACE_TIMEOUT_S }).then(
    () => {
      resolvedOutcome = "ok";
    },
    () => {
      resolvedOutcome = "error";
    },
  );

  try {
    const cfCtx = getCloudflareContext().ctx;
    if (cfCtx && typeof cfCtx.waitUntil === "function") {
      cfCtx.waitUntil(closePromise);
      return undefined;
    }
  } catch {
    /* sync context unavailable (Node dev, tests, static analysis path) */
  }

  const raced = await Promise.race([
    closePromise.then(() => "done" as const),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), POSTGRES_CLOSE_INLINE_BUDGET_MS),
    ),
  ]);

  if (raced === "timeout") {
    return "timeout";
  }
  return resolvedOutcome;
}

/** Scoped client for scripts/tests; tears down via {@link disposePostgresClientSafely}. */
export async function withWaiaPostgresClient<T>(
  fn: (sql: postgres.Sql, db: PostgresJsDatabase<typeof pgSchema>) => Promise<T>,
): Promise<T> {
  const { _sql, db } = createPerRequestPostgresRuntime();
  try {
    return await fn(_sql, db);
  } finally {
    await disposePostgresClientSafely(_sql);
  }
}

/** Lazy Postgres + Drizzle singleton (legacy / emergency rollback only). */
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
