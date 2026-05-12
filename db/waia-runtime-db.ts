import "server-only";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import { getDb } from "@/db/client";
import {
  createPerRequestPostgresRuntime,
  disposePostgresClientSafely,
  getPostgresDrizzle,
  shouldUsePerRequestPostgresClient,
  type PostgresDisposeOutcome,
} from "@/db/postgres-client";
import { getResolvedWaiaDbRuntimeConfig } from "@/db/runtime-backend";
import type { WaiaDb } from "@/db/types";
import * as pgSchema from "@/db/schema.postgres";

/**
 * Discriminated database handle for runtime routing (DEE-64B2 Slice C1).
 * Do not pass to persistence helpers expecting {@link WaiaDb} until Postgres paths are implemented.
 *
 * DEE-110: When `kind === "postgres"` and `_sql` is set, caller must {@link disposeWaiaRuntimeDb} in `finally`.
 */
export type WaiaRuntimeDb =
  | { kind: "sqlite"; db: WaiaDb }
  | {
      kind: "postgres";
      db: PostgresJsDatabase<typeof pgSchema>;
      /** Present only in per-request mode; dispose target. */
      _sql?: postgres.Sql;
    };

/**
 * Resolves the configured backend via {@link getResolvedWaiaDbRuntimeConfig}.
 * SQLite uses sync {@link getDb}; Postgres uses per-request client (default) or legacy singleton.
 *
 * No React `cache()` — each caller owns lifecycle (DEE-110).
 */
export async function getWaiaRuntimeDb(): Promise<WaiaRuntimeDb> {
  const config = getResolvedWaiaDbRuntimeConfig();
  if (config.backend === "sqlite") {
    return Promise.resolve({ kind: "sqlite", db: getDb() });
  }
  if (shouldUsePerRequestPostgresClient()) {
    return createPerRequestPostgresRuntime();
  }
  return { kind: "postgres", db: getPostgresDrizzle() };
}

/** Release per-request Postgres sockets; safe no-op for SQLite and singleton Postgres. */
export async function disposeWaiaRuntimeDb(
  handle: WaiaRuntimeDb | undefined,
): Promise<PostgresDisposeOutcome | undefined> {
  if (!handle || handle.kind !== "postgres" || !handle._sql) {
    return undefined;
  }
  return disposePostgresClientSafely(handle._sql);
}
