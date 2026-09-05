import { AsyncLocalStorage } from "node:async_hooks";

import type postgres from "postgres";

const POSTGRES_TIMESTAMPTZ_TEXT =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::?\d{2})?$/;

/** Strictly normalizes only real Date values or postgres.js raw timestamptz text. */
export function parsePostgresTimestamptz(value: unknown): Date {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error("POSTGRES_TIMESTAMPTZ_REFUSED:INVALID_DATE");
    }
    return new Date(value.getTime());
  }
  if (typeof value !== "string" || !POSTGRES_TIMESTAMPTZ_TEXT.test(value)) {
    throw new Error("POSTGRES_TIMESTAMPTZ_REFUSED:EXPLICIT_TIMEZONE_REQUIRED");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("POSTGRES_TIMESTAMPTZ_REFUSED:INVALID_TEXT");
  }
  return parsed;
}

type PostgresJsDriverCodec = (value: never) => unknown;
type PostgresJsDriverOptions = Readonly<{
  parsers: Readonly<Record<string, PostgresJsDriverCodec>>;
  serializers: Readonly<Record<string, PostgresJsDriverCodec>>;
}>;

function driverOptionsOf(sql: postgres.Sql): PostgresJsDriverOptions {
  const options = (sql as unknown as { options?: unknown }).options;
  if (!options || typeof options !== "object") {
    throw new Error("POSTGRES_RESERVED_SESSION_BINDING_REFUSED:POOL_OPTIONS");
  }
  const parsers = (options as { parsers?: unknown }).parsers;
  const serializers = (options as { serializers?: unknown }).serializers;
  if (!parsers || typeof parsers !== "object" ||
      !serializers || typeof serializers !== "object") {
    throw new Error("POSTGRES_RESERVED_SESSION_BINDING_REFUSED:POOL_CODECS");
  }
  return options as PostgresJsDriverOptions;
}

/**
 * Makes a postgres.js connection returned by `pool.reserve()` compatible with
 * Drizzle without allowing a query to escape that reserved backend.
 *
 * postgres.js deliberately omits `options` from a ReservedSql at runtime,
 * while Drizzle's postgres-js driver requires and mutates its parser and
 * serializer maps during construction. The proxy exposes isolated copies of
 * authoritative pool codec metadata: this lets Drizzle install its codecs
 * without contaminating raw ReservedSql serialization on the same connection.
 * The callable tag and every query helper still delegate to the reserved
 * handle. Pool-only transaction/reservation methods are never copied.
 */
