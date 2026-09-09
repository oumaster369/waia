import "server-only";
import type { Sql } from "postgres";
import { z } from "zod";
import type { CredentialService } from "@/lib/trader/credentials/types";
import { createObservationConfiguration, createPostgresAccountObservationRuntime,
  type ObservationAssignment, type ObservationRuntimeEvent } from "./runtime";
import { createPostgresObservationAssignmentSource } from "./postgres-assignments";
import { createPostgresObservationReader } from "./postgres-reader";
import { createObservationCredentialStore } from "./credential-store";
import { openHtxObservationReader } from "./htx-reader-opener";
import type { HtxObservationReaderOptions } from "./htx-reader";
import { observationBindingSchema } from "./validation";
import { AccountObservationReadFailure } from "./service";
import type { AccountObservationReader, ObservationBinding, ObservationClock } from "./types";

const readerLimitsSchema = z.object({
  pageSize: z.number().int().min(1).max(500), maxPages: z.number().int().min(1).max(10),
  maxRecords: z.number().int().min(1).max(1000), maxResponseBytes: z.number().int().min(1).max(1048576),
  tradeWindowMs: z.number().int().min(1).max(172800000),
}).strict();
export type ConfiguredHtxObservationAssignment = ObservationAssignment & Readonly<{
  readerLimits: z.infer<typeof readerLimitsSchema>;
}>;
type AdmissionVerifier = Parameters<typeof openHtxObservationReader>[0]["verifyReadAdmission"];
const key = (binding: ObservationBinding) => JSON.stringify(binding);
function failure(): never { throw new Error("ACCOUNT_OBSERVATION_CONFIGURED_RUNTIME_FAILED"); }

/** Explicit composition only: no import/construction-time I/O or process launch.
 * Caller supplies independently authorized, bounded collector/reader SQL clients,
 * the existing protected credential service, trusted operator assignments, exact-key
 * exchange admission verifier and network implementation. It retains pool ownership.
 * Neither assignment currentness nor credential decryption manufactures venue admission.
 *
 * One owner may await run(signal) once. Completion, cancellation and dispose close
 * all owned readers/key handles. A new run needs a fresh composition and admission.
 * Reader page/history limits are pinned for this instance; the existing persisted
 * config revision covers symbols/timing, not these transport coverage limits.
 */
