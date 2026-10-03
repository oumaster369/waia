import "server-only";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { types } from "node:util";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import { createObservationCredentialStore } from "@/lib/trader/account-observation/credential-store";
import { createObservationCredentialReader } from "@/lib/trader/account-observation/credential-read-boundary";
import { createPostgresObservationAssignmentSource } from "@/lib/trader/account-observation/postgres-assignments";
import { createPostgresObservationReader } from "@/lib/trader/account-observation/postgres-reader";
import { parseAccountObservationAssignmentManifest } from "@/lib/trader/account-observation/assignment-manifest";
import { probeObservationCredentialPool, probeObservationPool, observationPoolLimits } from "@/lib/trader/account-observation/host-role-probe";
import { createHtxV5ReadTransport } from "@/lib/trader/account-observation/derivatives/htx-v5-read-transport";
import { AccountObservationReadFailure } from "@/lib/trader/account-observation/service";
import { parseHtxV5AssetMode } from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";
import { isProductionDeployment } from "@/lib/trader/security/deployment-tier";
import type { Sql } from "postgres";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";
import type { HtxObservationCredentialHandle } from "@/lib/trader/account-observation/htx-reader-opener";
import { sameObservationBinding } from "@/lib/trader/account-observation/validation";

const PROBE_DEADLINE_MS = 45_000;
const CLEANUP_DEADLINE_MS = 7_000;
const READ_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const ACCOUNT_OBSERVATION_PROBE_SERVICE = "ai-trader-account-observation-identity-probe";

type ProbeRefusal =
  | "CLI_ENVIRONMENT" | "RELEASE_SHA" | "MANIFEST_PATH" | "MANIFEST_DIGEST" | "READER_DATABASE_URL"
  | "CREDENTIAL_DATABASE_URL" | "DATABASE_LOGIN" | "DATABASE_RESOURCES_NOT_DISTINCT" | "MASTER_KEY"
  | "MANIFEST" | "ASSIGNMENT_COUNT" | "DATABASE_REFUSED" | "ASSIGNMENT_STALE" | "CREDENTIAL_REFUSED"
  | "VENUE_REFUSED" | "HTX_TIMEOUT" | "HTX_RATE_LIMITED" | "HTX_PERMISSION_DENIED"
  | "HTX_READ_FAILED" | "HTX_INVALID_RESPONSE" | "HTX_IDENTITY_MISMATCH"
  | "ASSET_MODE_INVALID_RESPONSE" | "TIMEOUT" | "CLEANUP_TIMEOUT" | "CLEANUP_FAILED" | "FAILED";

export class AccountObservationIdentityProbeFailure extends Error {
  readonly code: ProbeRefusal;
  constructor(code: ProbeRefusal) {
    super(`ACCOUNT_OBSERVATION_IDENTITY_PROBE_REFUSED:${code}`);
    this.name = "AccountObservationIdentityProbeFailure";
    this.code = code;
  }
}

type SafeRuntime = Readonly<{ releaseSha: string; manifestSha256: string }>;
type PrivateRuntime = Readonly<{
  safe: SafeRuntime;
  manifestPath: string;
  readerDatabaseUrl: string;
  credentialDatabaseUrl: string;
  masterKey: string;
}>;
type Env = Readonly<Record<string, string | undefined>>;
const refuse = (code: ProbeRefusal): never => { throw new AccountObservationIdentityProbeFailure(code); };

function ensureLive(signal: AbortSignal): void { if (signal.aborted) refuse("TIMEOUT"); }

export function readManifestBounded(path: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536) refuse("MANIFEST");
    const bytes = Buffer.alloc(65537);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(fd, bytes, offset, bytes.byteLength - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset > 65536) refuse("MANIFEST");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset));
  } catch { return refuse("MANIFEST"); }
  finally { if (fd !== undefined) closeSync(fd); }
}

function databaseUrl(env: Env, key: string, login: string): string {
  const value = env[key]?.trim();
  if (!value) return refuse(key === "WAIA_OBSERVATION_READER_DATABASE_URL" ? "READER_DATABASE_URL" : "CREDENTIAL_DATABASE_URL");
  let parsed: URL;
  try { parsed = new URL(value); } catch {
    return refuse(key === "WAIA_OBSERVATION_READER_DATABASE_URL" ? "READER_DATABASE_URL" : "CREDENTIAL_DATABASE_URL");
  }
  let username: string;
  try { username = decodeURIComponent(parsed.username); } catch { return refuse("DATABASE_LOGIN"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol.toLowerCase()) || !parsed.hostname || username !== login)
    refuse("DATABASE_LOGIN");
  return value;
}

