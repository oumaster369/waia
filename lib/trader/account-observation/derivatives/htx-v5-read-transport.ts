import "server-only";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { buildSignedQueryString, formatHtxTimestamp } from "@/lib/trader/connectors/htx/signing";
import { AccountObservationReadFailure } from "../service";
import { createHtxReadAdmission, type HtxReadIdentityEvidence } from "../htx-read-admission";
import type { HtxObservationCredentialHandle } from "../htx-reader-opener";
import type { ObservationBinding, ObservationClock } from "../types";
import { observationBindingSchema, sameObservationBinding } from "../validation";
import {
  buildHtxV5AlgoOrdersRequest,
  buildHtxV5AssetModeRequest,
  buildHtxV5BalanceRequest,
  buildHtxV5FillsRequest,
  buildHtxV5OpenOrdersRequest,
  buildHtxV5PositionsRequest,
  type HtxV5ReadRequest,
} from "./htx-v5-read-contract";

const V5_HOST = "api.hbdm.com" as const;
const METADATA_HOST = "api.huobi.pro" as const;
const fail = (
  code:
    | "TIMEOUT"
    | "RATE_LIMITED"
    | "PERMISSION_DENIED"
    | "READ_FAILED"
    | "INVALID_RESPONSE"
    | "IDENTITY_MISMATCH",
): never => {
  throw new AccountObservationReadFailure(code);
};

export type HtxV5ReadResponse = Readonly<{
  /** Bounded UTF-8 JSON text for the strict route parser; never contains the opened key or secret. */
  body: string;
  /** Current account/key identity evidence, freshly rechecked after this response. */
  identity: HtxReadIdentityEvidence;
  receivedAt: number;
}>;

export type HtxV5ReadTransport = Readonly<{
  readAssetMode(signal: AbortSignal): Promise<HtxV5ReadResponse>;
  readBalance(signal: AbortSignal): Promise<HtxV5ReadResponse>;
  readPositions(
    options: Parameters<typeof buildHtxV5PositionsRequest>[0],
    signal: AbortSignal,
  ): Promise<HtxV5ReadResponse>;
  readOpenOrders(
    options: Parameters<typeof buildHtxV5OpenOrdersRequest>[0],
    signal: AbortSignal,
  ): Promise<HtxV5ReadResponse>;
  readAlgoOrders(
    options: Parameters<typeof buildHtxV5AlgoOrdersRequest>[0],
    signal: AbortSignal,
  ): Promise<HtxV5ReadResponse>;
  readFills(
    options: Parameters<typeof buildHtxV5FillsRequest>[0],
    signal: AbortSignal,
  ): Promise<HtxV5ReadResponse>;
  dispose(): void;
  settled(): Promise<void>;
}>;

type TransportInput = Readonly<{
  credential: HtxObservationCredentialHandle;
  clock: ObservationClock;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
  expectedHtxUid?: string;
  /** Database/revision currentness only. Venue identity comes from the private admission owner. */
  authorizeCurrent(binding: ObservationBinding, signal: AbortSignal): Promise<boolean>;
}>;

function snapshotConfig(value: unknown): Record<string, unknown> {
  const keys = [
    "credential",
    "clock",
    "fetchImpl",
    "timeoutMs",
    "maxResponseBytes",
    "expectedHtxUid",
    "authorizeCurrent",
  ];
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value))
    fail("INVALID_RESPONSE");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_RESPONSE");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = typeof key === "string" ? descriptors[key] : undefined;
    if (
      !descriptor ||
      !keys.includes(key as string) ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      return fail("INVALID_RESPONSE");
    result[key as string] = descriptor.value;
  }
  return result;
}

function safeReadError(error: unknown): AccountObservationReadFailure {
  try {
    if (error instanceof AccountObservationReadFailure) {
      const code = error.code;
      if (
        [
          "TIMEOUT",
          "RATE_LIMITED",
          "PERMISSION_DENIED",
          "READ_FAILED",
          "INVALID_RESPONSE",
          "IDENTITY_MISMATCH",
        ].includes(code)
      )
        return new AccountObservationReadFailure(code);
    }
  } catch {
    /* Never expose a hostile dependency error. */
  }
  return new AccountObservationReadFailure("READ_FAILED");
}

