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

/** Private composition helper; callback/transport cannot be injected at the public Worker entry. */
export async function withScheduledOwnedPostgresPoolV1<T>(
  url: string, signal: AbortSignal, work: (pool: postgres.Sql) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const endpoint = parseScheduledPostgresEndpointV1(url);
  const transport = await createScheduledPostgresTransportV1(endpoint, signal);
  const options = {
    host: [endpoint.host], port: [endpoint.port], max: 1, prepare: false,
    ssl: endpoint.tls ? "verify-full" : false, connect_timeout: 10,
    socket: transport.socket,
    connection: { statement_timeout: 30_000, lock_timeout: 5_000, timezone: "UTC" },
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
  try {
    signal.throwIfAborted();
    pool = postgres(url, options as unknown as postgres.Options<Record<string, never>>);
    // Await the actual work. An already fulfilled COMMIT is not relabelled by
    // an abort during cleanup; the callback returning alone is not fulfillment.
    return await work(pool);
  } finally {
    transport.seal();
    signal.removeEventListener("abort", onAbort);
    const ending = forcedEnd ?? pool?.end({ timeout: 0 });
    if (ending) void ending.catch(() => undefined);
    await transport.close();
    // Shutdown rejection is observational after work has already settled.
    // Every owned transport/task is still joined above.
    if (ending) await ending.catch(() => undefined);
  }
}
