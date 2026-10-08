import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createHtxMetadataGetTransport } from "./htx-get-transport";
import type { HtxObservationCredentialHandle } from "./htx-reader-opener";
import { AccountObservationReadFailure } from "./service";
import { observationBindingSchema, sameObservationBinding } from "./validation";
import type { ObservationBinding, ObservationClock } from "./types";

/** Successful, fresh exact-key metadata evidence. This is data for observation identity checks,
 * never a durable authorization grant or a capability accepted by another API. */
export type HtxReadIdentityEvidence = Readonly<{
  binding: ObservationBinding;
  accessKeySha256: string;
  htxUid: string;
  permission: "readOnly" | "readOnly,trade";
  checkedAt: number;
}>;
export type HtxExpectedPermission = "readOnly" | "readOnly,trade";
export type HtxReadAdmission = Readonly<{
  dispose(): void;
  verifyReadAdmission(
    requested: ObservationBinding,
    requestedDigest: string,
    signal: AbortSignal,
  ): Promise<boolean>;
  verifyReadIdentity(
    requested: ObservationBinding,
    requestedDigest: string,
    signal: AbortSignal,
  ): Promise<HtxReadIdentityEvidence>;
  settled(): Promise<void>;
}>;

const positiveNumber = z.number().int().positive().safe();
const id = z.union([positiveNumber.transform(String), z.string().regex(/^[1-9]\d{0,39}$/)]);
const accountSchema = z
  .object({
    id,
    type: z.string().min(1).max(64),
    state: z.string().min(1).max(64),
    subtype: z.string().max(64).optional(),
  })
  .strict();
// Only documented metadata fields are accepted. Unrecognized permission flags must
// not contradict an apparently safe permission string without being examined.
const keySchema = z
  .object({
    accessKey: z.string().min(1).max(256),
    status: z.literal("normal"),
    permission: z.string().min(1).max(128),
    note: z.string().max(1024).optional(),
    ipAddresses: z.string().max(4096).optional(),
    validDays: z
      .number()
      .int()
      .refine((n) => n === -1 || n > 0)
      .optional(),
    createTime: positiveNumber.optional(),
    updateTime: positiveNumber.optional(),
  })
  .strict();
const denied = (): never => {
  throw new AccountObservationReadFailure("PERMISSION_DENIED");
};
const failed = (): never => {
  throw new AccountObservationReadFailure("READ_FAILED");
};

/** Fresh metadata on the same opened key; no receipt cache or external true callback.
 * Three bounded GETs per invocation: accounts + UID, then exact accessKey. The owner
 * keeps/disposes the original credential handle; this object owns only captured key
 * references and its metadata transport. JS strings are not securely zeroized.
 *
 * HTX contract: https://huobiapi.github.io/docs/spot/v1/en/#api-key-query
 * readOnly is required; known trade is tolerated ONLY as existing read admission.
 * Trade may carry transfer privileges: this grants no no-transfer or write proof.
 * Activation/rate qualification remains separate (no cache-based optimism).
 */
