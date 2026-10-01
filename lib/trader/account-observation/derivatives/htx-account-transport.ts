import "server-only";
import { createHash } from "node:crypto";
import { buildSignedPostQueryString, formatHtxTimestamp } from "@/lib/trader/connectors/htx/signing";
import { AccountObservationReadFailure } from "../service";
import type { ObservationClock } from "../types";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES, type HtxDerivativesAccountFamily,
  type HtxDerivativesObservationBinding, type HtxDerivativesReadAdmissionRequest } from "./types";

const endpoints: Readonly<Record<HtxDerivativesAccountFamily, Readonly<{ path: string; body: Readonly<Record<string, string>> }>>> = Object.freeze({
  usdt_isolated_perpetual: { path: "/linear-swap-api/v1/swap_account_info", body: Object.freeze({}) },
  usdt_cross_shared: { path: "/linear-swap-api/v1/swap_cross_account_info", body: Object.freeze({ margin_account: "USDT" }) },
  coin_perpetual: { path: "/swap-api/v1/swap_account_info", body: Object.freeze({}) },
  coin_delivery_futures: { path: "/api/v1/contract_account_info", body: Object.freeze({}) },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: "READ_FAILED" | "INVALID_RESPONSE" | "PERMISSION_DENIED" | "TIMEOUT" | "RATE_LIMITED"): never => {
  throw new AccountObservationReadFailure(code);
};

export type HtxDerivativesAccountTransport = Readonly<{
  binding: HtxDerivativesObservationBinding;
  readAccount(family: HtxDerivativesAccountFamily, signal: AbortSignal): Promise<string>;
  dispose(): void;
  settled(): Promise<void>;
}>;

/** Only four fixed private account-info POSTs are expressible. No generic path/body,
 * credentials lookup, env fallback, futures order capability, or default fetch. */
export function createHtxDerivativesAccountTransport(input: Readonly<{
  binding: HtxDerivativesObservationBinding;
  accessKey: string;
  secret: string;
  host: "api.hbdm.com";
  timeoutMs: number;
  maxResponseBytes: number;
  clock: ObservationClock;
  fetchImpl: typeof fetch;
  verifyReadAdmission(request: HtxDerivativesReadAdmissionRequest, signal: AbortSignal): Promise<boolean>;
}>): HtxDerivativesAccountTransport {
  if (!uuid.test(input.binding.organizationId) || !uuid.test(input.binding.credentialId) ||
    !/^[1-9]\d{0,18}$/.test(input.binding.credentialRevision) ||
    input.host !== "api.hbdm.com" ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(input.accessKey) || typeof input.secret !== "string" ||
    input.secret.length < 1 || input.secret.length > 512 ||
    !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 120_000 ||
    !Number.isSafeInteger(input.maxResponseBytes) || input.maxResponseBytes < 1 || input.maxResponseBytes > 1_048_576 ||
    typeof input.fetchImpl !== "function" || typeof input.verifyReadAdmission !== "function") fail("INVALID_RESPONSE");

  const binding = Object.freeze({ ...input.binding });
  const host = input.host;
  // Capture capability references at construction so a caller cannot replace the
  // verifier or network/clock functions between the two admission checks.
  const verifyReadAdmission = input.verifyReadAdmission;
  const fetchImpl = input.fetchImpl;
  const clockNow = input.clock.now.bind(input.clock);
  const clockSleep = input.clock.sleep.bind(input.clock);
  const timeoutMs = input.timeoutMs;
  const maxResponseBytes = input.maxResponseBytes;
  let accessKey = input.accessKey;
  let secret = input.secret;
  const keyDigest = createHash("sha256").update(accessKey).digest("hex");
  const pending = new Set<Promise<unknown>>();
  let disposed = false;
  let active: AbortController | null = null;
  let cancellationFailed = false;
  const track = <T>(promise: Promise<T>) => {
    pending.add(promise);
    void promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  const cancelQuietly = (promise: Promise<unknown> | undefined) => {
    if (promise) void track(promise).catch(() => { cancellationFailed = true; });
  };
  const dispose = () => { disposed = true; active?.abort(); accessKey = ""; secret = ""; };

  async function readAccount(family: HtxDerivativesAccountFamily, signal: AbortSignal): Promise<string> {
    if (!HTX_DERIVATIVES_ACCOUNT_FAMILIES.includes(family) || disposed || active || signal.aborted) return fail("PERMISSION_DENIED");
    const { path, body } = endpoints[family];
    const admissionRequest: HtxDerivativesReadAdmissionRequest = Object.freeze({ binding, family, accessKeySha256: keyDigest });
    const controller = new AbortController(); active = controller;
    const cancel = () => controller.abort(); signal.addEventListener("abort", cancel, { once: true });
    let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let response: Response | undefined;
    const isCurrent = async () => {
      if (disposed || controller.signal.aborted) fail("READ_FAILED");
      if (await verifyReadAdmission(admissionRequest, controller.signal) !== true) fail("PERMISSION_DENIED");
      if (disposed || controller.signal.aborted) fail("READ_FAILED");
    };
    const work = async (): Promise<string> => {
      await isCurrent();
      const now = clockNow();
      if (!Number.isSafeInteger(now) || now < 0) fail("INVALID_RESPONSE");
      const auth = buildSignedPostQueryString({ accessKeyId: accessKey, secret, host, path,
        timestamp: formatHtxTimestamp(new Date(now)) });
      const url = `https://${host}${path}?${auth}`;
      response = await fetchImpl(url, { method: "POST", signal: controller.signal,
        redirect: "error", credentials: "omit", cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body) });
      if (disposed || controller.signal.aborted) { cancelQuietly(response.body?.cancel()); fail("READ_FAILED"); }
      if (response.redirected || (response.url && response.url !== url) || response.status !== 200) {
        cancelQuietly(response.body?.cancel());
        if (response.status === 429) fail("RATE_LIMITED");
        if (response.status === 401 || response.status === 403) fail("PERMISSION_DENIED");
        fail("READ_FAILED");
      }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)) {
        cancelQuietly(response.body?.cancel()); fail("INVALID_RESPONSE");
      }
      const responseBody = response.body;
      if (!responseBody) fail("INVALID_RESPONSE");
      bodyReader = responseBody!.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let byteCount = 0; let text = "";
      while (true) {
        const chunk = await bodyReader.read();
        if (disposed || controller.signal.aborted) fail("READ_FAILED");
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array) || (byteCount += chunk.value.byteLength) > maxResponseBytes) fail("INVALID_RESPONSE");
        try { text += decoder.decode(chunk.value, { stream: true }); } catch { fail("INVALID_RESPONSE"); }
      }
      try { text += decoder.decode(); } catch { fail("INVALID_RESPONSE"); }
      if (text.includes(accessKey) || text.includes(secret)) fail("INVALID_RESPONSE");
      await isCurrent();
      return text;
    };
    const timeout = clockSleep(timeoutMs, controller.signal).then(() => fail("TIMEOUT"));
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new AccountObservationReadFailure("READ_FAILED")), { once: true });
    });
    try {
      return await Promise.race([track(work()), timeout, aborted]);
    } catch (error) {
      dispose();
      if (error instanceof AccountObservationReadFailure) throw error;
      return fail("READ_FAILED");
    } finally {
      cancelQuietly(bodyReader?.cancel());
      if (!bodyReader && response?.body) cancelQuietly(response.body.cancel());
      signal.removeEventListener("abort", cancel);
      controller.abort(); active = null;
    }
  }

  return Object.freeze({ binding, readAccount, dispose, async settled() {
    dispose();
    while (pending.size) await Promise.allSettled([...pending]);
    if (cancellationFailed) fail("READ_FAILED");
  } });
}
