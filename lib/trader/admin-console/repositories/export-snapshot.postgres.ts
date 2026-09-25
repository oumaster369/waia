import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type postgres from "postgres";
import * as schema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { AdminReadTx } from "./snapshot.postgres";
import { readSnapshotXmin } from "./snapshot.postgres";
import { EXPORT_TIME_LIMIT_MS } from "@/lib/trader/admin-console/billing/export-csv";

/** A bounded export owns one RR read-only transaction. Driver cancellation also
 * works with the production one-connection pool: no second SQL connection waits
 * for that pool, and no backend PID is exposed to the caller. */
export async function withAdminExportSnapshot<T>(
  runtime: Extract<WaiaRuntimeDb, { kind: "postgres" }>,
  signal: AbortSignal,
  read: (tx: AdminReadTx, cursor: string) => Promise<T>,
  timeoutMs = EXPORT_TIME_LIMIT_MS,
): Promise<T> {
  if (signal.aborted) throw new Error("EXPORT_ABORTED");
  const client =
    runtime._sql ?? (runtime.db as typeof runtime.db & { $client?: postgres.Sql }).$client;
  if (!client) throw new Error("EXPORT_CANCEL_UNAVAILABLE");
  let timedOut = false;
  let active: { cancel: () => void } | null = null;
  const cancel = () => active?.cancel();
  const timer = setTimeout(() => {
    timedOut = true;
    cancel();
  }, timeoutMs);
  signal.addEventListener("abort", cancel, { once: true });
  const check = () => {
    if (signal.aborted) throw new Error("EXPORT_ABORTED");
    if (timedOut) throw new Error("EXPORT_LIMIT");
  };
  try {
    return (await client.begin("isolation level repeatable read read only", async (connection) => {
      const cancellable = new Proxy(connection, {
        get(target, property, receiver) {
          // Postgres.js transaction handles inherit the connection but omit the
          // parent parser configuration required by the Drizzle constructor.
          if (property === "options") return client.options;
          if (property !== "unsafe") return Reflect.get(target, property, receiver);
          return (...args: Parameters<typeof connection.unsafe>) => {
            check();
            const query = connection.unsafe(...args);
            active = query;
            return query;
          };
        },
      });
      const tx = drizzle(cancellable as unknown as postgres.Sql, {
        schema,
      }) as unknown as AdminReadTx;
      try {
        await tx.execute(sql`select set_config('statement_timeout', ${String(timeoutMs)}, true)`);
        const cursor = await readSnapshotXmin(tx);
        const value = await read(tx, cursor);
        check();
        return value;
      } finally {
        active = null;
      }
    })) as T;
  } catch (error) {
    check();
    // The server timeout can win the event-loop timer; it is still the export deadline.
    let cause: unknown = error;
    for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth += 1) {
      if ("code" in cause && cause.code === "57014") throw new Error("EXPORT_LIMIT");
      cause = "cause" in cause ? cause.cause : null;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
