import "server-only";

import { runSqliteTransaction, type WaiaDb } from "@/db/types";

/**
 * Transaction body for the **SQLite legacy branch** only.
 *
 * - Runs on the **better-sqlite3** synchronous `db.transaction` path; `tx` is {@link WaiaDb}.
 * - The body must stay **synchronous** for transaction semantics: do not `await` I/O expecting
 *   Postgres-style async transaction boundaries.
 * - Postgres will use a **separate** async / schema-bound contract; do not treat this type as portable.
 */
export type WaiaSqliteTransactionCallback<T> = (tx: WaiaDb) => T;

/**
 * **SQLite legacy branch** — not a cross-backend transaction API.
 *
 * Delegates to {@link runSqliteTransaction}. Identical runtime behavior.
 *
 * **Semantics:** Drizzle on better-sqlite3 executes `db.transaction` **synchronously**; the callback
 * runs to completion before control returns. The returned `Promise` only adapts sync completion for
 * `await` in route handlers.
 *
 * **Constraint:** The callback must not `await` async I/O; inner async work is not part of the
 * SQLite transaction boundary. A future Postgres/async transaction layer will use separate APIs
 * and types; it must not reuse {@link WaiaSqliteTransactionCallback} to mean async Postgres work.
 *
 * **Transitional:** Prefer this export for new call sites so SQLite transaction policy stays centralized.
 */
export function runWaiaSqliteLegacyTransaction<T>(
  db: WaiaDb,
  fn: WaiaSqliteTransactionCallback<T>,
): Promise<T> {
  return runSqliteTransaction(db, fn);
}
