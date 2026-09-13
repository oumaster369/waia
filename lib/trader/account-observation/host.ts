import "server-only";
import type { Sql } from "postgres";
import type { CredentialService } from "@/lib/trader/credentials/types";
import { createConfiguredHtxObservationRuntime, type ConfiguredHtxObservationAssignment } from "./configured-runtime";
import { createObservationConfiguration, type ObservationRuntimeEvent } from "./runtime";
import { observationBindingSchema } from "./validation";
import { htxObservationCoverageSchema, htxObservationReaderLimitsSchema } from "./coverage";
import { observationPoolLimits, probeObservationPool } from "./host-role-probe";
import type { ObservationClock } from "./types";

type OwnedResource = Readonly<{ dispose(): Promise<void> }>;
export type ObservationSqlResource = OwnedResource & Readonly<{ sql: Sql }>;
export type ObservationCredentialResource = OwnedResource & Readonly<{
  service: Pick<CredentialService, "getDecryptedCredentials">;
}>;
export type ObservationHostEvent = ObservationRuntimeEvent | "HOST_STARTED" | "HOST_STOPPED" |
  "HOST_FAILED" | "HOST_CLEANUP_FAILED";
export type ObservationHostInput = Readonly<{
  configured: readonly ConfiguredHtxObservationAssignment[];
  host: "api.huobi.pro" | "api-aws.huobi.pro";
  ownerId: string; intervalMs: number; iterationTimeoutMs: number;
  openTimeoutMs: number; shutdownTimeoutMs: number;
  openCollector(signal: AbortSignal, limits: typeof observationPoolLimits): Promise<ObservationSqlResource>;
  openReader(signal: AbortSignal, limits: typeof observationPoolLimits): Promise<ObservationSqlResource>;
  openCredentialService(signal: AbortSignal): Promise<ObservationCredentialResource>;
  fetchImpl: typeof fetch; clock: ObservationClock; report(event: ObservationHostEvent): void;
}>;
const failure = () => new Error("ACCOUNT_OBSERVATION_HOST_FAILED");
const aborted = () => new Error("ACCOUNT_OBSERVATION_HOST_ABORTED");

function validate(input: ObservationHostInput) {
  try {
    if (!input || [input.openCollector, input.openReader, input.openCredentialService, input.fetchImpl,
      input.clock?.now, input.clock?.sleep, input.report].some(fn => typeof fn !== "function") ||
      typeof input.ownerId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.ownerId) ||
      !["api.huobi.pro", "api-aws.huobi.pro"].includes(input.host) ||
      !Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1000 || input.intervalMs > 86400000 ||
      !Number.isSafeInteger(input.iterationTimeoutMs) || input.iterationTimeoutMs < 100 || input.iterationTimeoutMs > 3600000 ||
      [input.openTimeoutMs, input.shutdownTimeoutMs].some(ms => !Number.isSafeInteger(ms) || ms < 100 || ms > 60000) ||
      !Array.isArray(input.configured) || input.configured.length > 20) throw failure();
    const seen = new Set<string>();
    const configured = input.configured.map(item => {
      const binding = Object.freeze(observationBindingSchema.parse(item.binding));
      const { revision, ...parameters } = item.config;
      const config = createObservationConfiguration(parameters);
      const readerLimits = Object.freeze(htxObservationReaderLimitsSchema.parse(item.readerLimits));
      const coverage = htxObservationCoverageSchema.parse({ ...readerLimits, host: input.host });
      const account = JSON.stringify([binding.organizationId, binding.exchangeAccountId]);
      if (!/^[1-9]\d{0,39}$/.test(binding.exchangeAccountId) || seen.has(account) ||
        revision !== config.revision || binding.configurationRevision !== config.revision ||
        config.leaseTtlMs > input.iterationTimeoutMs || !config.htxCoverage ||
        JSON.stringify(config.htxCoverage) !== JSON.stringify(coverage)) throw failure();
      seen.add(account); return Object.freeze({ binding, config, readerLimits });
    });
    return Object.freeze({ ...input, configured: Object.freeze(configured) });
  } catch { throw failure(); }
}

/** Explicit protected host, not a daemon/CLI or an authorization/provisioning service.
 * Factories are trusted infrastructure adapters, never a source of venue admission.
 * They must create fresh separately provisioned pool LOGINs and honor bounded driver
 * options, cancellation and disposal. Actual role metadata is checked before a protected
 * service opens; the existing runtime still validates DB currentness and concrete HTX
 * metadata for each operation. No environment discovery or implicit process startup.
 * A timeout reports failure, not proof that an uncooperative provider closed: late
 * resources are disposed when delivered, with a fixed cleanup-failure event if necessary.
 */
