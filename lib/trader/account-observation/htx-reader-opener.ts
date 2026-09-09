import "server-only";
import { createHash } from "node:crypto";
import { createHtxAccountObservationReader, type HtxObservationReaderOptions } from "./htx-reader";
import { createHtxObservationGetTransport } from "./htx-get-transport";
import { AccountObservationReadFailure } from "./service";
import { observationBindingSchema, sameObservationBinding } from "./validation";
import type { AccountObservationReader, ObservationBinding, ObservationClock } from "./types";

/** Owned by a separately authorized credential adapter. No payload is returned to
 * callers of openHtxObservationReader or persisted in an observation. */
export type HtxObservationCredentialHandle = Readonly<{
  binding: ObservationBinding; apiKey: string; apiSecret: string;
  dispose(): void;
}>;
type TransportInput = Parameters<typeof createHtxObservationGetTransport>[0];
type Dependencies = Readonly<{
  clock: ObservationClock; fetchImpl: typeof fetch; host: TransportInput["host"];
  authorizeOpen(binding: ObservationBinding, signal: AbortSignal): Promise<boolean>;
  openCredential(binding: ObservationBinding, signal: AbortSignal): Promise<HtxObservationCredentialHandle>;
  verifyReadAdmission: TransportInput["verifyReadAdmission"];
}>;
const fail = (code: "READ_FAILED" | "TIMEOUT" | "PERMISSION_DENIED" | "IDENTITY_MISMATCH"): never => {
  throw new AccountObservationReadFailure(code);
};

/** Connects the runtime reader port to the bounded GET transport. Explicitly
 * injected authorization and credential adapters remain deployment obligations;
 * this composition does not manufacture a Human grant or access any key store.
 * The signal bounds OPEN only, matching the runtime port (which aborts its open
 * timer after success). Returned reads have their own signals; owner must dispose. */
export async function openHtxObservationReader(
  deps: Dependencies, options: HtxObservationReaderOptions, signal: AbortSignal,
): Promise<AccountObservationReader> {
  const binding = Object.freeze(observationBindingSchema.parse(options.binding));
  const timeoutMs = options.readTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000 || signal.aborted)
    fail("READ_FAILED");
  // Capture caller configuration before the first asynchronous boundary.
  const fixedOptions = { ...options, binding, symbols: Object.freeze([...options.symbols]) };
  const { clock, host, fetchImpl, authorizeOpen, openCredential, verifyReadAdmission } = deps;
  const controller = new AbortController();
  const timer = new AbortController();
  let abandoned = false; let released = false;
  let handle: HtxObservationCredentialHandle | undefined;
  let reader: AccountObservationReader | undefined;
  let transport: ReturnType<typeof createHtxObservationGetTransport> | undefined;
  let rejectAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new AccountObservationReadFailure("READ_FAILED"));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const dispose = () => {
    abandoned = true; signal.removeEventListener("abort", cancel);
    controller.abort(); reader?.dispose(); transport?.dispose();
    if (handle && !released) {
      released = true;
      try { handle.dispose(); } catch { fail("READ_FAILED"); }
      finally { handle = undefined; }
    }
  };
  const cancel = () => { try { dispose(); } catch { /* Abort listener must not leak adapter errors. */ } };
  signal.addEventListener("abort", cancel, { once: true });
  const current = () => { if (abandoned || controller.signal.aborted) fail("READ_FAILED"); };
  const work = async () => {
    current();
    if (await authorizeOpen(binding, controller.signal) !== true) fail("PERMISSION_DENIED");
    current();
    handle = await openCredential(binding, controller.signal);
    // A credential arriving after timeout must still be released, never signed.
    if (abandoned || controller.signal.aborted) { dispose(); fail("READ_FAILED"); }
    const actual = observationBindingSchema.parse(handle.binding);
    if (!sameObservationBinding(binding, actual)) fail("IDENTITY_MISMATCH");
    const apiKey = handle.apiKey, apiSecret = handle.apiSecret;
    if (typeof apiKey !== "string" || typeof apiSecret !== "string") fail("READ_FAILED");
    const digest = createHash("sha256").update(apiKey).digest("hex");
    if (await verifyReadAdmission(binding, digest, controller.signal) !== true) fail("PERMISSION_DENIED");
    current();
    transport = createHtxObservationGetTransport({ binding, apiKey, apiSecret, host,
      symbols: fixedOptions.symbols, timeoutMs, clock, fetchImpl, verifyReadAdmission });
    reader = createHtxAccountObservationReader({ transport, clock }, fixedOptions);
    return Object.freeze({ readBalances: reader.readBalances, readOpenOrders: reader.readOpenOrders,
      readTrades: reader.readTrades, dispose });
  };
  try {
    return await Promise.race([work(), cancelled, clock.sleep(timeoutMs, timer.signal).then(() => fail("TIMEOUT"))]);
  } catch (error) {
    try { dispose(); } catch { /* Preserve the primary classified failure. */ }
    if (error instanceof AccountObservationReadFailure) throw error;
    return fail("READ_FAILED");
  } finally {
    signal.removeEventListener("abort", cancel);
    timer.abort(); controller.signal.removeEventListener("abort", rejectAbort);
  }
}