function hasCredentialEcho(body: string, accessKey: string, secret: string): boolean {
  if (body.includes(accessKey) || body.includes(secret)) return true;
  const escapedKey = JSON.stringify(accessKey).slice(1, -1);
  const escapedSecret = JSON.stringify(secret).slice(1, -1);
  if (body.includes(escapedKey) || body.includes(escapedSecret)) return true;
  // Also inspect decoded JSON strings so unicode-escaped credentials cannot evade the raw scan.
  for (const match of body.matchAll(/"(?:\\.|[^"\\])*"/g)) {
    try {
      const value: unknown = JSON.parse(match[0]);
      if (typeof value === "string" && (value.includes(accessKey) || value.includes(secret)))
        return true;
    } catch {
      /* A malformed token is left to the strict response parser. */
    }
  }
  return false;
}

/** Fixed signed V5 GET reads composed with a private fresh-read-only admission owner.
 * The factory owns and disposes its admission copy, never the shared credential handle. */
export function createHtxV5ReadTransport(input: TransportInput): HtxV5ReadTransport {
  const config = snapshotConfig(input);
  const credential = config.credential as HtxObservationCredentialHandle;
  const clockInput = config.clock as ObservationClock;
  const fetchImpl = config.fetchImpl as typeof fetch;
  const timeoutMs = config.timeoutMs as number;
  const maxResponseBytes = config.maxResponseBytes as number;
  const authorizeCurrent = config.authorizeCurrent as TransportInput["authorizeCurrent"];
  let expectedHtxUid: string | undefined;
  if (config.expectedHtxUid !== undefined) {
    if (typeof config.expectedHtxUid !== "string" || !/^[1-9]\d{0,38}$/.test(config.expectedHtxUid))
      return fail("INVALID_RESPONSE");
    expectedHtxUid = config.expectedHtxUid;
  }
  if (
    !credential ||
    typeof credential !== "object" ||
    typeof fetchImpl !== "function" ||
    typeof authorizeCurrent !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 120_000 ||
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 1_048_576 ||
    typeof clockInput?.now !== "function" ||
    typeof clockInput?.sleep !== "function"
  )
    fail("INVALID_RESPONSE");

  let binding: ObservationBinding;
  let accessKey: string;
  let secret: string;
  let fingerprint: string;
  let accessKeySha256: string;
  try {
    binding = Object.freeze(observationBindingSchema.parse(credential.binding));
    accessKey = credential.apiKey;
    secret = credential.apiSecret;
    if (
      typeof accessKey !== "string" ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(accessKey) ||
      typeof secret !== "string" ||
      secret.length < 1 ||
      secret.length > 512
    )
      fail("INVALID_RESPONSE");
    fingerprint = createHash("sha256")
      .update(JSON.stringify([accessKey, secret]))
      .digest("hex");
    accessKeySha256 = createHash("sha256").update(accessKey).digest("hex");
  } catch (error) {
    throw safeReadError(error);
  }
  const clock = Object.freeze({
    now: clockInput.now.bind(clockInput),
    sleep: clockInput.sleep.bind(clockInput),
  });
  const admission = createHtxReadAdmission({
    credential,
    host: METADATA_HOST,
    clock,
    fetchImpl,
    timeoutMs,
    maxResponseBytes,
    requireReadOnlyPermission: true,
    authorizeCurrent,
  });

  const pending = new Set<Promise<unknown>>();
  let disposed = false;
  let active: AbortController | null = null;
  let cancellationFailed = false;
  let lastCheckedAt = -1;
  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending.add(promise);
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  };
  const cancelQuietly = (promise: Promise<unknown> | undefined) => {
    if (promise)
      void track(promise).catch(() => {
        cancellationFailed = true;
      });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    active?.abort();
    admission.dispose();
    accessKey = "";
    secret = "";
  };
  function assertCurrent(): void {
    if (disposed) fail("READ_FAILED");
    try {
      const currentBinding = observationBindingSchema.parse(credential.binding);
      const currentKey = credential.apiKey;
      const currentSecret = credential.apiSecret;
      if (
        !sameObservationBinding(currentBinding, binding) ||
        typeof currentKey !== "string" ||
        typeof currentSecret !== "string" ||
        createHash("sha256")
          .update(JSON.stringify([currentKey, currentSecret]))
          .digest("hex") !== fingerprint ||
        createHash("sha256").update(currentKey).digest("hex") !== accessKeySha256
      )
        fail("IDENTITY_MISMATCH");
    } catch (error) {
      throw safeReadError(error);
    }
  }
  function identityMatches(before: HtxReadIdentityEvidence, after: HtxReadIdentityEvidence): void {
    if (
      !sameObservationBinding(before.binding, binding) ||
      !sameObservationBinding(after.binding, binding) ||
      before.accessKeySha256 !== accessKeySha256 ||
      after.accessKeySha256 !== accessKeySha256 ||
      before.htxUid !== after.htxUid ||
      (expectedHtxUid !== undefined && before.htxUid !== expectedHtxUid) ||
      before.permission !== "readOnly" ||
      after.permission !== "readOnly" ||
      !Number.isSafeInteger(before.checkedAt) ||
      !Number.isSafeInteger(after.checkedAt) ||
      before.checkedAt < 0 ||
      after.checkedAt < before.checkedAt ||
      after.checkedAt < lastCheckedAt
    )
      fail(
        before.htxUid !== after.htxUid ||
          (expectedHtxUid !== undefined &&
            (before.htxUid !== expectedHtxUid || after.htxUid !== expectedHtxUid))
          ? "IDENTITY_MISMATCH"
          : "PERMISSION_DENIED",
      );
    const now = clock.now();
    if (!Number.isSafeInteger(now) || now < after.checkedAt) fail("INVALID_RESPONSE");
    lastCheckedAt = after.checkedAt;
  }
  async function freshIdentity(signal: AbortSignal): Promise<HtxReadIdentityEvidence> {
    if (disposed || signal.aborted) fail("READ_FAILED");
    assertCurrent();
    const evidence = await admission.verifyReadIdentity(binding, accessKeySha256, signal);
    if (disposed || signal.aborted) fail("READ_FAILED");
    assertCurrent();
    if (
      !sameObservationBinding(evidence.binding, binding) ||
      evidence.accessKeySha256 !== accessKeySha256 ||
      evidence.permission !== "readOnly" ||
      (expectedHtxUid !== undefined && evidence.htxUid !== expectedHtxUid) ||
      !Number.isSafeInteger(evidence.checkedAt) ||
      evidence.checkedAt < 0 ||
      evidence.checkedAt < lastCheckedAt ||
      !/^[1-9]\d{0,38}$/.test(evidence.htxUid)
    )
      fail(
        expectedHtxUid !== undefined && evidence.htxUid !== expectedHtxUid
          ? "IDENTITY_MISMATCH"
          : "PERMISSION_DENIED",
      );
    const now = clock.now();
    if (!Number.isSafeInteger(now) || now < evidence.checkedAt) fail("INVALID_RESPONSE");
    lastCheckedAt = evidence.checkedAt;
    return evidence;
  }
  async function perform(
    request: HtxV5ReadRequest,
    parentSignal: AbortSignal,
  ): Promise<HtxV5ReadResponse> {
    if (
      disposed ||
      active ||
      !parentSignal ||
      typeof parentSignal.aborted !== "boolean" ||
      parentSignal.aborted
    )
      fail("READ_FAILED");
    const controller = new AbortController();
    const timer = new AbortController();
    active = controller;
    const cancel = () => controller.abort();
    parentSignal.addEventListener("abort", cancel, { once: true });
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new AccountObservationReadFailure("READ_FAILED"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let bodyConsumed = false;
    let bodyCleanupStarted = false;
    let before: HtxReadIdentityEvidence | undefined;
    let afterCheckStarted = false;
    const cancelBody = () => {
      if (bodyCleanupStarted || bodyConsumed) return;
      const cleanup = reader?.cancel() ?? response?.body?.cancel();
      if (!cleanup) return;
      bodyCleanupStarted = true;
      cancelQuietly(cleanup);
    };
    const checkAfter = async (): Promise<HtxReadIdentityEvidence> => {
      if (!before || afterCheckStarted) return fail("READ_FAILED");
      afterCheckStarted = true;
      const after = await freshIdentity(controller.signal);
      identityMatches(before, after);
      return after;
    };
    const work = async (): Promise<HtxV5ReadResponse> => {
      try {
        before = await freshIdentity(controller.signal);
        const now = clock.now();
        if (!Number.isSafeInteger(now) || now < before.checkedAt) fail("INVALID_RESPONSE");
        const signedQuery = buildSignedQueryString({
          accessKeyId: accessKey,
          secret,
          host: V5_HOST,
          path: request.path,
          params: { ...request.query },
          timestamp: formatHtxTimestamp(new Date(now)),
        });
        const url = `https://${V5_HOST}${request.path}?${signedQuery}`;
        response = await fetchImpl(url, {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (disposed || controller.signal.aborted) {
          cancelBody();
          fail("READ_FAILED");
        }
        if (response.redirected || (response.url && response.url !== url)) {
          cancelBody();
          await checkAfter();
          fail("READ_FAILED");
        }
        if (response.status === 429) {
          cancelBody();
          await checkAfter();
          fail("RATE_LIMITED");
        }
        if (response.status === 401 || response.status === 403) {
          cancelBody();
          await checkAfter();
          fail("PERMISSION_DENIED");
        }
        if (response.status !== 200) {
          cancelBody();
          await checkAfter();
          fail("READ_FAILED");
        }
        const length = response.headers.get("content-length");
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxResponseBytes)) {
          cancelBody();
          await checkAfter();
          fail("INVALID_RESPONSE");
        }
        const responseBody = response.body;
        if (!responseBody) {
          await checkAfter();
          return fail("INVALID_RESPONSE");
        }
        reader = responseBody.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let byteCount = 0;
        let body = "";
        while (true) {
          const chunk = await reader.read();
          if (disposed || controller.signal.aborted) fail("READ_FAILED");
          if (chunk.done) {
            bodyConsumed = true;
            break;
          }
          if (
            !(chunk.value instanceof Uint8Array) ||
            (byteCount += chunk.value.byteLength) > maxResponseBytes
          )
            fail("INVALID_RESPONSE");
          try {
            body += decoder.decode(chunk.value, { stream: true });
          } catch {
            fail("INVALID_RESPONSE");
          }
        }
        try {
          body += decoder.decode();
        } catch {
          fail("INVALID_RESPONSE");
        }
        if (hasCredentialEcho(body, accessKey, secret)) fail("INVALID_RESPONSE");
        const receivedAt = clock.now();
        if (!Number.isSafeInteger(receivedAt) || receivedAt < now) fail("INVALID_RESPONSE");
        const finalIdentity = await checkAfter();
        if (disposed || controller.signal.aborted) fail("READ_FAILED");
        return Object.freeze({ body, identity: finalIdentity, receivedAt });
      } catch (error) {
        // Keep the post-response permission check inside the timed work. It also
        // fences fetch failures that do not produce a Response object.
        if (before && !afterCheckStarted && !disposed && !controller.signal.aborted) {
          try {
            await checkAfter();
          } catch (admissionError) {
            error = admissionError;
          }
        }
        throw safeReadError(error);
      }
    };
    try {
      return await Promise.race([
        track(work()),
        aborted,
        clock.sleep(timeoutMs, timer.signal).then(() => fail("TIMEOUT")),
      ]);
    } catch (error) {
      dispose();
      throw safeReadError(error);
    } finally {
      cancelBody();
      parentSignal.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", rejectAbort);
      timer.abort();
      controller.abort();
      if (active === controller) active = null;
    }
  }

  return Object.freeze({
    readAssetMode: (signal: AbortSignal) => perform(buildHtxV5AssetModeRequest(), signal),
    readBalance: (signal: AbortSignal) => perform(buildHtxV5BalanceRequest(), signal),
    readPositions: (
      options: Parameters<typeof buildHtxV5PositionsRequest>[0],
      signal: AbortSignal,
    ) => perform(buildHtxV5PositionsRequest(options), signal),
    readOpenOrders: (
      options: Parameters<typeof buildHtxV5OpenOrdersRequest>[0],
      signal: AbortSignal,
    ) => perform(buildHtxV5OpenOrdersRequest(options), signal),
    readAlgoOrders: (
      options: Parameters<typeof buildHtxV5AlgoOrdersRequest>[0],
      signal: AbortSignal,
    ) => perform(buildHtxV5AlgoOrdersRequest(options), signal),
    readFills: (options: Parameters<typeof buildHtxV5FillsRequest>[0], signal: AbortSignal) =>
      perform(buildHtxV5FillsRequest(options), signal),
    dispose,
    async settled() {
      dispose();
      while (pending.size) await Promise.allSettled([...pending]);
      await admission.settled();
      if (cancellationFailed) fail("READ_FAILED");
    },
  });
}