/** Complete non-I/O validation. Secret and connection strings stay outside safe runtime identity. */
export function parseAccountObservationIdentityProbeEnv(env: Env): PrivateRuntime {
  if (env.WAIA_TRADER_CLI !== "1") refuse("CLI_ENVIRONMENT");
  const releaseSha = env.WAIA_RELEASE_SHA?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) refuse("RELEASE_SHA");
  const manifestPath = env.WAIA_OBSERVATION_ASSIGNMENT_MANIFEST?.trim() ?? "";
  if (!isAbsolute(manifestPath) || manifestPath.includes("\0") || resolve(manifestPath) !== manifestPath || manifestPath === "/")
    refuse("MANIFEST_PATH");
  const manifestSha256 = env.WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(manifestSha256)) refuse("MANIFEST_DIGEST");
  const readerDatabaseUrl = databaseUrl(env, "WAIA_OBSERVATION_READER_DATABASE_URL", "waia_account_observation_reader_login");
  const credentialDatabaseUrl = databaseUrl(env, "WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL", "waia_account_observation_credential_login");
  if (readerDatabaseUrl === credentialDatabaseUrl) refuse("DATABASE_RESOURCES_NOT_DISTINCT");
  const masterKey = env.WAIA_OBSERVATION_MASTER_KEY?.trim() ?? "";
  let decoded: Buffer;
  try { decoded = Buffer.from(masterKey, "base64"); } catch { return refuse("MASTER_KEY"); }
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== masterKey) refuse("MASTER_KEY");
  const runtime = { safe: Object.freeze({ releaseSha, manifestSha256 }) } as {
    safe: SafeRuntime; manifestPath: string; readerDatabaseUrl: string; credentialDatabaseUrl: string; masterKey: string;
  };
  Object.defineProperties(runtime, {
    manifestPath: { value: manifestPath }, readerDatabaseUrl: { value: readerDatabaseUrl },
    credentialDatabaseUrl: { value: credentialDatabaseUrl }, masterKey: { value: masterKey },
  });
  return Object.freeze(runtime);
}

type SqlResource = Readonly<{ sql: Sql; close(): Promise<void> }>;
type ProbeResult = Readonly<{
  schemaVersion: "waia.account_observation_identity_probe.v1";
  releaseSha: string;
  manifestSha256: string;
  binding: ObservationBinding;
  htxUid: string;
  permission: "readOnly";
  assetMode: "0" | "1" | "2";
  checkedAt: number;
  responseGeneratedAtMs: number | null;
  receivedAt: number;
}>;

export type ProbeDependencies = Readonly<{
  readManifest(path: string): string;
  openReader(url: string): Promise<SqlResource>;
  openCredential(url: string): Promise<SqlResource>;
  probeReader(sql: Sql): Promise<unknown>;
  probeCredential(sql: Sql): Promise<unknown>;
  createProvider(masterKey: string): Promise<MasterKeyProvider>;
  createCredentialService(input: { sql: Sql; provider: MasterKeyProvider;
    assignments: readonly { organizationId: string; credentialId: string; exchangeAccountId: string }[] }):
    Pick<import("@/lib/trader/credentials/types").CredentialService, "getDecryptedCredentials">;
  createAssignmentSource(sql: Sql, configured: readonly import("@/lib/trader/account-observation/runtime").ObservationAssignment[]):
    ReturnType<typeof createPostgresObservationAssignmentSource>;
  createReader(sql: Sql): ReturnType<typeof createPostgresObservationReader>;
  createStore(input: Parameters<typeof createObservationCredentialStore>[0]): ReturnType<typeof createObservationCredentialStore>;
  createTransport(input: Parameters<typeof createHtxV5ReadTransport>[0]): ReturnType<typeof createHtxV5ReadTransport>;
  parseMode(payload: string): ReturnType<typeof parseHtxV5AssetMode>;
  fetchImpl: typeof fetch;
  now(): number;
}>;

