/**
 * Pure signed-message protocol only. This module does not dispatch requests,
 * track nonces, prevent replay, access runtime configuration, or perform I/O.
 */
import {
  observationBindingSchema,
  parseAccountObservation,
  sameObservationBinding,
} from "./validation";
import type { AccountObservation, ObservationBinding } from "./types";

export type ProjectionOperation = "resolveBinding" | "readLatest";
export type ProjectionTuple = Readonly<{
  audience: string;
  releaseSha: string;
  epochId: string;
  keyId: string;
}>;
export type ProjectionScope = Pick<
  ObservationBinding,
  "organizationId" | "credentialId" | "exchangeAccountId"
>;
export type ProjectionPayload = ProjectionScope | ObservationBinding;
export type SignedProjectionRequest = Readonly<{
  method: "POST";
  path: string;
  headers: readonly (readonly ["x-waia-projection-signature", string])[];
  body: string;
}>;
export type SignedProjectionResponse = Readonly<{
  status: 200;
  headers: readonly (readonly ["x-waia-projection-signature", string])[];
  body: string;
}>;
export type RawProjectionRequestInput = unknown;
export type RawProjectionResponseInput = unknown;
export type VerifiedProjectionRequest = Readonly<{
  method: "POST";
  path: string;
  operation: ProjectionOperation;
  tuple: ProjectionTuple;
  requestId: string;
  issuedAtMs: number;
  deadlineMs: number;
  payload: ProjectionScope | ObservationBinding;
  body: string;
  bodySha256: string;
}>;
export type ProjectionResponseData = AccountObservation | ObservationBinding | null;

export const PROJECTION_PATHS: Readonly<Record<ProjectionOperation, string>> = Object.freeze({
  resolveBinding: "/internal/v1/account-observation/resolve-binding",
  readLatest: "/internal/v1/account-observation/read-latest",
});
export const PROJECTION_PROTOCOL_LIMITS = Object.freeze({
  requestBytes: 8 * 1024,
  responseBytes: 12 * 1024 * 1024,
  requestHeaderBytes: 16 * 1024,
  maxLifetimeMs: 5_000,
  clockSkewMs: 1_000,
});

const REQUEST_FIELDS = [
  "version",
  "tuple",
  "requestId",
  "issuedAtMs",
  "deadlineMs",
  "operation",
  "payload",
];
const RESPONSE_FIELDS = [
  "version",
  "tuple",
  "requestId",
  "requestBodySha256",
  "operation",
  "status",
  "data",
];
const TUPLE_FIELDS = ["audience", "releaseSha", "epochId", "keyId"];
const REQUEST_DOMAIN = "waia-account-observation-projection-request-v1";
const RESPONSE_DOMAIN = "waia-account-observation-projection-response-v1";
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA256_RE = /^[0-9a-f]{64}$/;
const KEY_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const EPOCH_ID_RE = REQUEST_ID_RE;
const RELEASE_SHA_RE = /^[0-9a-f]{40}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type ProjectionProtocolConfig = Readonly<{
  expectedTuple: ProjectionTuple;
  keyBytes: Uint8Array;
  clock?: () => number;
}>;

function fail(code: string): never {
  throw new Error(code);
}