export function bindPostgresReservedSession(
  pool: postgres.Sql,
  reserved: postgres.ReservedSql,
): postgres.Sql {
  if (typeof pool !== "function" || typeof reserved !== "function" ||
      typeof reserved.release !== "function") {
    throw new Error("POSTGRES_RESERVED_SESSION_BINDING_REFUSED:HANDLES");
  }
  const sourceOptions = driverOptionsOf(pool);
  // Drizzle serializes JSON column values before handing them to postgres.js.
  // Normalize only the shared JSON codecs to Drizzle's transparent convention.
  // This avoids heuristically parsing legitimate JSON-looking text parameters.
  const transparentJsonSerializer: PostgresJsDriverCodec = (value) => value;
  const sharedSerializers = sourceOptions.serializers as Record<
    string,
    PostgresJsDriverCodec
  >;
  sharedSerializers["114"] = transparentJsonSerializer;
  sharedSerializers["3802"] = transparentJsonSerializer;
  const driverOptions = {
    ...(pool.options as unknown as Record<string, unknown>),
    parsers: { ...sourceOptions.parsers },
    serializers: { ...sourceOptions.serializers },
  };
  const bound = new Proxy(reserved, {
    apply(target, _thisArg, argumentsList) {
      return Reflect.apply(target, target, argumentsList);
    },
    get(target, property) {
      if (property === "options") return driverOptions;
      if (property === "json") {
        return (value: postgres.JSONValue) => {
          // A ReservedSql keeps the codec snapshot of its physical connection,
          // while Drizzle can later mutate the pool codec maps. Binding a
          // postgres.js JSON Parameter would therefore let the pool and the
          // reserved backend disagree about whether its value must already be
          // serialized. Keep the OID explicit so prepared-statement reuse
          // cannot silently change the encoding path.
          const serialized = JSON.stringify(value);
          return target.typed(serialized, 3802);
        };
      }
      if (property === "unsafe") {
        return (
          query: string,
          parameters: unknown[] = [],
          options?: unknown,
        ) => {
          return options === undefined
            ? target.unsafe(query, parameters as never[])
            : target.unsafe(query, parameters as never[], options as never);
        };
      }
      // These pool-only capabilities must not be synthesized from `pool`.
      if (property === "begin" || property === "reserve" ||
          property === "end" || property === "close" ||
          property === "listen" || property === "subscribe" ||
          property === "notify") {
        return undefined;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return bound as unknown as postgres.Sql;
}

export type PostgresSessionTransactionIsolation =
  | "SERIALIZABLE"
  | "REPEATABLE READ";

export const POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS = 3;

type BeginCapableSql = Readonly<{ begin?: postgres.Sql["begin"] }>;
type ActiveTransaction = Readonly<{
  handles: ReadonlySet<postgres.Sql>;
  isolation: PostgresSessionTransactionIsolation;
}>;

const activeTransaction = new AsyncLocalStorage<ActiveTransaction>();

function isolationRank(isolation: PostgresSessionTransactionIsolation): number {
  return isolation === "SERIALIZABLE" ? 2 : 1;
}

function inTransaction<T>(
  handles: readonly postgres.Sql[],
  isolation: PostgresSessionTransactionIsolation,
  callback: () => Promise<T>,
): Promise<T> {
  const inherited = activeTransaction.getStore()?.handles ?? [];
  return activeTransaction.run({
    handles: new Set([...inherited, ...handles]),
    isolation,
  }, callback);
}

/**
 * Runs on either a postgres.js pool handle or a reserved connection. Reserved
 * handles deliberately use manual control so a caller's session advisory lock
 * and every statement remain on the same backend.
 */
export async function withPostgresSessionTransaction<T>(
  sql: postgres.Sql,
  isolation: PostgresSessionTransactionIsolation,
  callback: (transaction: postgres.Sql) => Promise<T>,
): Promise<T> {
  const active = activeTransaction.getStore();
  if (active?.handles.has(sql)) {
    if (isolationRank(isolation) > isolationRank(active.isolation)) {
      throw new Error("POSTGRES_SESSION_TRANSACTION_ISOLATION_ESCALATION_REFUSED");
    }
    return callback(sql);
  }
  if (active) {
    throw new Error("POSTGRES_SESSION_TRANSACTION_HANDLE_MISMATCH_REFUSED");
  }

  const begin = (sql as unknown as BeginCapableSql).begin;
  if (typeof begin === "function") {
    const option = isolation === "SERIALIZABLE"
      ? "isolation level serializable"
      : "isolation level repeatable read";
    return await sql.begin(option, (transaction) => {
      const tx = transaction as unknown as postgres.Sql;
      return inTransaction([tx], isolation, () => callback(tx));
    }) as T;
  }

  if (isolation === "SERIALIZABLE") {
    await sql`BEGIN ISOLATION LEVEL SERIALIZABLE`;
  } else {
    await sql`BEGIN ISOLATION LEVEL REPEATABLE READ`;
  }
  try {
    const result = await inTransaction([sql], isolation, () => callback(sql));
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

export async function withPostgresSerializableTransactionRetry<T>(
  sql: postgres.Sql,
  callback: (transaction: postgres.Sql) => Promise<T>,
): Promise<T> {
  // A nested operation does not own the active transaction. Retrying its
  // callback after SQLSTATE 40001 would reuse an already-aborted PostgreSQL
  // transaction and hide the original serialization failure from the outer
  // owner. Execute exactly once here; the owner will roll back and retry its
  // complete transaction on a fresh snapshot.
  if (activeTransaction.getStore()) {
    return withPostgresSessionTransaction(sql, "SERIALIZABLE", callback);
  }
  for (let attempt = 1;
    attempt <= POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS;
    attempt += 1) {
    try {
      return await withPostgresSessionTransaction(sql, "SERIALIZABLE", callback);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      if (code !== "40001" ||
          attempt === POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw new Error("POSTGRES_SERIALIZABLE_TRANSACTION_RETRY_EXHAUSTED");
}