const productionDependencies: ProbeDependencies = {
  readManifest: readManifestBounded,
  async openReader(url) {
    const sql = postgres(url, { ...observationPoolLimits, connection: { application_name: ACCOUNT_OBSERVATION_PROBE_SERVICE }, onnotice: () => {} });
    return Object.freeze({ sql, async close() { await sql.end({ timeout: 5 }); } });
  },
  async openCredential(url) {
    const sql = postgres(url, { ...observationPoolLimits, connection: { application_name: `${ACCOUNT_OBSERVATION_PROBE_SERVICE}-credential` }, onnotice: () => {} });
    return Object.freeze({ sql, async close() { await sql.end({ timeout: 5 }); } });
  },
  probeReader: sql => probeObservationPool(sql, "reader"),
  probeCredential: sql => probeObservationCredentialPool(sql),
  async createProvider(masterKey) {
    return SecretsStoreMasterKeyProvider.create({ secretGetter: async () => masterKey, productionReady: isProductionDeployment() });
  },
  createCredentialService: input => createObservationCredentialReader(input),
  createAssignmentSource: (sql, configured) => createPostgresObservationAssignmentSource(sql, configured),
  createReader: sql => createPostgresObservationReader(sql),
  createStore: input => createObservationCredentialStore(input),
  createTransport: input => createHtxV5ReadTransport(input),
  parseMode: parseHtxV5AssetMode,
  fetchImpl: fetch,
  now: () => accountObservationClock.now(),
};

const probeRefusalCodes: readonly ProbeRefusal[] = [
  "CLI_ENVIRONMENT", "RELEASE_SHA", "MANIFEST_PATH", "MANIFEST_DIGEST", "READER_DATABASE_URL",
  "CREDENTIAL_DATABASE_URL", "DATABASE_LOGIN", "DATABASE_RESOURCES_NOT_DISTINCT", "MASTER_KEY",
  "MANIFEST", "ASSIGNMENT_COUNT", "DATABASE_REFUSED", "ASSIGNMENT_STALE", "CREDENTIAL_REFUSED",
  "VENUE_REFUSED", "HTX_TIMEOUT", "HTX_RATE_LIMITED", "HTX_PERMISSION_DENIED", "HTX_READ_FAILED",
  "HTX_INVALID_RESPONSE", "HTX_IDENTITY_MISMATCH", "ASSET_MODE_INVALID_RESPONSE", "TIMEOUT",
  "CLEANUP_TIMEOUT", "CLEANUP_FAILED", "FAILED",
];

function safeCode(error: unknown): ProbeRefusal {
  try {
    if (types.isProxy(error)) return "FAILED";
    if (!(error instanceof AccountObservationIdentityProbeFailure)) return "FAILED";
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const code: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (typeof code === "string" && probeRefusalCodes.includes(code as ProbeRefusal)) return code as ProbeRefusal;
  } catch { /* Error objects from dependencies are untrusted. */ }
  return "FAILED";
}

function safeTransportCode(error: unknown): ProbeRefusal {
  try {
    if (types.isProxy(error)) return "VENUE_REFUSED";
    if (!(error instanceof AccountObservationReadFailure)) return "VENUE_REFUSED";
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const code: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
    switch (code) {
      case "TIMEOUT": return "HTX_TIMEOUT";
      case "RATE_LIMITED": return "HTX_RATE_LIMITED";
      case "PERMISSION_DENIED": return "HTX_PERMISSION_DENIED";
      case "READ_FAILED": return "HTX_READ_FAILED";
      case "INVALID_RESPONSE": return "HTX_INVALID_RESPONSE";
      case "IDENTITY_MISMATCH": return "HTX_IDENTITY_MISMATCH";
      default: return "VENUE_REFUSED";
    }
  } catch { return "VENUE_REFUSED"; }
}

