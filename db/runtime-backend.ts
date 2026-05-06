import "server-only";

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
