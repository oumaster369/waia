import "server-only";
import { createHash } from "node:crypto";
import { buildSignedQueryString, formatHtxTimestamp } from "@/lib/trader/connectors/htx/signing";
import { z } from "zod";
import { AccountObservationReadFailure } from "./service";
import { observationBindingSchema } from "./validation";
import type { ObservationBinding, ObservationClock } from "./types";
import type { HtxObservationGetTransport } from "./htx-reader";

const positiveId = z.string().regex(/^[1-9]\d{0,39}$/);
const size = z.string().regex(/^[1-9]\d{0,2}$/).refine(s => Number(s) <= 500);
const paging = { size, from: positiveId.optional(), direct: z.literal("next").optional() };
const openQuery = z.object({ "account-id": positiveId, ...paging }).strict();
const tradeQuery = z.object({ symbol: z.string().regex(/^[a-z0-9]{2,32}$/),
  "start-time": z.string().regex(/^\d{1,16}$/), "end-time": z.string().regex(/^\d{1,16}$/), ...paging }).strict();
type Request = Parameters<HtxObservationGetTransport["signedGet"]>[0];
const denied = (code: "READ_FAILED" | "INVALID_RESPONSE" | "PERMISSION_DENIED" | "TIMEOUT"): never => {
  throw new AccountObservationReadFailure(code);
};

/** Server-only, GET-only transport; neither credential lookup nor admission authority.
 * Caller must supply already authorized key material, a current exact-key admission check,
 * and an explicit network implementation. No default fetch/env/credential fallback exists.
 * Local tests use only synthetic keys and in-memory response streams.
 */
