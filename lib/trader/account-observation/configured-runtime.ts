import "server-only";
import type { Sql } from "postgres";
import { z } from "zod";
import type { CredentialService } from "@/lib/trader/credentials/types";
import {
  createObservationConfiguration,
  createPostgresAccountObservationRuntime,
  type ObservationAssignment,
  type ObservationRuntimeEvent,
} from "./runtime";
import { createPostgresObservationAssignmentSource } from "./postgres-assignments";
import { createPostgresObservationReader } from "./postgres-reader";
import { createObservationCredentialStore } from "./credential-store";
import { openHtxObservationReader, type HtxObservationCredentialHandle } from "./htx-reader-opener";
import { createHtxReadAdmission } from "./htx-read-admission";
import { createHtxDerivativesObservationReader } from "./derivatives/reader";
import { createHtxV5ObservationReader } from "./derivatives/htx-v5-reader";
import { HTX_V5_READ_BUDGET_MS } from "./types";
import type { HtxV5ObservationReader } from "./derivatives/htx-v5-reader";
import type { HtxObservationReaderOptions } from "./htx-reader";
import { observationBindingSchema } from "./validation";
import { AccountObservationReadFailure } from "./service";
import type { AccountObservationReader, ObservationBinding, ObservationClock } from "./types";
import { htxObservationReaderLimitsSchema, htxObservationCoverageSchema } from "./coverage";

export type ConfiguredHtxObservationAssignment = ObservationAssignment &
  Readonly<{
    readerLimits: z.infer<typeof htxObservationReaderLimitsSchema>;
  }>;
type AdmissionVerifier = Parameters<typeof openHtxObservationReader>[0]["verifyReadAdmission"];
const key = (binding: ObservationBinding) => JSON.stringify(binding);
function failure(): never {
  throw new Error("ACCOUNT_OBSERVATION_CONFIGURED_RUNTIME_FAILED");
}

/** Explicit composition only: no import/construction-time I/O or process launch.
 * Caller supplies independently authorized, bounded collector/reader SQL clients,
 * the existing protected credential service, trusted operator assignments and a network
 * implementation. Same-key venue admission is performed by the concrete metadata reader;
 * an optional extra verifier can veto it, never replace it. Caller retains pool ownership.
 * Neither assignment currentness nor credential decryption manufactures venue admission.
 *
 * One owner may await run(signal) once. Completion, cancellation and dispose close
 * all owned readers/key handles. A new run needs a fresh composition and admission.
 * Host and reader coverage must match the persisted configuration digest. Legacy
 * symbols/timing-only revisions cannot open this credential-capable composition.
 */