async function bounded<T>(promise: Promise<T>, ms: number, code: ProbeRefusal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AccountObservationIdentityProbeFailure(code)), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** One existing manifest assignment, one strict-read-only metadata admission and one V5 mode GET. */
export async function runAccountObservationIdentityProbe(
  env: Env,
  dependencies: ProbeDependencies = productionDependencies,
): Promise<ProbeResult> {
  const runtime = parseAccountObservationIdentityProbeEnv(env);
  if (typeof dependencies.fetchImpl !== "function") refuse("FAILED");
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), PROBE_DEADLINE_MS);
  const signal = controller.signal;
  const opened: SqlResource[] = [];
  let closing = false;
  let readerResource: SqlResource | undefined;
  let credentialResource: SqlResource | undefined;
  let store: ReturnType<typeof createObservationCredentialStore> | undefined;
  let handle: HtxObservationCredentialHandle | undefined;
  let transport: ReturnType<typeof createHtxV5ReadTransport> | undefined;
  let result: ProbeResult | undefined;
  let failure: ProbeRefusal | undefined;
  const openResource = async (open: (url: string) => Promise<SqlResource>, url: string) => {
    const opening = open(url);
    try {
      const resource = await opening;
      if (closing) {
        try { await resource.close(); } catch { failure = "CLEANUP_FAILED"; }
        refuse("TIMEOUT");
      }
      opened.push(resource);
      return resource;
    } catch (error) {
      // A late-opened resource is still owned and closed before returning.
      throw error;
    }
  };
  const work = async () => {
    let manifest: string;
    try { manifest = dependencies.readManifest(runtime.manifestPath); } catch { return refuse("MANIFEST"); }
    let trusted: ReturnType<typeof parseAccountObservationAssignmentManifest>;
    try {
      trusted = parseAccountObservationAssignmentManifest(manifest!, {
        expectedDigest: runtime.safe.manifestSha256, expectedReleaseSha: runtime.safe.releaseSha,
      });
    } catch { return refuse("MANIFEST"); }
    ensureLive(signal);
    if (!trusted || trusted.configured.length !== 1) refuse("ASSIGNMENT_COUNT");
    const assignment = trusted.configured[0]!;

    readerResource = await openResource(dependencies.openReader, runtime.readerDatabaseUrl);
    ensureLive(signal);
    credentialResource = await openResource(dependencies.openCredential, runtime.credentialDatabaseUrl);
    ensureLive(signal);
    if (readerResource.sql === credentialResource.sql) refuse("DATABASE_RESOURCES_NOT_DISTINCT");
    try {
      await dependencies.probeReader(readerResource.sql);
      ensureLive(signal);
      await dependencies.probeCredential(credentialResource.sql);
      ensureLive(signal);
    } catch { refuse("DATABASE_REFUSED"); }

    const source = dependencies.createAssignmentSource(readerResource.sql, [assignment]);
    const reader = dependencies.createReader(readerResource.sql);
    const currentBefore = await source.loadAssignments(signal);
    ensureLive(signal);
    if (currentBefore.length !== 1 || !currentBefore[0] || !sameObservationBinding(currentBefore[0].binding, assignment.binding))
      refuse("ASSIGNMENT_STALE");
    const authorizedBefore = await source.authorizeOpen(assignment.binding, signal);
    ensureLive(signal);
    if (!authorizedBefore) refuse("ASSIGNMENT_STALE");
    const activeBefore = await reader.resolveActiveBinding(assignment.binding);
    ensureLive(signal);
    if (!activeBefore || !sameObservationBinding(activeBefore, assignment.binding)) refuse("ASSIGNMENT_STALE");

    let provider: Awaited<ReturnType<typeof dependencies.createProvider>>;
    try { provider = await dependencies.createProvider(runtime.masterKey); } catch { refuse("CREDENTIAL_REFUSED"); }
    ensureLive(signal);
    if (!provider!.isProductionReady()) refuse("CREDENTIAL_REFUSED");
    const credentialService = dependencies.createCredentialService({
      sql: credentialResource.sql, provider: provider!, assignments: [{
        organizationId: assignment.binding.organizationId,
        credentialId: assignment.binding.credentialId,
        exchangeAccountId: assignment.binding.exchangeAccountId,
      }],
    });
    store = dependencies.createStore({ credentialService, bindingReader: reader,
      authorizeOpen: source.authorizeOpen, clock: accountObservationClock, timeoutMs: READ_TIMEOUT_MS });
    handle = await store.openCredential(assignment.binding, signal);
    ensureLive(signal);
    transport = dependencies.createTransport({ credential: handle, clock: accountObservationClock,
      fetchImpl: dependencies.fetchImpl, timeoutMs: READ_TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES,
      authorizeCurrent: source.authorizeOpen,
      ...(assignment.config.htxV5?.expectedHtxUid ? { expectedHtxUid: assignment.config.htxV5.expectedHtxUid } : {}),
    });
    let response;
    try { response = await transport.readAssetMode(signal); }
    catch (error) { refuse(signal.aborted ? "TIMEOUT" : safeTransportCode(error)); }
    ensureLive(signal);
    const currentAfter = await source.authorizeOpen(assignment.binding, signal);
    ensureLive(signal);
    const activeAfter = await reader.resolveActiveBinding(assignment.binding);
    ensureLive(signal);
    if (!currentAfter || !activeAfter || !sameObservationBinding(activeAfter, assignment.binding))
      refuse("ASSIGNMENT_STALE");
    let mode;
    try { mode = dependencies.parseMode(response!.body); } catch { refuse("ASSET_MODE_INVALID_RESPONSE"); }
    if (!sameObservationBinding(response!.identity.binding, assignment.binding) ||
        response!.identity.permission !== "readOnly" || !/^[1-9]\d{0,38}$/.test(response!.identity.htxUid))
      refuse("VENUE_REFUSED");
    result = Object.freeze({ schemaVersion: "waia.account_observation_identity_probe.v1",
      releaseSha: runtime.safe.releaseSha, manifestSha256: trusted.digest,
      binding: Object.freeze({ ...assignment.binding }), htxUid: response!.identity.htxUid,
      permission: "readOnly", assetMode: mode!.assetMode, checkedAt: response!.identity.checkedAt,
      responseGeneratedAtMs: mode!.responseGeneratedAtMs, receivedAt: response!.receivedAt });
  };

  const run = work();
  try { await bounded(run, PROBE_DEADLINE_MS, "TIMEOUT"); }
  catch (error) { failure = signal.aborted ? "TIMEOUT" : safeCode(error); controller.abort(); }
  finally {
    clearTimeout(deadlineTimer);
    closing = true;
    try { handle?.dispose(); } catch { failure = "CLEANUP_FAILED"; }
    try { transport?.dispose(); } catch { failure = "CLEANUP_FAILED"; }
    try { store?.dispose(); } catch { failure = "CLEANUP_FAILED"; }
  }

  // Let the in-flight operation publish late-created owners, then drain every actual owner.
  const cleanupDeadline = Date.now() + CLEANUP_DEADLINE_MS;
  const duringCleanup = <T>(promise: Promise<T>) =>
    bounded(promise, Math.max(1, cleanupDeadline - Date.now()), "CLEANUP_TIMEOUT");
  try {
    await duringCleanup(Promise.allSettled([run]));
    await duringCleanup(Promise.all([
      store?.settled() ?? Promise.resolve(),
      transport?.settled() ?? Promise.resolve(),
    ]));
  } catch (error) { failure = safeCode(error) === "CLEANUP_TIMEOUT" ? "CLEANUP_TIMEOUT" : "CLEANUP_FAILED"; }
  try { await duringCleanup(Promise.all([...opened].reverse().map(resource => resource.close()))); }
  catch { failure = failure === "CLEANUP_TIMEOUT" ? failure : "CLEANUP_FAILED"; }
  if (failure || signal.aborted || !result) refuse(failure ?? "TIMEOUT");
  return result!;
}

