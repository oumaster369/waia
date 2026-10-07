import "server-only";

import {
  createProjectionRequest,
  verifyProjectionRequest,
  verifyProjectionResponse,
  type ProjectionPayload,
  type ProjectionTuple,
  PROJECTION_PATHS,
  PROJECTION_PROTOCOL_LIMITS,
} from "./projection-protocol";
import { observationBindingSchema } from "./validation";
import type { AccountObservation, ObservationBinding } from "./types";

const PROJECTION_ORIGIN = "https://observation-reader.waia.life";
const PROJECTION_MAC_HEADER = "x-waia-projection-signature";
const RESPONSE_CONTENT_TYPE = "application/json";
const MAX_RESPONSE_BYTES = PROJECTION_PROTOCOL_LIMITS.responseBytes;
const UNAVAILABLE = "PROJECTION_UNAVAILABLE";

const projectionScopeSchema = observationBindingSchema
  .pick({ organizationId: true, credentialId: true, exchangeAccountId: true })
  .strict();

export type ProjectionScope = Readonly<{
  organizationId: string;
  credentialId: string;
  exchangeAccountId: string;
}>;

export type ProjectionClientOptions = Readonly<{
  fetch: typeof fetch;
  clock: () => number;
  tuple: ProjectionTuple;
  keyBytes: Uint8Array;
  accessClientId: string;
  accessClientSecret: string;
  /** The original route deadline. It is shared by every operation on this client. */
  deadlineMs: number;
  signal?: AbortSignal;
}>;

export type ProjectionClient = Readonly<{
  resolveActiveBinding(scope: ProjectionScope, signal?: AbortSignal): Promise<ObservationBinding | null>;
  readLatest(binding: ObservationBinding, signal?: AbortSignal): Promise<AccountObservation | null>;
  dispose(): void;
}>;

function unavailable(): Error {
  return new Error(UNAVAILABLE);
}

function assertCredential(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) throw new Error("PROJECTION_CLIENT_CONFIG");
}

function snapshotTuple(input: ProjectionTuple): ProjectionTuple {
  if (input === null || typeof input !== "object" ||
      input.audience !== PROJECTION_ORIGIN ||
      !/^[0-9a-f]{40}$/.test(input.releaseSha) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.epochId) ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(input.keyId)) {
    throw new Error("PROJECTION_CLIENT_CONFIG");
  }
  return Object.freeze({
    audience: input.audience,
    releaseSha: input.releaseSha,
    epochId: input.epochId,
    keyId: input.keyId,
  });
}

function snapshotKey(input: Uint8Array): Uint8Array {
  if (!(input instanceof Uint8Array) || input.byteLength !== 32) throw new Error("PROJECTION_CLIENT_CONFIG");
  return Uint8Array.from(input);
}

function assertLive(deadlineMs: number, clock: () => number, signals: readonly (AbortSignal | undefined)[]): void {
  const now = clock();
  if (!Number.isSafeInteger(deadlineMs) || !Number.isSafeInteger(now) || now >= deadlineMs ||
      signals.some((signal) => signal?.aborted)) throw unavailable();
}

function makeOperationController(
  deadlineMs: number,
  clock: () => number,
  signals: readonly (AbortSignal | undefined)[],
): { controller: AbortController; dispose: () => void } {
  assertLive(deadlineMs, clock, signals);
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) signal?.addEventListener("abort", abort, { once: true });
  const remaining = deadlineMs - clock();
  const timer = setTimeout(abort, Math.max(0, Math.min(remaining, 2_147_483_647)));
  const dispose = () => {
    clearTimeout(timer);
    for (const signal of signals) signal?.removeEventListener("abort", abort);
  };
  return { controller, dispose };
}

function raceSignal<T>(
  work: Promise<T>,
  signal: AbortSignal,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(unavailable()));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        if (settled) {
          try { onLate?.(value); } catch { /* best effort cleanup */ }
          return;
        }
        finish(() => resolve(value));
      },
      () => finish(() => reject(unavailable())),
    );
    if (signal.aborted) onAbort();
  });
}

function cancelResponse(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch { /* best effort cleanup */ }
}

function responseHeader(response: Response, name: string): string | null {
  const value = response.headers.get(name);
  if (value === null) return null;
  // Headers implementations join duplicate values with commas. Security and
  // representation headers must be singular and unambiguous.
  if (value.includes(",") || /[\r\n]/.test(value)) throw unavailable();
  return value;
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { reader.releaseLock(); } catch { /* stream may still be closing */ }
  };
  const cancel = () => {
    try { void reader.cancel().catch(() => undefined); } catch { /* best effort cleanup */ }
    for (const chunk of chunks) chunk.fill(0);
    chunks.length = 0;
    release();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const result = await raceSignal(reader.read(), signal);
      if (result.done) break;
      const chunk = result.value;
      total += chunk.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw unavailable();
      chunks.push(chunk);
    }
    if (signal.aborted) throw unavailable();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
      chunk.fill(0);
    }
    chunks.length = 0;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally {
      bytes.fill(0);
    }
  } catch {
    cancel();
    throw unavailable();
  } finally {
    signal.removeEventListener("abort", cancel);
    release();
  }
}

