import "server-only";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { runSqliteTransaction, type WaiaDb } from "@/db/types";

const WAIA_POSTGRES_TRANSACTION_UNSUPPORTED =
  "[waia] Postgres transactions are not supported yet (DEE-64 D6+). Use WAIA_DB_BACKEND=sqlite or call runWaiaSqliteLegacyTransaction with a WaiaDb until Postgres transaction support ships.";

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

/**
 * Runtime-handle seam for transaction policy (DEE-64 D4). **Not** a cross-backend transaction API.
 *
 * - **`fn` is used only when `handle.kind === "sqlite"`** — it receives a SQLite-shaped {@link WaiaDb}
 *   inside {@link runWaiaSqliteLegacyTransaction} / {@link runSqliteTransaction}.
 * - **`handle.kind === "postgres"`** rejects the returned promise immediately with a fixed error:
 *   {@link WaiaSqliteTransactionCallback} does not apply; **`fn` is never invoked**. Postgres
 *   transaction support will use separate types (D6+).
 */
export function runWaiaTransactionOnRuntime<T>(
  handle: WaiaRuntimeDb,
  fn: WaiaSqliteTransactionCallback<T>,
): Promise<T> {
  if (handle.kind === "sqlite") {
    return runWaiaSqliteLegacyTransaction(handle.db, fn);
  }
  return Promise.reject(new Error(WAIA_POSTGRES_TRANSACTION_UNSUPPORTED));
}