export function renderIdentityProbeOutput(result: ProbeResult): string {
  return JSON.stringify(result);
}

export function renderIdentityProbeRefusal(error: unknown): string {
  return JSON.stringify({ schemaVersion: "waia.account_observation_identity_probe.v1", refusal: safeCode(error) });
}

/** Force process exit only when a bounded cleanup failure could leave a handle alive. */
export function writeIdentityProbeRefusal(
  error: unknown,
  output: Pick<NodeJS.WriteStream, "write"> = process.stdout,
  exit: (code: number) => void = code => { process.exit(code); },
): void {
  const code = safeCode(error);
  process.exitCode = 1;
  const mustForceExit = code === "CLEANUP_TIMEOUT" || code === "CLEANUP_FAILED";
  let completed = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (completed) return;
    completed = true;
    if (fallback) clearTimeout(fallback);
    if (mustForceExit) exit(1);
  };
  try {
    output.write(`${renderIdentityProbeRefusal(new AccountObservationIdentityProbeFailure(code))}\n`, finish);
  } catch {
    if (mustForceExit) exit(1);
    return;
  }
  if (mustForceExit && !completed) fallback = setTimeout(finish, 250);
}

function isMainModule(): boolean {
  const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
  return invoked === resolve(fileURLToPath(import.meta.url));
}

async function main(): Promise<void> {
  try {
    const result = await runAccountObservationIdentityProbe(process.env);
    process.stdout.write(`${renderIdentityProbeOutput(result)}\n`);
  } catch (error) {
    writeIdentityProbeRefusal(error);
  }
}

if (isMainModule()) void main();
