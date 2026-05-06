import "server-only";

import { runSqliteTransaction, type WaiaDb } from "@/db/types";

/**
 * SQLite-only legacy transaction entry point (DEE-64B2 Slice D1).
 *
 * **Semantics:** Identical to {@link runSqliteTransaction}. Drizzle on better-sqlite3 executes
 * `db.transaction` **synchronously**; the callback runs to completion before control returns.
 * The returned `Promise` only adapts sync completion for `await` in route handlers.
 *
 * **Constraint:** The callback must not `await` async I/O; inner async work is not part of the
 * SQLite transaction boundary (same as today). A future Postgres/async transaction layer will
 * replace or complement this API.
 *
 * **Transitional:** Prefer this export for new call sites so transaction policy is centralized
 * before multi-backend work lands; behavior is unchanged from {@link runSqliteTransaction}.
 */
export function runWaiaSqliteLegacyTransaction<T>(db: WaiaDb, fn: (tx: WaiaDb) => T): Promise<T> {
  return runSqliteTransaction(db, fn);
}