function exactObjectKeys(
  value: unknown,
  fields: readonly string[],
  code: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) fail(code);
}

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("PROJECTION_JSON_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) fail("PROJECTION_JSON_CYCLE");
    seen.add(value);
    const serialized = `[${value.map((item) => canonical(item, seen)).join(",")}]`;
    seen.delete(value);
    return serialized;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const proto = Object.getPrototypeOf(object);
    if (proto !== Object.prototype && proto !== null) fail("PROJECTION_JSON_OBJECT");
    if (seen.has(object)) fail("PROJECTION_JSON_CYCLE");
    seen.add(object);
    const keys = Object.keys(object).sort();
    const serialized = `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(object[key], seen)}`).join(",")}}`;
    seen.delete(object);
    return serialized;
  }
  return fail("PROJECTION_JSON_VALUE");
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function detachJson<T>(value: T): T {
  return freezeDeep(JSON.parse(canonical(value)) as T);
}

function parseCanonical(
  raw: unknown,
  byteCap: number,
  code: string,
): { parsed: unknown; bytes: Uint8Array } {
  if (typeof raw !== "string") return fail(code);
  const bytes = encoder.encode(raw);
  if (bytes.byteLength === 0 || bytes.byteLength > byteCap) fail("PROJECTION_BODY_SIZE");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    return fail(code);
  }
  if (canonical(parsed) !== raw) fail("PROJECTION_NON_CANONICAL_JSON");
  return { parsed, bytes };
}

function validateTuple(input: unknown): ProjectionTuple {
  exactObjectKeys(input, TUPLE_FIELDS, "PROJECTION_TUPLE_FIELDS");
  const tuple = input;
  if (
    typeof tuple.audience !== "string" ||
    typeof tuple.releaseSha !== "string" ||
    typeof tuple.epochId !== "string" ||
    typeof tuple.keyId !== "string"
  )
    fail("PROJECTION_TUPLE_VALUE");
  let parsedAudience: URL;
  try {
    parsedAudience = new URL(tuple.audience);
  } catch {
    return fail("PROJECTION_AUDIENCE");
  }
  if (
    parsedAudience.protocol !== "https:" ||
    parsedAudience.origin !== tuple.audience ||
    parsedAudience.username !== "" ||
    parsedAudience.password !== "" ||
    parsedAudience.search !== "" ||
    parsedAudience.hash !== "" ||
    parsedAudience.pathname !== "/"
  )
    fail("PROJECTION_AUDIENCE");
  if (
    !RELEASE_SHA_RE.test(tuple.releaseSha) ||
    !EPOCH_ID_RE.test(tuple.epochId) ||
    !KEY_ID_RE.test(tuple.keyId)
  ) {
    fail("PROJECTION_TUPLE_VALUE");
  }
  return Object.freeze({
    audience: tuple.audience,
    releaseSha: tuple.releaseSha,
    epochId: tuple.epochId,
    keyId: tuple.keyId,
  });
}

function sameTuple(actual: ProjectionTuple, expected: ProjectionTuple): boolean {
  return TUPLE_FIELDS.every(
    (field) => actual[field as keyof ProjectionTuple] === expected[field as keyof ProjectionTuple],
  );
}

function tupleFor(input: ProjectionProtocolConfig): {
  tuple: ProjectionTuple;
  key: Uint8Array;
  clock: () => number;
} {
  const expectedTuple = validateTuple(input?.expectedTuple);
  if (!(input?.keyBytes instanceof Uint8Array) || input.keyBytes.byteLength !== 32)
    fail("PROJECTION_KEY_LENGTH");
  const key = Uint8Array.from(input.keyBytes);
  return { tuple: expectedTuple, key, clock: input.clock ?? (() => Date.now()) };
}

function readClock(clock: () => number): number {
  const now = clock();
  if (!Number.isSafeInteger(now)) fail("PROJECTION_CLOCK_INVALID");
  return now;
}

function assertRequestTime(issuedAtMs: number, deadlineMs: number, now: number): void {
  if (
    deadlineMs <= issuedAtMs ||
    deadlineMs - issuedAtMs > PROJECTION_PROTOCOL_LIMITS.maxLifetimeMs ||
    issuedAtMs > now + PROJECTION_PROTOCOL_LIMITS.clockSkewMs ||
    deadlineMs <= now ||
    deadlineMs > now + PROJECTION_PROTOCOL_LIMITS.maxLifetimeMs
  )
    fail("PROJECTION_EXPIRED");
}

function validatePayload(
  operation: ProjectionOperation,
  value: unknown,
): ObservationBinding | ProjectionPayload {
  try {
    return operation === "resolveBinding"
      ? observationBindingSchema
          .pick({ organizationId: true, credentialId: true, exchangeAccountId: true })
          .strict()
          .parse(value)
      : observationBindingSchema.parse(value);
  } catch {
    return fail("PROJECTION_BINDING_INVALID");
  }
}

function parseResponseData(
  operation: ProjectionOperation,
  value: unknown,
): AccountObservation | ObservationBinding {
  try {
    return operation === "resolveBinding"
      ? observationBindingSchema.parse(value)
      : parseAccountObservation(value);
  } catch {
    return fail("PROJECTION_RESPONSE_DATA_INVALID");
  }
}

type ResponseBindingContext = Pick<VerifiedProjectionRequest, "operation" | "payload">;

function assertResponseBinding(
  request: ResponseBindingContext,
  data: AccountObservation | ObservationBinding,
): void {
  if (request.operation === "resolveBinding") {
    const actual = data as ObservationBinding;
    const requested = request.payload as ProjectionScope;
    if (
      actual.organizationId !== requested.organizationId ||
      actual.credentialId !== requested.credentialId ||
      actual.exchangeAccountId !== requested.exchangeAccountId
    )
      fail("PROJECTION_RESPONSE_BINDING");
    return;
  }
  if (
    !("binding" in data) ||
    !sameObservationBinding(data.binding, request.payload as ObservationBinding)
  ) {
    fail("PROJECTION_RESPONSE_BINDING");
  }
}

function pathFor(operation: ProjectionOperation): string {
  return PROJECTION_PATHS[operation];
}

function copyKey(input: Uint8Array): Uint8Array {
  if (!(input instanceof Uint8Array) || input.byteLength !== 32) fail("PROJECTION_KEY_LENGTH");
  return Uint8Array.from(input);
}

function ownedBuffer(input: Uint8Array): ArrayBuffer {
  return Uint8Array.from(input).buffer as ArrayBuffer;
}

function hex(input: Uint8Array): string {
  return Array.from(input, (value) => value.toString(16).padStart(2, "0")).join("");
}

function fromHex(input: string): Uint8Array {
  return Uint8Array.from(input.match(/../g) ?? [], (part) => Number.parseInt(part, 16));
}

async function bodyHash(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", ownedBuffer(bytes))));
}

function requestMacInput(path: string, hash: string): string {
  return canonical({ domain: REQUEST_DOMAIN, method: "POST", path, bodySha256: hash });
}

function responseMacInput(path: string, requestHash: string, responseHash: string): string {
  return canonical({
    domain: RESPONSE_DOMAIN,
    method: "POST",
    path,
    requestBodySha256: requestHash,
    responseBodySha256: responseHash,
  });
}

async function sign(key: Uint8Array, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", cryptoKey, ownedBuffer(encoder.encode(message))),
    ),
  );
}

async function verify(key: Uint8Array, message: string, signature: string): Promise<boolean> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    ownedBuffer(fromHex(signature)),
    ownedBuffer(encoder.encode(message)),
  );
}

function signatureFromHeaders(input: unknown): string {
  if (
    !Array.isArray(input) ||
    input.length !== 1 ||
    !Array.isArray(input[0]) ||
    input[0].length !== 2 ||
    input[0][0] !== "x-waia-projection-signature" ||
    typeof input[0][1] !== "string" ||
    !HEX_SHA256_RE.test(input[0][1])
  )
    fail("PROJECTION_SIGNATURE_HEADER");
  return input[0][1];
}

function frozenHeaders(signature: string): SignedProjectionRequest["headers"] {
  return Object.freeze([Object.freeze(["x-waia-projection-signature", signature] as const)]);
}

function requestEnvelope(input: {
  operation: ProjectionOperation;
  tuple: ProjectionTuple;
  requestId: string;
  issuedAtMs: number;
  deadlineMs: number;
  payload: unknown;
}): Record<string, unknown> {
  const tuple = validateTuple(input.tuple);
  if (typeof input.requestId !== "string" || !REQUEST_ID_RE.test(input.requestId))
    fail("PROJECTION_REQUEST_ID");
  if (!Number.isSafeInteger(input.issuedAtMs) || !Number.isSafeInteger(input.deadlineMs))
    fail("PROJECTION_TIME");
  if (input.operation !== "resolveBinding" && input.operation !== "readLatest")
    fail("PROJECTION_OPERATION");
  const payload = validatePayload(input.operation, input.payload);
  if (canonical(payload) !== canonical(input.payload)) fail("PROJECTION_PAYLOAD_NORMALIZED");
  return {
    version: 1,
    tuple,
    requestId: input.requestId,
    issuedAtMs: input.issuedAtMs,
    deadlineMs: input.deadlineMs,
    operation: input.operation,
    payload,
  };
}

export async function createProjectionRequest(
  input: {
    operation: ProjectionOperation;
    tuple: ProjectionTuple;
    requestId: string;
    issuedAtMs: number;
    deadlineMs: number;
    payload: unknown;
  },
  keyBytes: Uint8Array,
): Promise<SignedProjectionRequest> {
  const key = copyKey(keyBytes);
  const envelope = requestEnvelope(input);
  if (
    (envelope.deadlineMs as number) <= (envelope.issuedAtMs as number) ||
    (envelope.deadlineMs as number) - (envelope.issuedAtMs as number) >
      PROJECTION_PROTOCOL_LIMITS.maxLifetimeMs
  )
    fail("PROJECTION_LIFETIME");
  const body = canonical(envelope);
  const bytes = encoder.encode(body);
  if (bytes.byteLength > PROJECTION_PROTOCOL_LIMITS.requestBytes) fail("PROJECTION_BODY_SIZE");
  const path = pathFor(input.operation);
  const signature = await sign(key, requestMacInput(path, await bodyHash(bytes)));
  return Object.freeze({ method: "POST", path, headers: frozenHeaders(signature), body });
}

function verifiedTuple(expected: ProjectionTuple, received: unknown): ProjectionTuple {
  const tuple = validateTuple(received);
  if (!sameTuple(tuple, expected)) fail("PROJECTION_TUPLE_MISMATCH");
  return tuple;
}

function rawRequest(input: unknown): {
  method: unknown;
  path: unknown;
  headers: unknown;
  body: unknown;
} {
  exactObjectKeys(input, ["method", "path", "headers", "body"], "PROJECTION_REQUEST_INPUT_FIELDS");
  return { method: input.method, path: input.path, headers: input.headers, body: input.body };
}

export async function verifyProjectionRequest(
  input: RawProjectionRequestInput,
  config: ProjectionProtocolConfig,
): Promise<VerifiedProjectionRequest> {
  const raw = rawRequest(input);
  const signature = signatureFromHeaders(raw.headers);
  const method = raw.method;
  const path = raw.path;
  const body = raw.body;
  if (method !== "POST" || typeof path !== "string") fail("PROJECTION_METHOD_OR_PATH");
  if (typeof body !== "string") fail("PROJECTION_REQUEST_JSON");
  const { tuple: expectedTuple, key, clock } = tupleFor(config);
  const { parsed: parsedEnvelope, bytes } = parseCanonical(
    body,
    PROJECTION_PROTOCOL_LIMITS.requestBytes,
    "PROJECTION_REQUEST_JSON",
  );
  exactObjectKeys(parsedEnvelope, REQUEST_FIELDS, "PROJECTION_REQUEST_FIELDS");
  const envelope = parsedEnvelope;
  if (
    envelope.version !== 1 ||
    (envelope.operation !== "resolveBinding" && envelope.operation !== "readLatest") ||
    typeof envelope.requestId !== "string" ||
    !REQUEST_ID_RE.test(envelope.requestId) ||
    typeof envelope.issuedAtMs !== "number" ||
    !Number.isSafeInteger(envelope.issuedAtMs) ||
    typeof envelope.deadlineMs !== "number" ||
    !Number.isSafeInteger(envelope.deadlineMs)
  )
    fail("PROJECTION_REQUEST_VALUE");
  const operation = envelope.operation;
  const issuedAtMs = envelope.issuedAtMs;
  const deadlineMs = envelope.deadlineMs;
  const requestId = envelope.requestId;
  if (path !== pathFor(operation)) fail("PROJECTION_METHOD_OR_PATH");
  assertRequestTime(issuedAtMs, deadlineMs, readClock(clock));
  const tuple = verifiedTuple(expectedTuple, envelope.tuple);
  const canonicalPayload = detachJson(envelope.payload);
  const parsedPayload = detachJson(validatePayload(operation, canonicalPayload));
  if (canonical(parsedPayload) !== canonical(canonicalPayload))
    fail("PROJECTION_PAYLOAD_NORMALIZED");
  assertRequestTime(issuedAtMs, deadlineMs, readClock(clock));
  const hash = await bodyHash(bytes);
  assertRequestTime(issuedAtMs, deadlineMs, readClock(clock));
  const valid = await verify(key, requestMacInput(path, hash), signature);
  assertRequestTime(issuedAtMs, deadlineMs, readClock(clock));
  if (!valid) fail("PROJECTION_SIGNATURE_INVALID");
  return Object.freeze({
    method: "POST",
    path,
    operation,
    tuple,
    requestId,
    issuedAtMs,
    deadlineMs,
    payload: parsedPayload,
    body,
    bodySha256: hash,
  });
}

export async function createProjectionResponse(
  request: VerifiedProjectionRequest,
  data: ProjectionResponseData,
  keyBytes: Uint8Array,
): Promise<SignedProjectionResponse> {
  const key = copyKey(keyBytes);
  const context = Object.freeze({
    method: request.method,
    path: request.path,
    operation: request.operation,
    tuple: validateTuple(request.tuple),
    requestId: request.requestId,
    bodySha256: request.bodySha256,
    payload: detachJson(request.payload),
  });
  const parsedData = data === null ? null : detachJson(parseResponseData(context.operation, data));
  if (parsedData !== null) assertResponseBinding(context, parsedData);
  const envelope = {
    version: 1,
    tuple: context.tuple,
    requestId: context.requestId,
    requestBodySha256: context.bodySha256,
    operation: context.operation,
    status: parsedData === null ? "empty" : "ok",
    data: parsedData,
  };
  const body = canonical(envelope);
  const bytes = encoder.encode(body);
  if (bytes.byteLength > PROJECTION_PROTOCOL_LIMITS.responseBytes) fail("PROJECTION_BODY_SIZE");
  const signature = await sign(
    key,
    responseMacInput(context.path, context.bodySha256, await bodyHash(bytes)),
  );
  return Object.freeze({ status: 200, headers: frozenHeaders(signature), body });
}

function rawResponse(input: unknown): { status: unknown; headers: unknown; body: unknown } {
  exactObjectKeys(input, ["status", "headers", "body"], "PROJECTION_RESPONSE_INPUT_FIELDS");
  return { status: input.status, headers: input.headers, body: input.body };
}

export async function verifyProjectionResponse(
  input: RawProjectionResponseInput,
  request: VerifiedProjectionRequest,
  config: ProjectionProtocolConfig,
): Promise<ProjectionResponseData> {
  const raw = rawResponse(input);
  const status = raw.status;
  const signature = signatureFromHeaders(raw.headers);
  const body = raw.body;
  const { tuple: expectedTuple, key, clock } = tupleFor(config);
  const context = Object.freeze({
    method: request.method,
    path: request.path,
    operation: request.operation,
    tuple: validateTuple(request.tuple),
    requestId: request.requestId,
    deadlineMs: request.deadlineMs,
    bodySha256: request.bodySha256,
    payload: detachJson(request.payload),
  });
  if (
    status !== 200 ||
    context.method !== "POST" ||
    context.path !== pathFor(context.operation) ||
    readClock(clock) >= context.deadlineMs
  )
    fail("PROJECTION_RESPONSE_STATUS_OR_LATE");
  if (!sameTuple(context.tuple, expectedTuple)) fail("PROJECTION_TUPLE_MISMATCH");
  const { parsed: parsedEnvelope, bytes } = parseCanonical(
    body,
    PROJECTION_PROTOCOL_LIMITS.responseBytes,
    "PROJECTION_RESPONSE_JSON",
  );
  exactObjectKeys(parsedEnvelope, RESPONSE_FIELDS, "PROJECTION_RESPONSE_FIELDS");
  const envelope = parsedEnvelope;
  if (
    envelope.version !== 1 ||
    envelope.operation !== context.operation ||
    envelope.requestId !== context.requestId ||
    envelope.requestBodySha256 !== context.bodySha256 ||
    !sameTuple(validateTuple(envelope.tuple), expectedTuple) ||
    (envelope.status !== "ok" && envelope.status !== "empty") ||
    (envelope.status === "empty") !== (envelope.data === null)
  )
    fail("PROJECTION_RESPONSE_IDENTITY");
  const hash = await bodyHash(bytes);
  if (readClock(clock) >= context.deadlineMs) fail("PROJECTION_RESPONSE_STATUS_OR_LATE");
  const valid = await verify(
    key,
    responseMacInput(context.path, context.bodySha256, hash),
    signature,
  );
  if (readClock(clock) >= context.deadlineMs) fail("PROJECTION_RESPONSE_STATUS_OR_LATE");
  if (!valid) fail("PROJECTION_SIGNATURE_INVALID");
  if (envelope.status === "empty") return null;
  const parsedData = detachJson(parseResponseData(context.operation, envelope.data));
  if (readClock(clock) >= context.deadlineMs) fail("PROJECTION_RESPONSE_STATUS_OR_LATE");
  assertResponseBinding(context, parsedData);
  return parsedData;
}
