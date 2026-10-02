import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import postgres from "postgres";
import { createScheduledPostgresTransportV1, type ScheduledPostgresEndpointV1 } from "./scheduled-owned-postgres-transport-v1";

/** postgres.begin can reject on close before its transaction callback finishes. */
export async function withJoinedScheduledTransactionV1<Tx, T>(
  transaction: (callback: (tx: Tx) => Promise<T>) => Promise<T>,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  let callbackTask: Promise<T> | undefined;
  try {
    return await transaction((tx) => {
      callbackTask = Promise.resolve().then(() => work(tx));
      return callbackTask;
    });
  } finally {
    // This joins application work only. It does not attest server rollback or
    // turn a callback return into COMMIT acknowledgment.
    if (callbackTask) await callbackTask.catch(() => undefined);
  }
}

/** Validate before either postgres or its environment fallback can choose an endpoint. */
export function parseScheduledPostgresEndpointV1(raw: string): ScheduledPostgresEndpointV1 {
  const refuse = (): never => { throw new Error("SCHEDULED_POSTGRES_DSN_PROFILE_REFUSED"); };
  let url: URL;
  try { url = new URL(raw); } catch { return refuse(); }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port || 5432);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !host || host.includes(",") ||
      url.hash || !url.pathname || url.pathname === "/" ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      url.searchParams.getAll("sslmode").length > 1) return refuse();
  const mode = url.searchParams.get("sslmode");
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (mode !== "verify-full" && !(loopback && (mode === null || mode === "disable"))) return refuse();
  return Object.freeze({ host, port, tls: mode === "verify-full" });
}

const CLEANUP_MS = 40_000;
type BackendIdentity = Readonly<{ pid: number; started: string }>;

export class ScheduledPostgresCleanupUnconfirmedError extends Error {
  constructor(cause: unknown) {
    super("SCHEDULED_POSTGRES_CLEANUP_UNCONFIRMED", { cause });
    this.name = "ScheduledPostgresCleanupUnconfirmedError";
  }
}

