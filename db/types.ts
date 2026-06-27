import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as WaiaSQLiteSchema from "@/db/schema";

/** Neutral DB handle for the SQLite runtime (DEE-64B1). Postgres will extend this naming in DEE-64B2. */
export type WaiaDb = BetterSQLite3Database<typeof WaiaSQLiteSchema>;

/**
 * Legacy name used by unmigrated OAuth, dashboard, and reasoning modules.
 * @deprecated Use {@link WaiaDb}.
 */
export type WaiaSqliteDb = WaiaDb;

/**
 * Drizzle SQLite `transaction` executes synchronously. This wraps the synchronous
 * callback result in a resolved Promise so route handlers stay `await`-compatible,
 * matching the upcoming Postgres branch without faking inner async semantics.
 */
export function runSqliteTransaction<T>(db: WaiaDb, fn: (tx: WaiaDb) => T): Promise<T> {
  try {
    return Promise.resolve(db.transaction((tx) => fn(tx as WaiaDb)));
  } catch (error) {
    return Promise.reject(error);
  }
}
