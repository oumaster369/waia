import "server-only";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { getDb } from "@/db/client";
import { getPostgresDrizzle } from "@/db/postgres-client";
import { getResolvedWaiaDbRuntimeConfig } from "@/db/runtime-backend";
import type { WaiaDb } from "@/db/types";
import * as pgSchema from "@/db/schema.postgres";

/**
 * Discriminated database handle for runtime routing (DEE-64B2 Slice C1).
 * Do not pass to persistence helpers expecting {@link WaiaDb} until Postgres paths are implemented.
 */
export type WaiaRuntimeDb =
  | { kind: "sqlite"; db: WaiaDb }
  | { kind: "postgres"; db: PostgresJsDatabase<typeof pgSchema> };

/**
 * Resolves the configured backend via {@link getResolvedWaiaDbRuntimeConfig}.
 * SQLite uses sync {@link getDb}; Postgres uses {@link getPostgresDrizzle}.
 */
export async function getWaiaRuntimeDb(): Promise<WaiaRuntimeDb> {
  const config = getResolvedWaiaDbRuntimeConfig();
  if (config.backend === "sqlite") {
    return Promise.resolve({ kind: "sqlite", db: getDb() });
  }
  return { kind: "postgres", db: getPostgresDrizzle() };
}