/** A lease owns its driver and transport; close never abandons either task. */
async function openOwnedPool(url: string, signal: AbortSignal, readOnly = false) {
  signal.throwIfAborted();
  const endpoint = parseScheduledPostgresEndpointV1(url);
  const transport = await createScheduledPostgresTransportV1(endpoint, signal);
  const options = {
    host: [endpoint.host], port: [endpoint.port], max: 1, prepare: false,
    ssl: endpoint.tls ? "verify-full" : false, connect_timeout: 10,
    socket: transport.socket,
    connection: { statement_timeout: 30_000, lock_timeout: 5_000, timezone: "UTC",
      ...(readOnly ? { default_transaction_read_only: "on" } : {}) },
  };
  let pool: postgres.Sql | undefined, forcedEnd: Promise<void> | undefined;
  const onAbort = () => {
    transport.seal();
    if (pool) {
      forcedEnd ??= pool.end({ timeout: 0 });
      void forcedEnd.catch(() => undefined);
    }
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const close = async () => {
    transport.seal();
    signal.removeEventListener("abort", onAbort);
    const ending = forcedEnd ?? pool?.end({ timeout: 0 });
    if (ending) void ending.catch(() => undefined);
    await transport.close();
    if (ending) await ending.catch(() => undefined);
  };
  try {
    signal.throwIfAborted();
    pool = postgres(url, options as unknown as postgres.Options<Record<string, never>>);
    return { pool, close, markProtocolActive: transport.markProtocolActive };
  } catch (error) {
    await close();
    throw error;
  }
}

type OwnedPool = Awaited<ReturnType<typeof openOwnedPool>>;
type ScheduledPostgresOperation = Readonly<{
  primary<T>(work: (pool: postgres.Sql) => Promise<T>): Promise<T>;
  verify<T>(work: (pool: postgres.Sql) => Promise<T>): Promise<T>;
}>;

/** Private two-pool composition; the Worker entry remains env-only. */
export async function withScheduledOwnedPostgresOperationV1<T>(
  url: string, signal: AbortSignal, work: (operation: ScheduledPostgresOperation) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  let primaryUsed = false, primaryFinished = false, verifierUsed = false, closed = false;
  let verifierTask: Promise<OwnedPool> | undefined, verifierFailed = false;
  const cleanup = new AbortController();
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const startCleanup = () => {
    cleanupTimer ??= setTimeout(() => cleanup.abort(new ScheduledPostgresCleanupUnconfirmedError(undefined)), CLEANUP_MS);
  };
  const verifier = () => {
    if (closed) throw new Error("SCHEDULED_POSTGRES_SCOPE_CLOSED");
    if (verifierFailed) throw new ScheduledPostgresCleanupUnconfirmedError(undefined);
    cleanup.signal.throwIfAborted();
    return verifierTask ??= openOwnedPool(url, cleanup.signal, true);
  };
  const observeCleanupFailure = () => {
    try { console.error(JSON.stringify({ event: "waia_paper_loop_owner", phase: "database_cleanup_unconfirmed" })); }
    catch { /* A diagnostic cannot relabel an acknowledged transaction. */ }
  };
  const witnessExit = async (identity: BackendIdentity) => {
    const lease = await verifier();
    const { pool } = lease;
    for (;;) {
      cleanup.signal.throwIfAborted();
      const rows = await pool<{ present: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
          WHERE pid=${identity.pid} AND backend_start=${identity.started}::text::timestamptz) AS present
      `;
      lease.markProtocolActive();
      cleanup.signal.throwIfAborted();
      if (rows.length !== 1 || typeof rows[0]!.present !== "boolean")
        throw new ScheduledPostgresCleanupUnconfirmedError(undefined);
      if (!rows[0]!.present) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    return await work({
      primary: async <R>(run: (pool: postgres.Sql) => Promise<R>): Promise<R> => {
        if (closed) throw new Error("SCHEDULED_POSTGRES_SCOPE_CLOSED");
        if (primaryUsed) throw new Error("SCHEDULED_POSTGRES_PRIMARY_ALREADY_USED");
        primaryUsed = true;
        const lease = await openOwnedPool(url, signal);
        let identity: BackendIdentity | undefined, transactionStarted = false;
        const begin = lease.pool.begin.bind(lease.pool);
        // Capture on the held transaction, never on a pool connection that may
        // be replaced before effects. Use only the driver's public begin API.
        lease.pool.begin = ((options: string | ((tx: postgres.TransactionSql) => Promise<unknown>),
          callback?: (tx: postgres.TransactionSql) => Promise<unknown>) => {
          if (transactionStarted) return Promise.reject(new Error("SCHEDULED_POSTGRES_TRANSACTION_ALREADY_USED"));
          transactionStarted = true;
          const runTransaction = typeof options === "function" ? options : callback!;
          return withJoinedScheduledTransactionV1<postgres.TransactionSql, unknown>(
            (joined) => typeof options === "string" ? begin(options, joined) : begin(joined),
            async (tx) => {
              const rows = await tx<{ pid: number; started: string }[]>`
                SELECT pid, backend_start::text AS started FROM pg_catalog.pg_stat_activity
                WHERE pid=pg_backend_pid()
              `;
              const row = rows[0];
              if (rows.length !== 1 || !row || !Number.isInteger(row.pid) || row.pid < 1 ||
                  typeof row.started !== "string" || !Number.isFinite(Date.parse(row.started)))
                throw new Error("SCHEDULED_POSTGRES_BACKEND_IDENTITY_INVALID");
              identity = Object.freeze({ pid: row.pid, started: row.started });
              lease.markProtocolActive();
              return runTransaction(tx);
            },
          );
        }) as postgres.Sql["begin"];
        let value!: R, failure: unknown, fulfilled = false;
        try { value = await run(lease.pool); fulfilled = true; }
        catch (error) { failure = error; }
        startCleanup();
        try {
          await lease.close();
          if (identity) await witnessExit(identity);
          else if (transactionStarted) throw new ScheduledPostgresCleanupUnconfirmedError(failure);
        } catch (error) {
          // A failed startup exhausted or invalidated this verifier. Do not
          // enqueue a receipt read on that failed driver or allocate a third pool.
          verifierFailed = true;
          observeCleanupFailure();
          if (!fulfilled) failure = new ScheduledPostgresCleanupUnconfirmedError(failure ?? error);
        } finally { primaryFinished = true; }
        // Driver acknowledgment was latched before cleanup. Witnessing exit
        // alone never changes an unknown commit into a successful commit.
        if (!fulfilled) throw failure;
        return value;
      },
      verify: async <R>(run: (pool: postgres.Sql) => Promise<R>): Promise<R> => {
        if (closed) throw new Error("SCHEDULED_POSTGRES_SCOPE_CLOSED");
        if (!primaryFinished || verifierUsed) throw new Error("SCHEDULED_POSTGRES_VERIFIER_SCOPE_REFUSED");
        verifierUsed = true;
        signal.throwIfAborted();
        const abort = () => cleanup.abort(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        try {
          const lease = await verifier();
          signal.throwIfAborted();
          const value = await run(lease.pool);
          signal.throwIfAborted();
          return value;
        } finally { signal.removeEventListener("abort", abort); }
      },
    });
  } finally {
    closed = true;
    cleanup.abort(new Error("SCHEDULED_POSTGRES_SCOPE_CLOSED"));
    try {
      if (verifierTask) {
        const lease = await verifierTask.catch(() => undefined);
        if (lease) await lease.close();
      }
    } catch { observeCleanupFailure(); }
    finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
  }
}

/** Same lifetime path for direct native proof and the closed owner. */
export async function withScheduledOwnedPostgresPoolV1<T>(
  url: string, signal: AbortSignal, work: (pool: postgres.Sql) => Promise<T>,
): Promise<T> {
  return withScheduledOwnedPostgresOperationV1(url, signal, (operation) => operation.primary(work));
}
