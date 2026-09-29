import { enforceServerOnly } from "@/lib/enforce-server-only";
import postgres, { type Sql } from "postgres";
import { isAbsolute } from "node:path";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import { assertCredentialDecryptionAllowed, assertCredentialStorageAllowed } from "@/lib/trader/security/credential-storage-gate";
import { createObservationConfiguration, type ObservationAssignment } from "@/lib/trader/account-observation/runtime";
import { observationBindingSchema, sameObservationBinding } from "@/lib/trader/account-observation/validation";
import { createPostgresObservationAssignmentSource } from "@/lib/trader/account-observation/postgres-assignments";
import { createPostgresObservationReader } from "@/lib/trader/account-observation/postgres-reader";
import { createObservationCredentialReader } from "@/lib/trader/account-observation/credential-read-boundary";
import { createObservationCredentialStore } from "@/lib/trader/account-observation/credential-store";
import { openHtxAccountAcquisitionTransport, type HtxObservationCredentialHandle } from "@/lib/trader/account-observation/htx-reader-opener";
import { createHtxReadAdmission } from "@/lib/trader/account-observation/htx-read-admission";
import { observationPoolLimits, probeObservationPool, probeObservationCredentialPool } from "@/lib/trader/account-observation/host-role-probe";
import type { ObservationClock } from "@/lib/trader/account-observation/types";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import { createEncryptedReferenceRawStoreV1 } from "@/lib/trader/mi/htx-reference-quote-collector-v1";
import { parseHtxAccountAcquisitionSpecV1, type HtxAccountAcquisitionSpecV1, HtxAccountAcquisitionRefusedV1 } from "@/lib/trader/reality/v2/htx-account-acquisition-v1";
import { acquireHtxAccountV1Postgres, readHtxAccountAcquisitionV1Postgres } from "@/lib/trader/reality/v2/htx-account-acquisition-postgres";

enforceServerOnly();
type Host = "api.huobi.pro" | "api-aws.huobi.pro";
function refuse(reason: string): never { throw new HtxAccountAcquisitionRefusedV1(reason); }

/** Configuration binding only; neither a record seal nor an assignment grants capital authority. */
export function bindHtxAccountAcquisitionAssignmentV1(input: {
  assignment: ObservationAssignment; spec: HtxAccountAcquisitionSpecV1; host: Host;
}) {
  const spec = parseHtxAccountAcquisitionSpecV1(input.spec);
  const binding = Object.freeze(observationBindingSchema.parse(input.assignment.binding));
  const { revision, ...parameters } = input.assignment.config;
  const config = createObservationConfiguration(parameters);
  const symbols = Object.freeze(spec.symbols.map(symbol => symbol.replace("/", "")));
  if (!sameObservationBinding(binding, spec.binding) || revision !== config.revision ||
      binding.configurationRevision !== config.revision || !config.htxCoverage ||
      config.htxCoverage.host !== input.host || spec.requestTimeoutMs !== config.readTimeoutMs ||
      spec.maxRawBytes > config.htxCoverage.maxResponseBytes ||
      JSON.stringify(symbols) !== JSON.stringify(config.symbols) || new Set(symbols).size !== symbols.length)
    refuse("ASSIGNMENT_SPEC_MISMATCH");
  const knownOrderIds = Object.freeze(spec.knownOrders.map(order => order.orderId));
  // Complete authenticated own-ledger derivation is the future job issuer's obligation.
  // This binds the exact persisted roster and cannot attest that the roster is complete.
  return Object.freeze({ spec, assignment: Object.freeze({ binding, config }),
    options: Object.freeze({ binding, symbols, knownOrderIds, readTimeoutMs: spec.requestTimeoutMs }) });
}

type ProtectedInput = {
  readerSql: Sql; credentialSql: Sql; masterKeyProvider: MasterKeyProvider;
  assignment: ObservationAssignment; spec: HtxAccountAcquisitionSpecV1;
  host: Host; clock: ObservationClock; fetchImpl: typeof fetch;
};

/** Concrete protected read composition. Caller owns the two dedicated pools and the provider.
 * No authorize/verify/decrypt callback can replace the actual assignment/credential/metadata owners.
 * open is single-use. dispose aborts and awaits tracked SQL, key and HTTP promise settlement;
 * an uncooperative provider may delay settlement and is never declared forcibly cancelled.
 * Existing role probes require PostgreSQL >=17; synthetic PG16 journal proof does not cover this.
 */
