import type postgres from "postgres";

export type PostgresSessionTransactionIsolationV2 =
  | "SERIALIZABLE"
  | "REPEATABLE READ";

export const POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS_V2 = 3;

type BeginCapableSql = Readonly<{
  begin?: postgres.Sql["begin"];
}>;

/**
 * Runs a transaction on either a normal postgres.js pool handle or a connection
 * returned by `reserve()`. postgres.js reserved handles are callable query
 * functions but do not expose `begin()` at runtime, despite the public type
 * currently inheriting it. Manual control is therefore required to preserve
 * the exact backend that owns a session advisory lock.
 */
export async function withPostgresSessionTransactionV2<T>(
  sql: postgres.Sql,
  isolation: PostgresSessionTransactionIsolationV2,
  callback: (transaction: postgres.Sql) => Promise<T>,
): Promise<T> {
  const begin = (sql as unknown as BeginCapableSql).begin;
  if (typeof begin === "function") {
    const option = isolation === "SERIALIZABLE"
      ? "isolation level serializable"
      : "isolation level repeatable read";
    const result = await sql.begin(option, (transaction) =>
      callback(transaction as unknown as postgres.Sql));
    return result as T;
  }

  if (isolation === "SERIALIZABLE") {
    await sql`BEGIN ISOLATION LEVEL SERIALIZABLE`;
  } else {
    await sql`BEGIN ISOLATION LEVEL REPEATABLE READ`;
  }
  try {
    const result = await callback(sql);
    await sql`COMMIT`;
    return result;
  } catch (error) {
    try {
      await sql`ROLLBACK`;
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "POSTGRES_SESSION_TRANSACTION_ROLLBACK_FAILED",
      );
    }
    throw error;
  }
}

/**
 * Bounded retry for PostgreSQL serialization failures only. Each attempt opens
 * a fresh SERIALIZABLE transaction/snapshot. A reserved handle remains bound
 * to its original backend because the same callable handle is reused.
 */
export async function withPostgresSerializableTransactionRetryV2<T>(
  sql: postgres.Sql,
  callback: (transaction: postgres.Sql) => Promise<T>,
): Promise<T> {
  for (let attempt = 1;
    attempt <= POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS_V2;
    attempt += 1) {
    try {
      return await withPostgresSessionTransactionV2(sql, "SERIALIZABLE", callback);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      if (code !== "40001" ||
          attempt === POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS_V2) {
        throw error;
      }
    }
  }
  throw new Error("POSTGRES_SERIALIZABLE_TRANSACTION_RETRY_EXHAUSTED");
}