function validateResponseRepresentation(response: Response): string {
  const contentType = responseHeader(response, "content-type");
  const contentEncoding = responseHeader(response, "content-encoding");
  if (contentType !== RESPONSE_CONTENT_TYPE || (contentEncoding !== null && contentEncoding !== "identity")) {
    throw unavailable();
  }
  const signature = responseHeader(response, PROJECTION_MAC_HEADER);
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) throw unavailable();
  return signature;
}

function validateScope(scope: ProjectionScope): ProjectionScope {
  return Object.freeze(projectionScopeSchema.parse(scope));
}

function validateBinding(binding: ObservationBinding): ObservationBinding {
  return Object.freeze(observationBindingSchema.parse(binding));
}

export function createProjectionClient(options: ProjectionClientOptions): ProjectionClient {
  if (options === null || typeof options !== "object" || typeof options.fetch !== "function" ||
      typeof options.clock !== "function") throw new Error("PROJECTION_CLIENT_CONFIG");
  const tuple = snapshotTuple(options.tuple);
  const keyBytes = snapshotKey(options.keyBytes);
  assertCredential(options.accessClientId);
  assertCredential(options.accessClientSecret);
  if (!Number.isSafeInteger(options.deadlineMs) || options.deadlineMs <= options.clock()) {
    keyBytes.fill(0);
    throw new Error("PROJECTION_CLIENT_CONFIG");
  }
  const fetchImpl = options.fetch;
  const clock = options.clock;
  const clientSignal = options.signal;
  const deadlineMs = options.deadlineMs;
  const accessClientId = options.accessClientId;
  const accessClientSecret = options.accessClientSecret;
  const activeControllers = new Set<AbortController>();
  let disposed = false;

  async function execute(operation: "resolveBinding" | "readLatest", payload: ProjectionPayload | ObservationBinding,
    methodSignal?: AbortSignal): Promise<unknown | null> {
    const signals = [clientSignal, methodSignal] as const;
    if (disposed) throw unavailable();
    const { controller, dispose } = makeOperationController(deadlineMs, clock, signals);
    activeControllers.add(controller);
    let response: Response | undefined;
    try {
      assertLive(deadlineMs, clock, signals);
      const issuedAtMs = clock();
      const request = await raceSignal(createProjectionRequest({
        operation,
        tuple,
        requestId: crypto.randomUUID(),
        issuedAtMs,
        deadlineMs,
        payload,
      }, keyBytes), controller.signal);
      assertLive(deadlineMs, clock, signals);

      const requestHeaders: Record<string, string> = {
        "content-type": "application/json",
        [PROJECTION_MAC_HEADER]: request.headers[0][1],
        "CF-Access-Client-Id": accessClientId,
        "CF-Access-Client-Secret": accessClientSecret,
      };
      const rawHeaderBytes = new TextEncoder().encode(Object.entries(requestHeaders)
        .map(([name, value]) => `${name}: ${value}\r\n`).join("")).byteLength;
      if (rawHeaderBytes > PROJECTION_PROTOCOL_LIMITS.requestHeaderBytes) throw unavailable();
      const url = `${PROJECTION_ORIGIN}${PROJECTION_PATHS[operation]}`;
      const fetchWork = fetchImpl(url, {
        method: "POST",
        headers: requestHeaders,
        body: request.body,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      response = await raceSignal(fetchWork, controller.signal, cancelResponse);
      assertLive(deadlineMs, clock, signals);
      if (response.status !== 200) throw unavailable();
      const signature = validateResponseRepresentation(response);
      const body = await readBoundedBody(response, controller.signal);
      assertLive(deadlineMs, clock, signals);
      const verifiedRequest = await raceSignal(verifyProjectionRequest({
        method: request.method,
        path: request.path,
        headers: request.headers,
        body: request.body,
      }, { expectedTuple: tuple, keyBytes, clock }), controller.signal);
      const data = await raceSignal(verifyProjectionResponse({
        status: response.status,
        headers: [[PROJECTION_MAC_HEADER, signature]],
        body,
      }, verifiedRequest, { expectedTuple: tuple, keyBytes, clock }), controller.signal);
      assertLive(deadlineMs, clock, signals);
      return data;
    } catch {
      if (response) cancelResponse(response);
      throw unavailable();
    } finally {
      activeControllers.delete(controller);
      dispose();
    }
  }

  return Object.freeze({
    async resolveActiveBinding(scope: ProjectionScope, signal?: AbortSignal): Promise<ObservationBinding | null> {
      const validScope = validateScope(scope);
      return await execute("resolveBinding", validScope, signal) as ObservationBinding | null;
    },
    async readLatest(binding: ObservationBinding, signal?: AbortSignal): Promise<AccountObservation | null> {
      const validBinding = validateBinding(binding);
      return await execute("readLatest", validBinding, signal) as AccountObservation | null;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
      keyBytes.fill(0);
    },
  });
}
