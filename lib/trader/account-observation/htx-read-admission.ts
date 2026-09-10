import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createHtxMetadataGetTransport } from "./htx-get-transport";
import type { HtxObservationCredentialHandle } from "./htx-reader-opener";
import { AccountObservationReadFailure } from "./service";
import { observationBindingSchema, sameObservationBinding } from "./validation";
import type { ObservationBinding, ObservationClock } from "./types";

const positiveNumber = z.number().int().positive().safe();
const id = z.union([positiveNumber.transform(String), z.string().regex(/^[1-9]\d{0,39}$/)]);
const accountSchema = z.object({ id, type: z.string().min(1).max(64), state: z.string().min(1).max(64),
  subtype: z.string().max(64).optional() }).strict();
// Only documented metadata fields are accepted. Unrecognized permission flags must
// not contradict an apparently safe permission string without being examined.
const keySchema = z.object({ accessKey: z.string().min(1).max(256), status: z.literal("normal"),
  permission: z.string().min(1).max(128), note: z.string().max(1024).optional(),
  ipAddresses: z.string().max(4096).optional(), validDays: z.number().int().refine(n => n === -1 || n > 0).optional(),
  createTime: positiveNumber.optional(), updateTime: positiveNumber.optional() }).strict();
const denied = (): never => { throw new AccountObservationReadFailure("PERMISSION_DENIED"); };
const failed = (): never => { throw new AccountObservationReadFailure("READ_FAILED"); };

/** Fresh metadata on the same opened key; no receipt cache or external true callback.
 * Three bounded GETs per invocation: accounts -> UID -> exact accessKey. The owner
 * keeps/disposes the original credential handle; this object owns only captured key
 * references and its metadata transport. JS strings are not securely zeroized.
 *
 * HTX contract: https://huobiapi.github.io/docs/spot/v1/en/#api-key-query
 * readOnly is required; known trade is tolerated ONLY as existing read admission.
 * Trade may carry transfer privileges: this grants no no-transfer or write proof.
 * Activation/rate qualification remains separate (no cache-based optimism).
 */
export function createHtxReadAdmission(input: Readonly<{
  credential: HtxObservationCredentialHandle;
  host: "api.huobi.pro" | "api-aws.huobi.pro";
  clock: ObservationClock; fetchImpl: typeof fetch; timeoutMs: number; maxResponseBytes: number;
  authorizeCurrent(binding: ObservationBinding, signal: AbortSignal): Promise<boolean>;
}>) {
  const fixed = (() => {
    try {
      const { credential, host, clock, fetchImpl, timeoutMs, maxResponseBytes, authorizeCurrent } = input;
      const binding = Object.freeze(observationBindingSchema.parse(credential.binding));
      const apiKey = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).parse(credential.apiKey);
      const apiSecret = z.string().min(1).max(512).parse(credential.apiSecret);
      if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 1048576 ||
        typeof clock?.now !== "function" || typeof clock?.sleep !== "function") denied();
      const transport = createHtxMetadataGetTransport({ binding, apiKey, apiSecret, host, clock,
        fetchImpl, timeoutMs, authorizeCurrent });
      return { binding, apiKey, keyDigest: createHash("sha256").update(apiKey).digest("hex"),
        transport, clock, timeoutMs, maxResponseBytes };
    } catch { return denied(); }
  })();
  const { binding, keyDigest, transport, clock, timeoutMs, maxResponseBytes } = fixed;
  let apiKey = fixed.apiKey; fixed.apiKey = "";
  let disposed = false; let active: AbortController | null = null;
  const dispose = () => { disposed = true; active?.abort(); transport.dispose(); apiKey = ""; };
  return Object.freeze({ dispose,
    async verifyReadAdmission(requested: ObservationBinding, requestedDigest: string, signal: AbortSignal): Promise<boolean> {
      if (disposed || active || signal.aborted) return failed();
      const controller = new AbortController(); active = controller;
      const cancel = () => controller.abort(); signal.addEventListener("abort", cancel, { once: true });
      let rejectAbort!: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new AccountObservationReadFailure("READ_FAILED"));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
      });
      const current = () => { if (disposed || controller.signal.aborted) failed(); };
      const read = async (path: "/v1/account/accounts" | "/v2/user/uid" | "/v2/user/api-key", query: Record<string, string>) => {
        const result = await transport.signedGet({ method: "GET", path, query, signal: controller.signal, maxResponseBytes });
        current();
        if (result.httpStatus === 429) throw new AccountObservationReadFailure("RATE_LIMITED");
        if (result.httpStatus !== 200) denied();
        return JSON.parse(result.body) as unknown;
      };
      const work = async () => {
        if (!sameObservationBinding(observationBindingSchema.parse(requested), binding) || requestedDigest !== keyDigest) denied();
        const accounts = z.object({ status: z.literal("ok"), data: z.array(accountSchema).max(100) }).strict()
          .parse(await read("/v1/account/accounts", {}));
        const working = accounts.data.filter(account => account.type === "spot" && account.state === "working");
        if (working.length !== 1 || working[0].id !== binding.exchangeAccountId) denied();
        const uid = z.object({ code: z.literal(200), data: positiveNumber, message: z.string().max(1024).optional(),
          ok: z.literal(true).optional() }).strict()
          .parse(await read("/v2/user/uid", {}));
        const response = z.object({ code: z.literal(200), data: z.array(z.unknown()).max(100), message: z.string().max(1024).optional(),
          ok: z.literal(true).optional() }).strict()
          .parse(await read("/v2/user/api-key", { uid: String(uid.data), accessKey: apiKey }));
        // Validate identity on every row before selecting; never default to data[0].
        const rows = response.data.map(row => z.object({ accessKey: z.string().min(1).max(256) }).passthrough().parse(row));
        const matching = rows.filter(row => row.accessKey === apiKey);
        if (matching.length !== 1) denied();
        const key = keySchema.parse(matching[0]);
        const permissions = key.permission.split(",").map(token => token.trim().toLowerCase());
        if (!permissions.includes("readonly") || new Set(permissions).size !== permissions.length ||
          permissions.some(permission => permission !== "readonly" && permission !== "trade")) denied();
        current(); return true;
      };
      try {
        return await Promise.race([work(), cancelled,
          clock.sleep(timeoutMs, controller.signal).then(() => { throw new AccountObservationReadFailure("TIMEOUT"); })]);
      } catch (error) {
        dispose();
        let code: AccountObservationReadFailure["code"] = "PERMISSION_DENIED";
        try {
          if (error instanceof AccountObservationReadFailure && ["TIMEOUT", "RATE_LIMITED", "PERMISSION_DENIED", "READ_FAILED", "INVALID_RESPONSE"].includes(error.code))
            code = error.code;
        } catch { /* Even hostile dependency error getters must not escape. */ }
        throw new AccountObservationReadFailure(code);
      } finally {
        signal.removeEventListener("abort", cancel); controller.signal.removeEventListener("abort", rejectAbort);
        controller.abort(); active = null;
      }
    },
  });
}