export function createProtectedHtxAccountAcquisitionSessionV1(input: ProtectedInput) {
  const fixed = bindHtxAccountAcquisitionAssignmentV1(input);
  const { readerSql, credentialSql, masterKeyProvider, host, clock, fetchImpl } = input;
  if (readerSql === credentialSql || typeof readerSql !== "function" || typeof credentialSql !== "function" ||
      typeof clock?.now !== "function" || typeof clock?.sleep !== "function" || typeof fetchImpl !== "function")
    refuse("PROTECTED_OWNER_CONFIGURATION");
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending.add(promise);
    void promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  const trackedFetch: typeof fetch = (...args) => track(fetchImpl(...args));
  const source = createPostgresObservationAssignmentSource(readerSql, [fixed.assignment]);
  const reader = createPostgresObservationReader(readerSql);
  const authorize = (binding: Parameters<typeof source.authorizeOpen>[0], signal: AbortSignal) =>
    track(source.authorizeOpen(binding, signal));
  const credentialReader = createObservationCredentialReader({ sql: credentialSql, provider: masterKeyProvider,
    assignments: [fixed.assignment.binding] });
  const store = createObservationCredentialStore({
    credentialService: { getDecryptedCredentials: (...args) => track(credentialReader.getDecryptedCredentials(...args)) },
    bindingReader: { resolveActiveBinding: scope => track(reader.resolveActiveBinding(scope)) },
    authorizeOpen: authorize, clock, timeoutMs: fixed.spec.requestTimeoutMs,
  });
  let used = false, closed = false;
  let admission: ReturnType<typeof createHtxReadAdmission> | undefined;
  let transport: Awaited<ReturnType<typeof openHtxAccountAcquisitionTransport>> | undefined;
  let opening: Promise<Awaited<ReturnType<typeof openHtxAccountAcquisitionTransport>>> | undefined;
  let disposal: Promise<void> | undefined;
  let unlink = () => {};
  const stop = () => {
    closed = true; controller.abort(); transport?.dispose(); admission?.dispose(); store.dispose(); unlink();
  };
  const current = () => { if (closed || controller.signal.aborted) refuse("PROTECTED_OWNER_CLOSED"); };
  const dispose = () => {
    if (disposal) return disposal;
    stop();
    disposal = (async () => {
      if (opening) await Promise.allSettled([opening]);
      while (pending.size) await Promise.allSettled([...pending]);
      // Late store continuations observe cancellation before payload use; dispose again is idempotent.
      transport?.dispose(); admission?.dispose(); store.dispose();
      const underlying = await Promise.allSettled([transport?.settled(), admission?.settled()]);
      if (underlying.some(value => value.status === "rejected")) refuse("TRANSPORT_SETTLEMENT_FAILED");
    })();
    return disposal;
  };
  return Object.freeze({ dispose,
    open(signal: AbortSignal) {
      if (used || closed || signal.aborted) return Promise.reject(new HtxAccountAcquisitionRefusedV1("PROTECTED_OWNER_CLOSED"));
      used = true;
      const cancel = () => stop();
      signal.addEventListener("abort", cancel, { once: true });
      unlink = () => signal.removeEventListener("abort", cancel);
      if (signal.aborted) stop();
      opening = (async () => {
        try {
          current();
          await track(probeObservationPool(readerSql, "reader")); current();
          await track(probeObservationCredentialPool(credentialSql)); current();
          assertCredentialDecryptionAllowed(masterKeyProvider);
          transport = await openHtxAccountAcquisitionTransport({ clock, host, fetchImpl: trackedFetch,
            authorizeOpen: authorize,
            async openCredential(binding, signal) {
              const handle = await store.openCredential(binding, signal);
              try {
                current();
                admission = createHtxReadAdmission({ credential: handle, host, clock, fetchImpl: trackedFetch,
                  timeoutMs: fixed.spec.requestTimeoutMs, maxResponseBytes: fixed.spec.maxRawBytes,
                  authorizeCurrent: authorize });
                const wrapped: HtxObservationCredentialHandle = { binding: handle.binding,
                  get apiKey() { return handle.apiKey; }, get apiSecret() { return handle.apiSecret; },
                  dispose() { try { admission?.dispose(); } finally { handle.dispose(); } } };
                Object.defineProperties(wrapped, { apiKey: { enumerable: false }, apiSecret: { enumerable: false } });
                return Object.freeze(wrapped);
              } catch (error) { handle.dispose(); throw error; }
            },
            verifyReadAdmission: (binding, digest, signal) => {
              if (!admission || closed || signal.aborted) return Promise.resolve(false);
              return track(admission.verifyReadAdmission(binding, digest, signal));
            },
          }, fixed.options, controller.signal);
          current();
          const opened = transport;
          return Object.freeze({ binding: opened.binding,
            signedGet: (request: Parameters<typeof opened.signedGet>[0]) => {
              current(); return track(opened.signedGet(request));
            }, dispose: stop, settled: dispose });
        } catch (error) { stop(); throw error; }
      })();
      return opening;
    },
  });
}