export function createAccountObservationHost(raw: ObservationHostInput) {
  const input = validate(raw);
  const controller = new AbortController();
  let started = false; let stopped = false; let work: Promise<void> | undefined;
  const resources: OwnedResource[] = []; const disposed = new WeakSet<object>();
  const report = (event: ObservationHostEvent) => { try { input.report(event); } catch { /* Diagnostics cannot own cleanup. */ } };

  function bounded<T>(pending: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancel = () => finish(() => reject(aborted()));
      const timer = setTimeout(() => finish(() => reject(failure())), timeoutMs);
      let settled = false;
      const finish = (complete: () => void) => {
        if (settled) return; settled = true; clearTimeout(timer);
        signal?.removeEventListener("abort", cancel); complete();
      };
      signal?.addEventListener("abort", cancel, { once: true });
      pending.then(value => finish(() => resolve(value)), () => finish(() => reject(failure())));
      if (signal?.aborted) cancel();
    });
  }
  async function close(resource: OwnedResource): Promise<void> {
    if (disposed.has(resource)) return; disposed.add(resource);
    await bounded(Promise.resolve().then(() => resource.dispose()), input.shutdownTimeoutMs);
  }
  async function acquire<T extends OwnedResource>(factory: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (controller.signal.aborted) throw aborted();
    const opening = new AbortController(); const cancel = () => opening.abort();
    controller.signal.addEventListener("abort", cancel, { once: true });
    let abandoned = false; let acquired = false;
    const pending = Promise.resolve().then(() => {
      if (opening.signal.aborted) throw aborted();
      return factory(opening.signal);
    }).then(async resource => {
      if (!resource || typeof resource.dispose !== "function") throw failure();
      if (abandoned || opening.signal.aborted) {
        try { await close(resource); } catch { report("HOST_CLEANUP_FAILED"); }
        throw aborted();
      }
      resources.push(resource); return resource;
    });
    try {
      const resource = await bounded(pending, input.openTimeoutMs, controller.signal);
      acquired = true; return resource;
    } finally {
      abandoned = true;
      // Opening signal covers construction only; a successful resource remains usable
      // until its explicit owned dispose(), not an abort immediately after acquisition.
      if (!acquired) opening.abort();
      controller.signal.removeEventListener("abort", cancel);
    }
  }
  async function execute(signal: AbortSignal) {
    const cancel = () => controller.abort(); signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    let failed = false; let runtime: ReturnType<typeof createConfiguredHtxObservationRuntime> | undefined;
    let running: Promise<void> | undefined;
    try {
      if (controller.signal.aborted) return;
      const collector = await acquire(s => input.openCollector(s, observationPoolLimits));
      const collectorLogin = await bounded(probeObservationPool(collector.sql, "collector"), input.openTimeoutMs, controller.signal);
      const reader = await acquire(s => input.openReader(s, observationPoolLimits));
      if (reader === collector || reader.sql === collector.sql) throw failure();
      const readerLogin = await bounded(probeObservationPool(reader.sql, "reader"), input.openTimeoutMs, controller.signal);
      if (collectorLogin === readerLogin) throw failure();
      const credentials = await acquire(input.openCredentialService);
      if (typeof credentials.service?.getDecryptedCredentials !== "function") throw failure();
      if (controller.signal.aborted) throw aborted();
      runtime = createConfiguredHtxObservationRuntime({ ...input, collectorSql: collector.sql,
        readerSql: reader.sql, protectedCredentialService: credentials.service, report });
      report("HOST_STARTED");
      running = runtime.run(controller.signal);
      // No lifetime deadline for a healthy recurring host. Cancellation starts a bounded drain.
      await new Promise<void>((resolve, reject) => {
        const stop = () => { cleanup(); resolve(); };
        const cleanup = () => controller.signal.removeEventListener("abort", stop);
        controller.signal.addEventListener("abort", stop, { once: true });
        running!.then(() => { cleanup(); resolve(); }, () => { cleanup(); reject(failure()); });
        if (controller.signal.aborted) stop();
      });
    } catch (error) {
      if (!(controller.signal.aborted && error instanceof Error && error.message === "ACCOUNT_OBSERVATION_HOST_ABORTED")) failed = true;
    } finally {
      stopped = true; controller.abort(); signal.removeEventListener("abort", cancel);
      try { runtime?.dispose(); } catch { failed = true; report("HOST_CLEANUP_FAILED"); }
      if (running) { try { await bounded(running, input.shutdownTimeoutMs); } catch { failed = true; report("HOST_CLEANUP_FAILED"); } }
      for (const resource of [...resources].reverse()) {
        try { await close(resource); } catch { failed = true; report("HOST_CLEANUP_FAILED"); }
      }
      report(failed ? "HOST_FAILED" : "HOST_STOPPED");
    }
    if (failed) throw failure();
  }
  return Object.freeze({
    run(signal: AbortSignal): Promise<void> {
      if (started || stopped || !signal || typeof signal.addEventListener !== "function") return Promise.reject(failure());
      started = true; work = execute(signal); return work;
    },
    async stop(): Promise<void> { stopped = true; controller.abort(); await work; },
  });
}