export function createHtxReadAdmission(
  input: Readonly<{
    credential: HtxObservationCredentialHandle;
    host: "api.huobi.pro" | "api-aws.huobi.pro";
    clock: ObservationClock;
    fetchImpl: typeof fetch;
    timeoutMs: number;
    maxResponseBytes: number;
    /** Derivatives observation requires a freshly observed exact read-only scope. */
    requireReadOnlyPermission?: boolean;
    /** Optional exact canonical venue permission required by this caller. */
    expectedPermission?: HtxExpectedPermission;
    authorizeCurrent(binding: ObservationBinding, signal: AbortSignal): Promise<boolean>;
  }>,
): HtxReadAdmission {
  const fixed = (() => {
    try {
      const { credential, host, clock, fetchImpl, timeoutMs, maxResponseBytes, authorizeCurrent } =
        input;
      if (
        input.requireReadOnlyPermission !== undefined &&
        typeof input.requireReadOnlyPermission !== "boolean"
      )
        denied();
      const requireReadOnlyPermission = input.requireReadOnlyPermission === true;
      const expectedPermission = input.expectedPermission;
      if (expectedPermission !== undefined &&
          expectedPermission !== "readOnly" && expectedPermission !== "readOnly,trade") denied();
      if (requireReadOnlyPermission && expectedPermission === "readOnly,trade") denied();
      const binding = Object.freeze(observationBindingSchema.parse(credential.binding));
      const apiKey = z
        .string()
        .min(1)
        .max(256)
        .regex(/^[A-Za-z0-9_-]+$/)
        .parse(credential.apiKey);
      const apiSecret = z.string().min(1).max(512).parse(credential.apiSecret);
      if (
        !Number.isSafeInteger(maxResponseBytes) ||
        maxResponseBytes < 1 ||
        maxResponseBytes > 1048576 ||
        typeof clock?.now !== "function" ||
        typeof clock?.sleep !== "function"
      )
        denied();
      // Pair the independent account/UID metadata reads on separate transports. Their
      // DB admission checks still share one serialized lane, so no extra DB session or
      // concurrent authorization transaction is introduced.
      let authorizationLane = Promise.resolve();
      let authorizationRefused = false;
      const authorizeSerially = (currentBinding: ObservationBinding, signal: AbortSignal) => {
        const result = authorizationLane.then(() => {
          if (signal.aborted) throw new AccountObservationReadFailure("READ_FAILED");
          if (authorizationRefused) throw new AccountObservationReadFailure("PERMISSION_DENIED");
          return authorizeCurrent(currentBinding, signal).then(allowed => {
            if (allowed !== true) authorizationRefused = true;
            return allowed;
          }, error => {
            authorizationRefused = true;
            throw error;
          });
        });
        authorizationLane = result.then(() => undefined, () => undefined);
        return result;
      };
      const createTransport = () => createHtxMetadataGetTransport({ binding, apiKey, apiSecret, host, clock,
        fetchImpl, timeoutMs, authorizeCurrent: authorizeSerially });
      const accountTransport = createTransport();
      const uidTransport = createTransport();
      return {
        binding,
        apiKey,
        keyDigest: createHash("sha256").update(apiKey).digest("hex"),
        accountTransport,
        uidTransport,
        clock,
        timeoutMs,
        maxResponseBytes,
        requireReadOnlyPermission,
        expectedPermission,
      };
    } catch {
      return denied();
    }
  })();
  const {
    binding,
    keyDigest,
    accountTransport,
    uidTransport,
    clock,
    timeoutMs,
    maxResponseBytes,
    requireReadOnlyPermission,
    expectedPermission,
  } = fixed;
  let apiKey = fixed.apiKey;
  fixed.apiKey = "";
  let disposed = false;
  let active: AbortController | null = null;
  let lastCheckedAt = -1;
  const pending = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending.add(promise);
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  };
  const dispose = () => {
    disposed = true;
    active?.abort();
    accountTransport.dispose();
    uidTransport.dispose();
    apiKey = "";
  };
  async function verifyReadIdentity(
    requested: ObservationBinding,
    requestedDigest: string,
    signal: AbortSignal,
  ): Promise<HtxReadIdentityEvidence> {
    if (disposed || active || signal.aborted) return failed();
    const controller = new AbortController();
    active = controller;
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    let rejectAbort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new AccountObservationReadFailure("READ_FAILED"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const current = () => {
      if (disposed || controller.signal.aborted) failed();
    };
    const read = async (
      transport: typeof accountTransport | typeof uidTransport,
      path: "/v1/account/accounts" | "/v2/user/uid" | "/v2/user/api-key",
      query: Record<string, string>,
    ) => {
      const result = await transport.signedGet({
        method: "GET",
        path,
        query,
        signal: controller.signal,
        maxResponseBytes,
      });
      current();
      if (result.httpStatus === 429) throw new AccountObservationReadFailure("RATE_LIMITED");
      if (result.httpStatus !== 200) denied();
      return JSON.parse(result.body) as unknown;
    };
    const work = async (): Promise<HtxReadIdentityEvidence> => {
      if (
        !sameObservationBinding(observationBindingSchema.parse(requested), binding) ||
        requestedDigest !== keyDigest
      )
        denied();
      const accountRequest = read(accountTransport, "/v1/account/accounts", {}).then(value => {
        const accounts = z.object({ status: z.literal("ok"), data: z.array(accountSchema).max(100) })
          .strict().parse(value);
        const working = accounts.data.filter(account => account.type === "spot" && account.state === "working");
        if (working.length !== 1 || String(working[0]!.id) !== binding.exchangeAccountId) denied();
        return accounts;
      });
      const uidRequest = read(uidTransport, "/v2/user/uid", {}).then(value =>
        z.object({ code: z.literal(200), data: positiveNumber, message: z.string().max(1024).optional(),
          ok: z.literal(true).optional() }).strict().parse(value));
      const [, uid] = await Promise.all([accountRequest, uidRequest]);
      current();
      const response = z
        .object({
          code: z.literal(200),
          data: z.array(z.unknown()).max(100),
          message: z.string().max(1024).optional(),
          ok: z.literal(true).optional(),
        })
        .strict()
        .parse(await read(accountTransport, "/v2/user/api-key", { uid: String(uid.data), accessKey: apiKey }));
      // Validate identity on every row before selecting; never default to data[0].
      const rows = response.data.map((row) =>
        z
          .object({ accessKey: z.string().min(1).max(256) })
          .passthrough()
          .parse(row),
      );
      const matching = rows.filter((row) => row.accessKey === apiKey);
      if (matching.length !== 1) denied();
      const key = keySchema.parse(matching[0]);
      const permissions = key.permission.split(",").map((token) => token.trim().toLowerCase());
      const canonicalPermission = permissions.includes("trade") ? "readOnly,trade" : "readOnly";
      if (
        !permissions.includes("readonly") ||
        new Set(permissions).size !== permissions.length ||
        permissions.some((permission) => permission !== "readonly" && permission !== "trade") ||
        (requireReadOnlyPermission && (permissions.length !== 1 || permissions[0] !== "readonly")) ||
        (expectedPermission !== undefined && canonicalPermission !== expectedPermission)
      )
        denied();
      current();
      const checkedAt = clock.now();
      if (!Number.isSafeInteger(checkedAt) || checkedAt < 0 || checkedAt < lastCheckedAt)
        throw new AccountObservationReadFailure("INVALID_RESPONSE");
      lastCheckedAt = checkedAt;
      return Object.freeze({
        binding,
        accessKeySha256: keyDigest,
        htxUid: String(uid.data),
        permission: permissions.includes("trade")
          ? ("readOnly,trade" as const)
          : ("readOnly" as const),
        checkedAt,
      });
    };
    try {
      return await Promise.race([
        track(work()),
        cancelled,
        clock.sleep(timeoutMs, controller.signal).then(() => {
          throw new AccountObservationReadFailure("TIMEOUT");
        }),
      ]);
    } catch (error) {
      dispose();
      let code: AccountObservationReadFailure["code"] = "PERMISSION_DENIED";
      try {
        if (
          error instanceof AccountObservationReadFailure &&
          [
            "TIMEOUT",
            "RATE_LIMITED",
            "PERMISSION_DENIED",
            "READ_FAILED",
            "INVALID_RESPONSE",
          ].includes(error.code)
        )
          code = error.code;
      } catch {
        /* Even hostile dependency error getters must not escape. */
      }
      throw new AccountObservationReadFailure(code);
    } finally {
      signal.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", rejectAbort);
      controller.abort();
      active = null;
    }
  }
  const owner = {
    dispose,
    async settled() {
      dispose();
      while (pending.size) await Promise.allSettled([...pending]);
      const transportsSettled = await Promise.allSettled([accountTransport.settled(), uidTransport.settled()]);
      const failedTransport = transportsSettled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failedTransport) throw failedTransport.reason;
    },
    async verifyReadAdmission(
      requested: ObservationBinding,
      requestedDigest: string,
      signal: AbortSignal,
    ): Promise<boolean> {
      await verifyReadIdentity(requested, requestedDigest, signal);
      return true;
    },
  };
  // Preserve the existing enumerable public admission surface; lifecycle completion is additive.
  Object.defineProperty(owner, "verifyReadIdentity", {
    enumerable: false,
    value: verifyReadIdentity,
  });
  Object.defineProperty(owner, "settled", { enumerable: false });
  return Object.freeze(owner) as HtxReadAdmission;
}
