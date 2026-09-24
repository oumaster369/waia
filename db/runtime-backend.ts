import "server-only";

import { workerEnvString } from "@/lib/trader/cron/worker-cron-env";

/**
 * Declares which DB backend WAIA will use once routing lands (DEE-64B2+).
 * Default remains SQLite; does not affect `getDb()` until wired.
 */

export type WaiaDbBackend = "sqlite" | "postgres";

export type ResolvedWaiaDbRuntimeConfig =
  | { backend: "sqlite" }
  | { backend: "postgres"; databaseUrlPostgres: string };

/**
 * Reads `WAIA_DB_BACKEND` (default `sqlite`) and validates env:
 * when backend is `postgres`, `DATABASE_URL_POSTGRES` must be non-empty.
 */
export function getResolvedWaiaDbRuntimeConfig(): ResolvedWaiaDbRuntimeConfig {
  const workerBackend = workerEnvString("WAIA_DB_BACKEND");
  const workerUrl = workerEnvString("DATABASE_URL_POSTGRES");
  if (workerBackend !== "" && !process.env.WAIA_DB_BACKEND?.trim()) {
    process.env.WAIA_DB_BACKEND = workerBackend;
  }
  if (workerUrl !== "" && !process.env.DATABASE_URL_POSTGRES?.trim()) {
    process.env.DATABASE_URL_POSTGRES = workerUrl;
  }
  const trimmed = process.env.WAIA_DB_BACKEND?.trim() ?? "";
  if (trimmed === "") {
    return { backend: "sqlite" };
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "sqlite") {
    return { backend: "sqlite" };
  }
  if (normalized === "postgres") {
    const databaseUrlPostgres = process.env.DATABASE_URL_POSTGRES?.trim() ?? "";
    if (databaseUrlPostgres === "") {
      throw new Error(
        "[waia] WAIA_DB_BACKEND=postgres requires a non-empty DATABASE_URL_POSTGRES.",
      );
    }
    return { backend: "postgres", databaseUrlPostgres };
  }
  throw new Error(
    `[waia] Invalid WAIA_DB_BACKEND=${JSON.stringify(process.env.WAIA_DB_BACKEND)}. Use "sqlite" or "postgres".`,
  );
}

/** Same validation as {@link getResolvedWaiaDbRuntimeConfig} (includes Postgres URL when applicable). */
export function getWaiaDbBackend(): WaiaDbBackend {
  return getResolvedWaiaDbRuntimeConfig().backend;
}