export function createConfiguredHtxObservationRuntime(
  input: Readonly<{
    collectorSql: Sql;
    readerSql: Sql;
    protectedCredentialService: Pick<CredentialService, "getDecryptedCredentials">;
    configured: readonly ConfiguredHtxObservationAssignment[];
    host: "api.huobi.pro" | "api-aws.huobi.pro";
    fetchImpl: typeof fetch;
    verifyReadAdmission?: AdmissionVerifier;
    clock: ObservationClock;
    report(event: ObservationRuntimeEvent): void;
    ownerId: string;
    intervalMs: number;
    iterationTimeoutMs: number;
  }>,
) {
  // Validate the complete list BEFORE allocating owned stores or constructing a runtime.
  const fixed = (() => {
    try {
      if (
        !input.collectorSql ||
        !input.readerSql ||
        input.collectorSql === input.readerSql ||
        typeof input.protectedCredentialService?.getDecryptedCredentials !== "function" ||
        typeof input.fetchImpl !== "function" ||
        (input.verifyReadAdmission !== undefined &&
          typeof input.verifyReadAdmission !== "function") ||
        typeof input.clock?.now !== "function" ||
        typeof input.clock?.sleep !== "function" ||
        typeof input.report !== "function" ||
        typeof input.ownerId !== "string" ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(input.ownerId) ||
        !["api.huobi.pro", "api-aws.huobi.pro"].includes(input.host) ||
        !Number.isSafeInteger(input.intervalMs) ||
        input.intervalMs < 1000 ||
        input.intervalMs > 86400000 ||
        !Number.isSafeInteger(input.iterationTimeoutMs) ||
        input.iterationTimeoutMs < 100 ||
        input.iterationTimeoutMs > 3600000 ||
        !Array.isArray(input.configured) ||
        input.configured.length > 20
      )
        failure();
      const seen = new Set<string>();
      return input.configured.map((item) => {
        const binding = Object.freeze(observationBindingSchema.parse(item.binding));
        if (!/^[1-9]\d{0,39}$/.test(binding.exchangeAccountId)) failure();
        const { revision, ...parameters } = item.config;
        const config = createObservationConfiguration(parameters);
        const account = JSON.stringify([binding.organizationId, binding.exchangeAccountId]);
        if (
          revision !== config.revision ||
          binding.configurationRevision !== config.revision ||
          seen.has(account) ||
          config.leaseTtlMs > input.iterationTimeoutMs
        )
          failure();
        seen.add(account);
        const readerLimits = Object.freeze(
          htxObservationReaderLimitsSchema.parse(item.readerLimits),
        );
        const coverage = htxObservationCoverageSchema.parse({ ...readerLimits, host: input.host });
        if (!config.htxCoverage || JSON.stringify(config.htxCoverage) !== JSON.stringify(coverage))
          failure();
        return Object.freeze({ binding, config, readerLimits });
      });
    } catch {
      return failure();
    }
  })();
  const {
    collectorSql,
    readerSql,
    protectedCredentialService,
    host,
    fetchImpl,
    verifyReadAdmission,
    clock,
    report,
    ownerId,
    intervalMs,
    iterationTimeoutMs,
  } = input;
  const source = createPostgresObservationAssignmentSource(readerSql, fixed, collectorSql);
  const bindingReader = createPostgresObservationReader(readerSql);
  const stores = new Map<string, ReturnType<typeof createObservationCredentialStore>>();
  const options = new Map<string, HtxObservationReaderOptions>();
  const derivativeReaders = new Set<ReturnType<typeof createHtxDerivativesObservationReader>>();
  const htxV5Readers = new Map<HtxV5ObservationReader, string>();
  const admissions = new Set<ReturnType<typeof createHtxReadAdmission>>();
  const closingAdmissions = new WeakSet<ReturnType<typeof createHtxReadAdmission>>();
  // Per-opening owners survive prompt abort rejection. The service drains this exact
  // binding before releasing its persistent lease, including initial metadata admission.
  const cleanupOwners = new Map<string, { accountKey: string; settle(): Promise<void> }>();
  let derivativeCleanupFailed = false;
  const releaseDerivatives = (
    reader: ReturnType<typeof createHtxDerivativesObservationReader> | undefined,
  ) => {
    if (!reader) return;
    reader.dispose();
    void reader.settled().then(
      () => derivativeReaders.delete(reader),
      () => {
        derivativeCleanupFailed = true;
      },
    );
  };
  const releaseHtxV5 = (reader: HtxV5ObservationReader | undefined) => {
    if (!reader) return;
    reader.dispose();
    void reader.settled().then(
      () => htxV5Readers.delete(reader),
      () => { derivativeCleanupFailed = true; },
    );
  };
  const releaseAdmission = (admission: ReturnType<typeof createHtxReadAdmission> | undefined) => {
    if (!admission || closingAdmissions.has(admission)) return;
    closingAdmissions.add(admission);
    admission.dispose();
    // Abort cannot force an injected fetch to settle. Keep ownership and count
    // against the open limit until all metadata work actually settles.
    void admission.settled().then(
      () => admissions.delete(admission),
      () => {
        derivativeCleanupFailed = true;
      },
    );
  };
  const template = fixed[0];
  const ensureStore = (binding: ObservationBinding) => {
    const id = key(binding);
    const assignment =
      fixed.find((item) => key(item.binding) === id) ??
      (template &&
      !template.config.htxDerivativesFamilies?.length &&
      !template.config.htxV5?.expectedHtxUid &&
      binding.configurationRevision === template.config.revision
        ? template
        : undefined);
    if (!assignment) return null;
    const config = assignment.config;
    const existingStore = stores.get(id);
    const existingOptions = options.get(id);
    if (existingStore && existingOptions)
      return { store: existingStore, readerOptions: existingOptions, config };
    const store = createObservationCredentialStore({
      credentialService: protectedCredentialService,
      bindingReader,
      authorizeOpen: source.authorizeOpen,
      clock,
      timeoutMs: config.readTimeoutMs,
    });
    const readerOptions = Object.freeze({
      ...assignment.readerLimits,
      binding,
      symbols: config.symbols,
      readTimeoutMs: config.readTimeoutMs,
    });
    stores.set(id, store);
    options.set(id, readerOptions);
    return { store, readerOptions, config };
  };
  for (const item of fixed) ensureStore(item.binding);
  const controller = new AbortController();
  const opening = new Set<AbortController>();
  const readers = new Set<AccountObservationReader>();
  let started = false;
  let closed = false;
  const dispose = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    for (const pending of opening) pending.abort();
    let failed = false;
    for (const admission of admissions) {
      try {
        releaseAdmission(admission);
      } catch {
        failed = true;
      }
    }
    for (const reader of derivativeReaders) {
      try {
        reader.dispose();
      } catch {
        failed = true;
      }
    }
    for (const reader of htxV5Readers.keys()) {
      try { releaseHtxV5(reader); } catch { failed = true; }
    }
    for (const reader of readers) {
      try {
        reader.dispose();
      } catch {
        failed = true;
      }
    }
    for (const store of stores.values()) {
      try {
        store.dispose();
      } catch {
        failed = true;
      }
    }
    if (failed) failure();
  };
  const runtime = createPostgresAccountObservationRuntime({
    sql: collectorSql,
    loadAssignments: source.loadAssignments,
    clock,
    report,
    ownerId,
    intervalMs,
    iterationTimeoutMs,
    maxAccounts: 20,
    async settleReader(binding) {
      const id = key(binding);
      const owner = cleanupOwners.get(id);
      if (!owner) return;
      await owner.settle();
      if (cleanupOwners.get(id) === owner) cleanupOwners.delete(id);
    },
    async openReader(requested, signal) {
      if (
        closed ||
        !started ||
        signal.aborted ||
        derivativeCleanupFailed ||
        derivativeReaders.size >= 20 ||
        htxV5Readers.size >= 20 ||
        admissions.size >= 20 ||
        cleanupOwners.size >= 20
      )
        throw new AccountObservationReadFailure("READ_FAILED");
      let binding: ObservationBinding;
      try {
        binding = observationBindingSchema.parse(requested);
      } catch {
        return failure();
      }
      const accountKey = JSON.stringify([binding.organizationId, binding.exchangeAccountId]);
      if ([...htxV5Readers.values()].includes(accountKey) ||
        [...cleanupOwners.values()].some(owner => owner.accountKey === accountKey))
        throw new AccountObservationReadFailure("READ_FAILED");
      const opened = ensureStore(binding);
      if (!opened) throw new AccountObservationReadFailure("IDENTITY_MISMATCH");
      const { store, readerOptions, config } = opened;
      const abort = new AbortController();
      opening.add(abort);
      const cancel = () => abort.abort();
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted || closed) cancel();
      let owned: AccountObservationReader | undefined;
      let admission: ReturnType<typeof createHtxReadAdmission> | undefined;
      let derivatives: ReturnType<typeof createHtxDerivativesObservationReader> | undefined;
      let htxV5Reader: HtxV5ObservationReader | undefined;
      let openerWork: Promise<void> | undefined;
      let openedDone!: () => void;
      const openingDone = new Promise<void>(resolve => { openedDone = resolve; });
      cleanupOwners.set(key(binding), {
        accountKey,
        async settle() {
          await openingDone;
          await openerWork;
          // Calling settled also disposes the concrete transports. Failure retains
          // ownership and the lease for expiry recovery; never declare clean shutdown.
          let disposalFailed = false;
          try { owned?.dispose(); } catch { disposalFailed = true; }
          const drained = await Promise.allSettled([
            () => owned?.settled?.(), () => admission?.settled(),
            () => derivatives?.settled(), () => htxV5Reader?.settled(), () => store.settled(),
          ].map(async settle => settle()));
          if (disposalFailed || drained.some(result => result.status === "rejected")) failure();
        },
      });
      const verifyExactKey: AdmissionVerifier = async (scope, digest, admissionSignal) => {
        if (closed || admissionSignal.aborted || !admission) return false;
        if (
          verifyReadAdmission &&
          (await verifyReadAdmission(scope, digest, admissionSignal)) !== true
        )
          return false;
        return admission.verifyReadAdmission(scope, digest, admissionSignal);
      };
      try {
        owned = await openHtxObservationReader(
          {
            clock,
            host,
            fetchImpl,
            trackOpening(work) { openerWork = work; },
            authorizeOpen: source.authorizeOpen,
            async openCredential(scope, credentialSignal) {
              const handle = await store.openCredential(scope, credentialSignal);
              try {
                admission = createHtxReadAdmission({
                  credential: handle,
                  host,
                  clock,
                  fetchImpl,
                  timeoutMs: readerOptions.readTimeoutMs,
                  maxResponseBytes: readerOptions.maxResponseBytes,
                  requireReadOnlyPermission: Boolean(config.htxDerivativesFamilies?.length),
                  authorizeCurrent: source.authorizeOpen,
                });
                admissions.add(admission);
                if (config.htxDerivativesFamilies?.length) {
                  derivatives = createHtxDerivativesObservationReader({
                    credential: handle,
                    families: config.htxDerivativesFamilies,
                    ...(config.htxDerivativesFillContracts
                      ? { fillContracts: config.htxDerivativesFillContracts }
                      : {}),
                    clock,
                    fetchImpl,
                    timeoutMs: readerOptions.readTimeoutMs,
                    maxResponseBytes: readerOptions.maxResponseBytes,
                    verifyReadOnlyAdmission: verifyExactKey,
                  });
                  derivativeReaders.add(derivatives);
                }
                if (config.htxV5?.enabled) {
                  htxV5Reader = createHtxV5ObservationReader({
                    credential: handle,
                    clock,
                    fetchImpl,
                    timeoutMs: HTX_V5_READ_BUDGET_MS,
                    maxResponseBytes: readerOptions.maxResponseBytes,
                    ...(config.htxV5.expectedHtxUid ? { expectedHtxUid: config.htxV5.expectedHtxUid } : {}),
                    ...(config.htxV5.fillContracts ? { contracts: config.htxV5.fillContracts } : {}),
                    authorizeCurrent: source.authorizeOpen,
                  });
                  htxV5Readers.set(htxV5Reader, accountKey);
                }
                // Keep the protected store's non-enumerable, disposal-aware accessors;
                // never spread/copy secrets into an enumerable wrapper or retain new strings.
                const wrapped: HtxObservationCredentialHandle = {
                  binding: handle.binding,
                  get apiKey() {
                    return handle.apiKey;
                  },
                  get apiSecret() {
                    return handle.apiSecret;
                  },
                  dispose() {
                    try {
                      releaseHtxV5(htxV5Reader);
                    } finally {
                      try {
                        releaseDerivatives(derivatives);
                      } finally {
                        try {
                          releaseAdmission(admission);
                        } finally {
                          handle.dispose();
                        }
                      }
                    }
                  },
                };
                Object.defineProperties(wrapped, {
                  apiKey: { enumerable: false },
                  apiSecret: { enumerable: false },
                });
                return Object.freeze(wrapped);
              } catch (error) {
                try { releaseHtxV5(htxV5Reader); }
                finally {
                  try { releaseDerivatives(derivatives); }
                  finally { try { releaseAdmission(admission); } finally { handle.dispose(); } }
                }
                throw error;
              }
            },
            verifyReadAdmission: verifyExactKey,
          },
          readerOptions,
          abort.signal,
        );
        if (closed || abort.signal.aborted) {
          owned.dispose();
          throw new AccountObservationReadFailure("READ_FAILED");
        }
        const reader = owned;
        let released = false;
        const wrapped = Object.freeze({
          readBalances: reader.readBalances,
          readOpenOrders: reader.readOpenOrders,
          readTrades: reader.readTrades,
          settled: reader.settled,
          ...(derivatives ? { readDerivativesAccount: derivatives.readDerivativesAccount } : {}),
          ...(htxV5Reader ? { readHtxV5: async (requestSignal: AbortSignal) => Object.freeze({
            binding: readerOptions.binding,
            projection: await htxV5Reader!.read(requestSignal),
          }) } : {}),
          dispose() {
            if (released) return;
            released = true;
            try {
              reader.dispose();
            } finally {
              readers.delete(wrapped);
            }
          },
        });
        readers.add(wrapped);
        return wrapped;
      } finally {
        try {
          if (!owned) {
            try {
              releaseHtxV5(htxV5Reader);
            } finally {
              try { releaseDerivatives(derivatives); }
              finally { releaseAdmission(admission); }
            }
          }
        } finally {
          signal.removeEventListener("abort", cancel);
          opening.delete(abort);
          abort.abort();
          openedDone();
        }
      }
    },
  });
  return Object.freeze({
    dispose,
    async run(signal: AbortSignal): Promise<void> {
      if (started || closed) failure();
      started = true;
      if (signal.aborted) {
        dispose();
        return;
      }
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      let failed = false;
      try {
        await runtime.run(controller.signal);
      } catch {
        failed = true;
      } finally {
        signal.removeEventListener("abort", cancel);
        try {
          dispose();
        } catch {
          failed = true;
        }
      }
      if (failed || derivativeCleanupFailed || cleanupOwners.size > 0) failure();
    },
  });
}