export function createHtxObservationGetTransport(input: Readonly<{
  binding: ObservationBinding;
  apiKey: string; apiSecret: string;
  host: "api.huobi.pro" | "api-aws.huobi.pro";
  symbols: readonly string[];
  timeoutMs: number;
  clock: ObservationClock;
  fetchImpl: typeof fetch;
  verifyReadAdmission(binding: ObservationBinding, apiKeySha256: string, signal: AbortSignal): Promise<boolean>;
}>): HtxObservationGetTransport {
  const binding = Object.freeze(observationBindingSchema.parse(input.binding));
  positiveId.parse(binding.exchangeAccountId);
  const host = z.enum(["api.huobi.pro", "api-aws.huobi.pro"]).parse(input.host);
  let apiKey = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).parse(input.apiKey);
  let secret = z.string().min(1).max(512).parse(input.apiSecret);
  const keyDigest = createHash("sha256").update(apiKey).digest("hex");
  const symbols = z.array(z.string().regex(/^[A-Z0-9]{2,32}$/)).min(1).max(32).parse(input.symbols);
  if (new Set(symbols).size !== symbols.length || !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 100 || input.timeoutMs > 120000 || typeof input.fetchImpl !== "function" ||
    typeof input.verifyReadAdmission !== "function") denied("INVALID_RESPONSE");
  const { clock, fetchImpl, verifyReadAdmission, timeoutMs } = input;
  let disposed = false; let active: AbortController | null = null;
  const cancelBody = (response: Response) => { void response.body?.cancel().catch(() => {}); };
  function validate(request: Request): { path: Request["path"]; query: Record<string, string>; maxBytes: number } {
    if (request.method !== "GET" || !Number.isSafeInteger(request.maxResponseBytes) ||
      request.maxResponseBytes < 1 || request.maxResponseBytes > 1048576) denied("INVALID_RESPONSE");
    const path = request.path;
    let query: Record<string, string>;
    if (path === `/v1/account/accounts/${binding.exchangeAccountId}/balance` || /^\/v1\/order\/orders\/[1-9]\d{0,39}$/.test(path)) {
      query = z.object({}).strict().parse(request.query);
    } else if (path === "/v1/order/openOrders") {
      query = openQuery.parse(request.query);
      if (query["account-id"] !== binding.exchangeAccountId) denied("PERMISSION_DENIED");
    } else if (path === "/v1/order/matchresults") {
      query = tradeQuery.parse(request.query);
      const start = Number(query["start-time"]), end = Number(query["end-time"]), now = clock.now();
      if (!symbols.includes(query.symbol.toUpperCase()) || !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) || start < 0 || end <= start || end - start > 172800000 || end > now)
        denied("PERMISSION_DENIED");
    } else return denied("PERMISSION_DENIED");
    if ((query.from === undefined) !== (query.direct === undefined)) denied("INVALID_RESPONSE");
    return { path, query, maxBytes: request.maxResponseBytes };
  }
  return Object.freeze({ binding,
    async signedGet(request) {
      const parentSignal = request.signal;
      if (disposed || active || parentSignal.aborted) return denied("READ_FAILED");
      const controller = new AbortController(); active = controller;
      const cancel = () => controller.abort(); parentSignal.addEventListener("abort", cancel, { once: true });
      let rejectAbort!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new AccountObservationReadFailure("READ_FAILED"));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
      });
      const current = async () => {
        if (disposed || controller.signal.aborted) denied("READ_FAILED");
        if (await verifyReadAdmission(binding, keyDigest, controller.signal) !== true) denied("PERMISSION_DENIED");
        if (disposed || controller.signal.aborted) denied("READ_FAILED");
      };
      let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const action = async () => {
        const { path, query, maxBytes } = validate(request);
        await current();
        const now = clock.now(); if (!Number.isSafeInteger(now) || now < 0) denied("INVALID_RESPONSE");
        const signed = buildSignedQueryString({ accessKeyId: apiKey, secret, host, path, params: query,
          timestamp: formatHtxTimestamp(new Date(now)) });
        const url = `https://${host}${path}?${signed}`;
        const response = await fetchImpl(url, { method: "GET", signal: controller.signal,
          redirect: "error", credentials: "omit", cache: "no-store", headers: { Accept: "application/json" } });
        if (disposed || controller.signal.aborted) { cancelBody(response); denied("READ_FAILED"); }
        if (response.redirected || response.url && response.url !== url || response.status < 200 || response.status >= 600 ||
          response.status >= 300 && response.status < 400) {
          cancelBody(response); denied("INVALID_RESPONSE");
        }
        // Errors need only the status; never parse/retain a body that may echo a key or signed URL.
        if (response.status !== 200) {
          cancelBody(response); await current();
          return Object.freeze({ binding, httpStatus: response.status, body: "" });
        }
        const length = response.headers.get("content-length");
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
          cancelBody(response); denied("INVALID_RESPONSE");
        }
        if (!response.body) return denied("INVALID_RESPONSE");
        bodyReader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0; let body = "";
        const decode = (value?: Uint8Array) => {
          try { return value ? decoder.decode(value, { stream: true }) : decoder.decode(); }
          catch { return denied("INVALID_RESPONSE"); }
        };
        while (true) {
          const chunk = await bodyReader.read();
          if (disposed || controller.signal.aborted) denied("READ_FAILED");
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array) || (bytes += chunk.value.byteLength) > maxBytes) denied("INVALID_RESPONSE");
          body += decode(chunk.value);
        }
        body += decode();
        await current();
        return Object.freeze({ binding, httpStatus: response.status, body });
      };
      try {
        return await Promise.race([action(), aborted, clock.sleep(timeoutMs, controller.signal).then(() => denied("TIMEOUT"))]);
      } catch (error) {
        // A failed/cancelled request may still own an uncooperative fetch; never reuse
        // this transport for overlapping work. The owner must dispose/re-admit anew.
        disposed = true; apiKey = ""; secret = "";
        if (error instanceof AccountObservationReadFailure) throw error;
        return denied("READ_FAILED");
      } finally {
        // Best-effort cancellation does not await an uncooperative network dependency.
        void bodyReader?.cancel().catch(() => {});
        parentSignal.removeEventListener("abort", cancel);
        controller.signal.removeEventListener("abort", rejectAbort); controller.abort();
        active = null;
      }
    },
    dispose() {
      disposed = true; active?.abort(); apiKey = ""; secret = "";
      // Drops owned references, not a promise of secure erasure of immutable JS strings.
    },
  });
}
