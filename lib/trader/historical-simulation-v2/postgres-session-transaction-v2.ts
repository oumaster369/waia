import {
  POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS,
  withPostgresSerializableTransactionRetry,
  withPostgresSessionTransaction,
  type PostgresSessionTransactionIsolation,
} from "@/db/postgres-session-transaction";

export type PostgresSessionTransactionIsolationV2 =
  PostgresSessionTransactionIsolation;

export const POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS_V2 =
  POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS;

/**
 * Runs a transaction on either a normal postgres.js pool handle or a connection
 * returned by `reserve()`. postgres.js reserved handles are callable query
 * functions but do not expose `begin()` at runtime, despite the public type
 * currently inheriting it. Manual control is therefore required to preserve
 * the exact backend that owns a session advisory lock.
 */
export async function withPostgresSessionTransactionV2<T>(
  sql: Parameters<typeof withPostgresSessionTransaction>[0],
  isolation: PostgresSessionTransactionIsolationV2,
  callback: Parameters<typeof withPostgresSessionTransaction<T>>[2],
): Promise<T> {
  return withPostgresSessionTransaction(sql, isolation, callback);
}

/**
 * Bounded retry for PostgreSQL serialization failures only. Each attempt opens
 * a fresh SERIALIZABLE transaction/snapshot. A reserved handle remains bound
 * to its original backend because the same callable handle is reused.
 */
export async function withPostgresSerializableTransactionRetryV2<T>(
  sql: Parameters<typeof withPostgresSerializableTransactionRetry>[0],
  callback: Parameters<typeof withPostgresSerializableTransactionRetry<T>>[1],
): Promise<T> {
  return withPostgresSerializableTransactionRetry(sql, callback);
}