export function createConfiguredHtxObservationRuntime(input: Readonly<{
  collectorSql: Sql; readerSql: Sql;
  protectedCredentialService: Pick<CredentialService, "getDecryptedCredentials">;
  configured: readonly ConfiguredHtxObservationAssignment[];
  host: "api.huobi.pro" | "api-aws.huobi.pro";
  fetchImpl: typeof fetch; verifyReadAdmission: AdmissionVerifier;
  clock: ObservationClock; report(event: ObservationRuntimeEvent): void;
  ownerId: string; intervalMs: number; iterationTimeoutMs: number;
}>) {
  // Validate the complete list BEFORE allocating owned stores or constructing a runtime.
  const fixed = (() => {
    try {
      if (!input.collectorSql || !input.readerSql || input.collectorSql === input.readerSql ||
        typeof input.protectedCredentialService?.getDecryptedCredentials !== "function" ||
        typeof input.fetchImpl !== "function" || typeof input.verifyReadAdmission !== "function" ||
        typeof input.clock?.now !== "function" || typeof input.clock?.sleep !== "function" ||
        typeof input.report !== "function" || typeof input.ownerId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.ownerId) ||
        !["api.huobi.pro", "api-aws.huobi.pro"].includes(input.host) ||
        !Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1000 || input.intervalMs > 86400000 ||
        !Number.isSafeInteger(input.iterationTimeoutMs) || input.iterationTimeoutMs < 100 || input.iterationTimeoutMs > 3600000 ||
        !Array.isArray(input.configured) || input.configured.length > 20) failure();
      const seen = new Set<string>();
      return input.configured.map(item => {
        const binding = Object.freeze(observationBindingSchema.parse(item.binding));
        if (!/^[1-9]\d{0,39}$/.test(binding.exchangeAccountId)) failure();
        const { revision, ...parameters } = item.config;
        const config = createObservationConfiguration(parameters);
        const account = JSON.stringify([binding.organizationId, binding.exchangeAccountId]);
        if (revision !== config.revision || binding.configurationRevision !== config.revision || seen.has(account) ||
          config.leaseTtlMs > input.iterationTimeoutMs) failure();
        seen.add(account);
        const readerLimits = Object.freeze(readerLimitsSchema.parse(item.readerLimits));
        return Object.freeze({ binding, config, readerLimits });
      });
    } catch { return failure(); }
  })();
  const { collectorSql, readerSql, protectedCredentialService, host, fetchImpl,
    verifyReadAdmission, clock, report, ownerId, intervalMs, iterationTimeoutMs } = input;
  const source = createPostgresObservationAssignmentSource(readerSql, fixed);
  const bindingReader = createPostgresObservationReader(readerSql);
  const stores = new Map<string, ReturnType<typeof createObservationCredentialStore>>();
  const options = new Map<string, HtxObservationReaderOptions>();
  for (const item of fixed) {
    const id = key(item.binding);
    stores.set(id, createObservationCredentialStore({ credentialService: protectedCredentialService,
      bindingReader, authorizeOpen: source.authorizeOpen, clock, timeoutMs: item.config.readTimeoutMs }));
    options.set(id, Object.freeze({ ...item.readerLimits, binding: item.binding,
      symbols: item.config.symbols, readTimeoutMs: item.config.readTimeoutMs }));
  }
  const controller = new AbortController(); const opening = new Set<AbortController>();
  const readers = new Set<AccountObservationReader>(); let started = false; let closed = false;
  const dispose = () => {
    if (closed) return; closed = true; controller.abort();
    for (const pending of opening) pending.abort();
    let failed = false;
    for (const reader of readers) { try { reader.dispose(); } catch { failed = true; } }
    for (const store of stores.values()) { try { store.dispose(); } catch { failed = true; } }
    if (failed) failure();
  };
  const runtime = createPostgresAccountObservationRuntime({ sql: collectorSql,
    loadAssignments: source.loadAssignments, clock, report, ownerId, intervalMs, iterationTimeoutMs,
    maxAccounts: 20,
    async openReader(requested, signal) {
      if (closed || !started || signal.aborted) throw new AccountObservationReadFailure("READ_FAILED");
      let binding: ObservationBinding;
      try { binding = observationBindingSchema.parse(requested); } catch { return failure(); }
      const id = key(binding); const store = stores.get(id); const readerOptions = options.get(id);
      if (!store || !readerOptions) throw new AccountObservationReadFailure("IDENTITY_MISMATCH");
      const abort = new AbortController(); opening.add(abort);
      const cancel = () => abort.abort(); signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted || closed) cancel();
      let owned: AccountObservationReader | undefined;
      try {
        owned = await openHtxObservationReader({ clock, host, fetchImpl, verifyReadAdmission,
          authorizeOpen: source.authorizeOpen, openCredential: store.openCredential }, readerOptions, abort.signal);
        if (closed || abort.signal.aborted) { owned.dispose(); throw new AccountObservationReadFailure("READ_FAILED"); }
        const reader = owned; let released = false;
        const wrapped = Object.freeze({ readBalances: reader.readBalances, readOpenOrders: reader.readOpenOrders,
          readTrades: reader.readTrades,
          dispose() {
            if (released) return; released = true;
            try { reader.dispose(); } finally { readers.delete(wrapped); }
          },
        });
        readers.add(wrapped); return wrapped;
      } finally {
        signal.removeEventListener("abort", cancel); opening.delete(abort); abort.abort();
      }
    },
  });
  return Object.freeze({ dispose,
    async run(signal: AbortSignal): Promise<void> {
      if (started || closed) failure(); started = true;
      if (signal.aborted) { dispose(); return; }
      const cancel = () => controller.abort(); signal.addEventListener("abort", cancel, { once: true });
      let failed = false;
      try { await runtime.run(controller.signal); } catch { failed = true; }
      finally {
        signal.removeEventListener("abort", cancel);
        try { dispose(); } catch { failed = true; }
      }
      if (failed) failure();
    },
  });
}
