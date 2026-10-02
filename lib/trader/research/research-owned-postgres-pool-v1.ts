import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import net from "node:net";
import postgres from "postgres";

/** Internal transport only. The caller must own its source/transaction authority.
 * Postgres.js retains PostgreSQL authentication and TLS negotiation. */
export async function withResearchOwnedPostgresPoolV1<T>(url: string, signal: AbortSignal,
  statementTimeoutMs: number, work: (pool: postgres.Sql) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const endpoint = new URL(url);
  if (!["postgres:", "postgresql:"].includes(endpoint.protocol) || !endpoint.hostname ||
      endpoint.hostname.includes(",") || ["host", "port", "path", "socket", "target_session_attrs"]
        .some(key => endpoint.searchParams.has(key))) {
    throw new Error("RESEARCH_POOL_SINGLE_TCP_ENDPOINT_REQUIRED");
  }
  const host = endpoint.hostname.replace(/^\[|\]$/g, "");
  const port = Number(endpoint.port || 5432);
  if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs < 1 ||
      statementTimeoutMs > 180_000) throw new Error("RESEARCH_POOL_TIMEOUT_INVALID");
  let closed = false, attempts = 0;
  const sockets = new Set<net.Socket>();
  const socketFactory = () => new Promise<net.Socket>((resolve, reject) => {
    if (closed || signal.aborted) { reject(new Error("RESEARCH_POOL_CLOSED")); return; }
    if (++attempts > 3) { reject(new Error("RESEARCH_POOL_CONNECTION_ATTEMPTS_EXHAUSTED")); return; }
    const socket = new net.Socket();
    // Postgres.js's documented custom-socket path uses this host for TLS SNI.
    Object.assign(socket, { host, port });
    sockets.add(socket);
    let ready = false;
    const timer = setTimeout(() => socket.destroy(new Error("RESEARCH_POOL_CONNECT_TIMEOUT")), 10_000);
    socket.once("error", reject);
    socket.once("close", () => {
      clearTimeout(timer); sockets.delete(socket);
      if (!ready) reject(new Error("RESEARCH_POOL_CLOSED_BEFORE_CONNECT"));
    });
    socket.once("connect", () => {
      clearTimeout(timer);
      if (closed || signal.aborted) { socket.destroy(); reject(new Error("RESEARCH_POOL_CLOSED")); return; }
      ready = true; resolve(socket);
    });
    socket.connect({ host, port });
  });
  // Postgres.js 3.4.9 supports custom sockets and endpoint arrays at runtime;
  // its TS declarations omit both. Arrays preserve IPv6 without colon splitting.
  const options = { host: [host], port: [port], max: 1, prepare: false, connect_timeout: 10,
    socket: socketFactory, connection: { statement_timeout: statementTimeoutMs,
      lock_timeout: 30_000, idle_in_transaction_session_timeout: statementTimeoutMs, timezone: "UTC" } };
  const pool = postgres(url, options as unknown as postgres.Options<Record<string, never>>);
  let running: Promise<T> | undefined, forcedEnd: Promise<void> | undefined;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    closed = true;
    for (const socket of sockets) socket.destroy();
    forcedEnd ??= pool.end({ timeout: 0 });
    rejectAbort(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    running = work(pool);
    const result = await Promise.race([running, aborted]);
    signal.throwIfAborted();
    return result;
  } finally {
    closed = true;
    signal.removeEventListener("abort", onAbort);
    try { await (forcedEnd ?? pool.end({ timeout: 1 })); }
    finally { for (const socket of sockets) socket.destroy(); }
    if (signal.aborted && running) await running.catch(() => undefined);
  }
}
