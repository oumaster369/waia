import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as pgSchema from "@/db/schema.postgres";

/**
 * Postgres database handle bound to {@link pgSchema} (DEE-64 D6-core).
 * Used as the explicit `db` parameter for {@link runWaiaPostgresTransaction}.
 */
export type WaiaPostgresDb = PostgresJsDatabase<typeof pgSchema>;

/**
 * Async transaction callback for Postgres (DEE-64 D6-core).
 *
 * - **Must** return `Promise<T>` (not `T | Promise<T>`).
 * - `tx` parameter is schema-bound to `db/schema.postgres.ts` and extracted from Drizzle's `transaction` signature.
 * - **Not** compatible with {@link WaiaSqliteTransactionCallback} (SQLite is sync; Postgres is async).
 *
 * Sync work can live inside the async function body; do not expect sync return for transaction semantics.
 */
export type WaiaPostgresTransactionCallback<T> = (
  tx: Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0],
) => Promise<T>;

/**
 * Explicit Postgres transaction runner (DEE-64 D6-core).
 *
 * - Delegates to `db.transaction(fn)` from `drizzle-orm/postgres-js`.
 * - **`db` must be passed explicitly** — no hidden `getPostgresDrizzle()` or env reads inside this function.
 * - **Async-only** — `fn` must return `Promise<T>`.
 * - **Schema-bound** — `tx` is typed for `db/schema.postgres.ts` (not cross-backend).
 *
 * Rollback semantics:
 * - Thrown errors or rejected promises inside `fn` trigger rollback.
 * - No claim of parity with SQLite; Postgres uses async boundaries.
 *
 * @example
 * ```ts
 * import { getPostgresDrizzle } from "@/db/postgres-client";
 * import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
 * import { users } from "@/db/schema.postgres";
 *
 * const db = getPostgresDrizzle();
 * await runWaiaPostgresTransaction(db, async (tx) => {
 *   await tx.insert(users).values({ ... });
 * });
 * ```
 */
export function runWaiaPostgresTransaction<T>(
  db: WaiaPostgresDb,
  fn: WaiaPostgresTransactionCallback<T>,
): Promise<T> {
  return db.transaction(fn);
}
