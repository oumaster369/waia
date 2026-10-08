import "server-only";
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import type { Server } from "node:http";
import postgres from "postgres";
import { createAccountObservationDatabaseTlsOptions } from "./database-node-tls";
import { probeObservationPool } from "./host-role-probe";
import { createPostgresObservationReader } from "./postgres-reader";
import { createProjectionDispatcher } from "./projection-dispatcher";
import { createProjectionHttpServer } from "./projection-http";
import { assertProjectionLifetimeLock, parseProjectionDatabaseCredentials,
  PROJECTION_DATABASE_POOL, PROJECTION_READER_LOGIN, PROJECTION_RUNTIME_DIRECTORY,
  type ProjectionServiceConfig } from "./projection-service-config";

export type ProjectionServiceEvent = "STARTING" | "QUARANTINE" | "READY" | "UNREADY" | "DRAINING" | "DRAIN_BLOCKED" | "STOPPED";
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const refused = () => new Error("PROJECTION_SERVICE_REFUSED");

/** Actual one-pool resource owner. No database operation is raced against an early
 * slot release. Unsettled driver cleanup keeps the process and lifetime lock alive;
 * an operator may investigate it, but this owner never kills/replaces the pool. */
export async function runProjectionService(input: {
  config: ProjectionServiceConfig;
  databaseUrl: string;
  hmacKey: Uint8Array;
  certificateAuthority?: string;
  signal: AbortSignal;
  report(event: ProjectionServiceEvent): void;
}): Promise<void> {
  assertProjectionLifetimeLock();
  if (input.signal.aborted || input.hmacKey.byteLength !== 32 ||
      (input.config.deployment === "production" && input.certificateAuthority !== undefined)) throw refused();
  const credentials = parseProjectionDatabaseCredentials(input.databaseUrl, input.config);
  const tls = createAccountObservationDatabaseTlsOptions(input.certificateAuthority);
  const report = (event: ProjectionServiceEvent) => { try { input.report(event); } catch { /* No diagnostic may tear down ownership. */ } };
  const socketPath = `${PROJECTION_RUNTIME_DIRECTORY}/http.sock`;
  let sql: ReturnType<typeof postgres> | undefined;
  let dispatcher: ReturnType<typeof createProjectionDispatcher> | undefined;
  let server: Server | undefined;
  let monitor: ReturnType<typeof setInterval> | undefined;
  let socketInode: number | undefined;
  let terminalFailure = false;
  let finish: (() => void) | undefined;
  const stopping = new Promise<void>(resolve => { finish = resolve; });
  const stop = () => { dispatcher?.stop(); finish?.(); };
  input.signal.addEventListener("abort", stop, { once: true });
  const assertStarting = () => { if (input.signal.aborted || terminalFailure) throw refused(); };
  report("STARTING");
  try {
    sql = postgres({ ...credentials, ...PROJECTION_DATABASE_POOL, ssl: tls,
      connection: { application_name: "waia-account-observation-projection" }, onnotice: () => {} });
    if (await probeObservationPool(sql, "reader") !== PROJECTION_READER_LOGIN) throw refused();
    assertStarting();
    const rows = await sql.begin(async tx => {
      await tx`SET TRANSACTION READ ONLY`;
      await tx`SET LOCAL statement_timeout = '3000ms'`;
      await tx`SET LOCAL transaction_timeout = '5000ms'`;
      return tx`SELECT (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS encrypted,
        EXISTS (SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolconnlimit=2) AS hard_limit`;
    });
    if (rows.length !== 1 || rows[0].encrypted !== true || rows[0].hard_limit !== true) throw refused();
    assertStarting();
    // The verified inherited lock precedes both this pool and any stale socket cleanup.
    try {
      const old = lstatSync(socketPath);
      if (!old.isSocket() || old.uid !== process.getuid?.()) throw refused();
      unlinkSync(socketPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    dispatcher = createProjectionDispatcher({ tuple: input.config.tuple,
      keyBytes: input.hmacKey, reader: createPostgresObservationReader(sql) });
    input.hmacKey.fill(0);
    server = createProjectionHttpServer({ dispatcher });
    server.on("error", () => { terminalFailure = true; stop(); });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(socketPath, () => { server!.removeListener("error", reject); resolve(); });
    });
    socketInode = lstatSync(socketPath).ino;
    chmodSync(socketPath, 0o660);
    assertStarting();
    report("QUARANTINE");
    let lastReady = false;
    monitor = setInterval(() => {
      const status = dispatcher!.status();
      if (status.ready !== lastReady) { lastReady = status.ready; report(status.ready ? "READY" : "UNREADY"); }
      // Poisoned owners remain alive holding the lock/pool until an explicit stop.
    }, 100);
    await stopping;
  } catch {
    terminalFailure = !input.signal.aborted;
  } finally {
    // A pending Promise alone does not keep Node alive. Retain the OS lock even
    // if a faulty driver's unresolved cleanup no longer owns a referenced socket.
    const drainLiveness = setInterval(() => {}, 1000);
    report("DRAINING");
    if (monitor) clearInterval(monitor);
    dispatcher?.stop();
    const closed = server?.listening
      ? new Promise<void>(resolve => server!.close(() => resolve())) : Promise.resolve();
    const drainStart = performance.now();
    let blocked = false;
    while (dispatcher && (dispatcher.status().activeReads > 0 || dispatcher.status().httpRequests > 0)) {
      if (!blocked && performance.now() - drainStart >= 8000) { blocked = true; report("DRAIN_BLOCKED"); }
      await delay(25);
    }
    await closed;
    // No timeout argument: postgres.js must actually drain before OS lock release.
    try { await sql?.end(); }
    catch {
      report("DRAIN_BLOCKED");
      await new Promise<never>(() => {});
    }
    if (socketInode !== undefined) {
      try {
        const current = lstatSync(socketPath);
        if (current.isSocket() && current.ino === socketInode && current.uid === process.getuid?.()) unlinkSync(socketPath);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") terminalFailure = true; }
    }
    input.hmacKey.fill(0);
    input.signal.removeEventListener("abort", stop);
    report("STOPPED");
    clearInterval(drainLiveness);
  }
  if (terminalFailure) throw refused();
}
