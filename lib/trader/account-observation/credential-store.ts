import "server-only";
import type { CredentialService } from "@/lib/trader/credentials/types";
import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";
import type { createPostgresObservationReader } from "./postgres-reader";
import type { HtxObservationCredentialHandle } from "./htx-reader-opener";
import { AccountObservationReadFailure } from "./service";
import { observationBindingSchema, sameObservationBinding } from "./validation";
import type { ObservationBinding, ObservationClock } from "./types";

class CredentialStoreFailure extends AccountObservationReadFailure {}
function fail(code: "READ_FAILED" | "TIMEOUT" | "PERMISSION_DENIED" | "IDENTITY_MISMATCH"): never {
  throw new CredentialStoreFailure(code);
}

/** Bridges EXISTING protected-store decryption to the observation opener. Inject
 * createPostgresCredentialService's getDecryptedCredentials and the observation
 * reader's resolveActiveBinding on separately bounded/authorized database clients.
 * The existing service retains its master-key readiness, org and payload-AAD gates.
 * No default provider, database, SQL, environment lookup or exchange call exists here.
 *
 * Exact before/after revision checks require migration 0205's monotonic trigger:
 * metadata, account, permissions or ciphertext changes must advance the revision.
 * These checks are not exchange admission; verifyReadAdmission remains separately
 * REQUIRED by openHtxObservationReader and rechecked by its transport on each GET.
 */
export function createObservationCredentialStore(input: Readonly<{
  credentialService: Pick<CredentialService, "getDecryptedCredentials">;
  bindingReader: Pick<ReturnType<typeof createPostgresObservationReader>, "resolveActiveBinding">;
  authorizeOpen(binding: ObservationBinding, signal: AbortSignal): Promise<boolean>;
  clock: ObservationClock; timeoutMs: number;
}>) {
  const { clock, timeoutMs } = input;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) fail("READ_FAILED");
  const decrypt = input.credentialService.getDecryptedCredentials.bind(input.credentialService);
  const resolve = input.bindingReader.resolveActiveBinding.bind(input.bindingReader);
  const authorize = input.authorizeOpen.bind(input);
  let disposed = false; let active: AbortController | null = null;
  const handles = new Set<HtxObservationCredentialHandle>();
  return Object.freeze({
    async openCredential(requested: ObservationBinding, signal: AbortSignal): Promise<HtxObservationCredentialHandle> {
      if (disposed || active || handles.size >= 20 || signal.aborted) fail("READ_FAILED");
      let binding: ObservationBinding;
      try { binding = Object.freeze(observationBindingSchema.parse(requested)); }
      catch { return fail("READ_FAILED"); }
      const scope = Object.freeze({ organizationId: binding.organizationId,
        credentialId: binding.credentialId, exchangeAccountId: binding.exchangeAccountId });
      const context = Object.freeze({ organizationId: binding.organizationId });
      const controller = new AbortController(); const timer = new AbortController(); active = controller;
      let abandoned = false; let created: HtxObservationCredentialHandle | undefined;
      let rejectAbort!: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new CredentialStoreFailure("READ_FAILED"));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
      });
      const cancel = () => controller.abort(); signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      const current = () => { if (disposed || abandoned || controller.signal.aborted) fail("READ_FAILED"); };
      const fence = async () => {
        current();
        if (await authorize(binding, controller.signal) !== true) fail("PERMISSION_DENIED");
        current();
        const actual = await resolve(scope);
        current();
        if (actual === null) fail("PERMISSION_DENIED");
        const parsed = observationBindingSchema.parse(actual);
        if (!sameObservationBinding(binding, parsed)) fail("IDENTITY_MISMATCH");
      };
      const work = async () => {
        let raw: ConnectorCredentialInput | undefined;
        let apiKey: string | undefined; let apiSecret: string | undefined;
        let transferred = false;
        try {
          await fence(); current();
          raw = await decrypt(context, binding.credentialId);
          // The existing store has no AbortSignal port. Do not inspect a late payload.
          current();
          const key = raw?.apiKey, secret = raw?.apiSecret;
          if (typeof key !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(key) ||
            typeof secret !== "string" || !secret.length || secret.length > 512) fail("READ_FAILED");
          apiKey = key; apiSecret = secret; raw = undefined;
          await fence(); current();
          let released = false;
          const dispose = () => {
            if (released) return; released = true; apiKey = undefined; apiSecret = undefined;
            handles.delete(handle);
          };
          // Secrets are deliberately non-enumerable: JSON/spread/log metadata cannot
          // accidentally copy them. Disposal drops owned references, not immutable-JS-string erasure.
          const handle = Object.freeze(Object.defineProperties({ binding, dispose }, {
            apiKey: { enumerable: false, get() { if (released || apiKey === undefined) fail("READ_FAILED"); return apiKey; } },
            apiSecret: { enumerable: false, get() { if (released || apiSecret === undefined) fail("READ_FAILED"); return apiSecret; } },
          })) as HtxObservationCredentialHandle;
          handles.add(handle); created = handle; transferred = true;
          return handle;
        } finally {
          raw = undefined;
          if (!transferred) { apiKey = undefined; apiSecret = undefined; }
          // Keep the slot occupied after timeout until an uncooperative store finishes.
          // A new invocation cannot multiply in-flight decryptions through this adapter.
          if (active === controller) active = null;
        }
      };
      try {
        return await Promise.race([work(), cancelled,
          clock.sleep(timeoutMs, timer.signal).then(() => fail("TIMEOUT"))]);
      } catch (error) {
        abandoned = true; controller.abort(); created?.dispose();
        if (error instanceof CredentialStoreFailure) throw error;
        return fail("READ_FAILED");
      } finally {
        signal.removeEventListener("abort", cancel); timer.abort();
        controller.signal.removeEventListener("abort", rejectAbort); controller.abort();
      }
    },
    dispose() {
      if (disposed) return; disposed = true; active?.abort();
      for (const handle of handles) handle.dispose();
    },
  });
}