type Infrastructure = {
  readerDatabaseUrl: string; credentialDatabaseUrl: string; masterKeyProvider: MasterKeyProvider;
  assignment: ObservationAssignment; host: Host;
  rawStorage: { directory: string; maxStoredBytes: number; maxStoredObjects: number };
};
/** One server-owned retained observational job, with no public route/scheduler or approving issuer.
 * The caller's existing journal DB and master provider remain borrowed; this function owns only
 * the two newly created restricted pools, the protected session and per-operation store handles.
 * Trusted job creation, complete own-order derivation, L1/method issuer and deployment key policy
 * are still prerequisites outside this primitive. No request-controlled DB URL/provider is admitted.
 */
export async function acquireConfiguredHtxAccountV1Postgres(input: {
  db: WaiaPostgresDb; context: OrgContext; accountId: string; acquisitionId: string; signal: AbortSignal;
  infrastructure: Infrastructure;
}) {
  const { infrastructure: raw, signal } = input;
  const infrastructure = { ...raw, rawStorage: { ...raw.rawStorage } };
  const url = (value: string) => {
    try { const parsed = new URL(value); if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname || !parsed.username || !parsed.pathname || parsed.pathname === '/') refuse("POOL_CONFIGURATION");
      return parsed.toString(); } catch { return refuse("POOL_CONFIGURATION"); }
  };
  const readerUrl = url(infrastructure.readerDatabaseUrl), credentialUrl = url(infrastructure.credentialDatabaseUrl);
  if (readerUrl === credentialUrl || !isAbsolute(infrastructure.rawStorage.directory) ||
      !Number.isSafeInteger(infrastructure.rawStorage.maxStoredBytes) || infrastructure.rawStorage.maxStoredBytes < 1 ||
      !Number.isSafeInteger(infrastructure.rawStorage.maxStoredObjects) || infrastructure.rawStorage.maxStoredObjects < 1 ||
      infrastructure.rawStorage.maxStoredObjects > 8192 || signal.aborted) refuse("OWNER_CONFIGURATION");
  // Clone the trusted configuration before the first await; a mutable caller cannot widen it later.
  const fixedAssignment = JSON.parse(JSON.stringify(infrastructure.assignment)) as ObservationAssignment;
  const { job, journal } = await readHtxAccountAcquisitionV1Postgres(input.db, input.context, input);
  const fixed = bindHtxAccountAcquisitionAssignmentV1({ assignment: fixedAssignment, spec: job.spec, host: infrastructure.host });
  const terminal = journal.at(-1);
  if (terminal?.kind === "TERMINAL") return terminal;
  if (journal.length !== 0) refuse("RETAINED_PREFIX_REQUIRES_RECOVERY");
  let readerSql: Sql | undefined, credentialSql: Sql | undefined;
  let session: ReturnType<typeof createProtectedHtxAccountAcquisitionSessionV1> | undefined;
  try {
    if (signal.aborted) refuse("ABORTED");
    readerSql = postgres(readerUrl, { ...observationPoolLimits, connection: { application_name: "waia-risk-acquisition-reader-v1" } });
    credentialSql = postgres(credentialUrl, { ...observationPoolLimits, connection: { application_name: "waia-risk-acquisition-credential-v1" } });
    session = createProtectedHtxAccountAcquisitionSessionV1({ readerSql, credentialSql,
      masterKeyProvider: infrastructure.masterKeyProvider, assignment: fixed.assignment, spec: fixed.spec,
      host: infrastructure.host, clock: accountObservationClock, fetchImpl: fetch });
    const transport = await session.open(signal);
    assertCredentialStorageAllowed(infrastructure.masterKeyProvider);
    const store = await createEncryptedReferenceRawStoreV1({ ...infrastructure.rawStorage,
      masterKeyProvider: infrastructure.masterKeyProvider });
    if (signal.aborted) refuse("ABORTED");
    return await acquireHtxAccountV1Postgres({ ...input, transport, store });
  } finally {
    try { await session?.dispose(); }
    finally {
      const closures = await Promise.allSettled([readerSql?.end({ timeout: 5 }), credentialSql?.end({ timeout: 5 })]);
      if (closures.some(value => value.status === "rejected")) refuse("POOL_CLOSURE_FAILED");
    }
  }
}
