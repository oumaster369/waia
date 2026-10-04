import "server-only";

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import {
  PROJECTION_PATHS,
  PROJECTION_PROTOCOL_LIMITS,
  type SignedProjectionResponse,
} from "./projection-protocol";

const MAC_HEADER = "x-waia-projection-signature";
const JSON_CONTENT_TYPE = "application/json";
const UNAVAILABLE_BODY = '{"error":"ACCOUNT_OBSERVATION_PROJECTION_UNAVAILABLE"}';
const BODY_READ_TIMEOUT_MS = 1_000;
const RESPONSE_DEADLINE_MS = 5_000;
const SOCKET_LIFETIME_MS = BODY_READ_TIMEOUT_MS + RESPONSE_DEADLINE_MS;
const SIGNATURE_RE = /^[0-9a-f]{64}$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });

type ProjectionLease = {
  signal: AbortSignal;
  release(): void;
  run(rawRequest: unknown): Promise<SignedProjectionResponse>;
};

/** Structural dependency keeps the adapter independent of dispatcher construction. */
export type ProjectionHttpDispatcher = Readonly<{
  acquire(): ProjectionLease;
}>;

/**
 * Creates, but does not listen on, the Node-only projection HTTP server.
 * The owner must bind it to an isolated listener and hold its process lock.
 */
export function createProjectionHttpServer(options: {
  dispatcher: ProjectionHttpDispatcher;
}): Server {
  if (!options || typeof options.dispatcher?.acquire !== "function") {
    throw new Error("ACCOUNT_OBSERVATION_PROJECTION_UNAVAILABLE");
  }
  const preHeaderTimers = new WeakMap<Socket, ReturnType<typeof setTimeout>>();
  const socketLifetimeTimers = new WeakMap<Socket, ReturnType<typeof setTimeout>>();
  const clearPreHeaderTimer = (socket: Socket) => {
    const timer = preHeaderTimers.get(socket);
    if (timer) clearTimeout(timer);
    preHeaderTimers.delete(socket);
  };
  const server = createServer(
    { maxHeaderSize: PROJECTION_PROTOCOL_LIMITS.requestHeaderBytes },
    (request, response) => {
      clearPreHeaderTimer(request.socket);
      request.socket.setTimeout(0);
      void handleRequest(options.dispatcher, request, response);
    },
  );
  // Bound sockets before dispatcher admission too: a client cannot occupy an
  // unaccounted partial-header connection indefinitely or exceed four sockets.
  server.maxConnections = 4;
  // The raw byte cap bounds parser memory; preserve every pair so duplicate
  // security headers cannot hide beyond Node's default header-count cutoff.
  server.maxHeadersCount = 0;
  server.headersTimeout = BODY_READ_TIMEOUT_MS;
  server.on("connection", (socket) => {
    const timer = setTimeout(() => socket.destroy(), BODY_READ_TIMEOUT_MS);
    preHeaderTimers.set(socket, timer);
    const lifetimeTimer = setTimeout(() => socket.destroy(), SOCKET_LIFETIME_MS);
    socketLifetimeTimers.set(socket, lifetimeTimer);
    socket.once("close", () => {
      clearPreHeaderTimer(socket);
      const lifetime = socketLifetimeTimers.get(socket);
      if (lifetime) clearTimeout(lifetime);
      socketLifetimeTimers.delete(socket);
    });
  });

  // Node handles these parser-level events outside the ordinary request callback.
  server.on("checkContinue", (request, response) => {
    clearPreHeaderTimer(request.socket);
    request.socket.setTimeout(0);
    rejectAndClose(response);
  });
  server.on("checkExpectation", (request, response) => {
    clearPreHeaderTimer(request.socket);
    request.socket.setTimeout(0);
    rejectAndClose(response);
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("connect", (_request, socket) => socket.destroy());
  return server;
}

async function handleRequest(
  dispatcher: ProjectionHttpDispatcher,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (
    request.method !== "POST" ||
    typeof request.url !== "string" ||
    (request.url !== PROJECTION_PATHS.resolveBinding &&
      request.url !== PROJECTION_PATHS.readLatest) ||
    !validHeaders(request)
  ) {
    rejectAndClose(response);
    return;
  }

  const declaredLength = singleRawHeader(request, "content-length");
  if (
    declaredLength !== undefined &&
    declaredLength !== null &&
    (!/^(0|[1-9][0-9]*)$/.test(declaredLength) ||
      Number(declaredLength) > PROJECTION_PROTOCOL_LIMITS.requestBytes)
  ) {
    rejectAndClose(response);
    return;
  }

  let lease: ProjectionLease;
  try {
    // Admission precedes all request-body reads. Release only the HTTP lease here;
    // the dispatcher owns query occupancy and keeps it until the reader settles.
    lease = dispatcher.acquire();
  } catch {
    rejectAndClose(response);
    return;
  }

  let released = false;
  let finished = false;
  const release = () => {
    if (released) return;
    released = true;
    lease.release();
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(routeTimer);
    release();
  };
  response.once("finish", finish);
  response.once("close", finish);
  request.once("aborted", () => {
    release();
    if (!response.destroyed) response.destroy();
  });

  // Absolute route lifetime bounds request reads, queued work and slow response readers.
  const routeTimer = setTimeout(() => {
    release();
    if (!response.destroyed) response.destroy();
  }, RESPONSE_DEADLINE_MS);

  try {
    const body = await readRequestBody(request, response);
    if (body === null || response.destroyed || lease.signal.aborted) return;
    const signature = singleRawHeader(request, MAC_HEADER);
    if (typeof signature !== "string") throw new Error("invalid request");

    const signed = await lease.run({
      method: "POST",
      path: request.url!,
      headers: [[MAC_HEADER, signature]],
      body,
    });
    if (response.destroyed || lease.signal.aborted) return;
    writeSignedResponse(response, signed);
  } catch {
    if (!response.destroyed && !response.writableEnded) rejectAndClose(response);
  }
}

function validHeaders(request: IncomingMessage): boolean {
  const contentType = singleRawHeader(request, "content-type");
  const contentEncoding = singleRawHeader(request, "content-encoding");
  const signature = singleRawHeader(request, MAC_HEADER);
  const expect = singleRawHeader(request, "expect");
  const upgrade = singleRawHeader(request, "upgrade");
  const host = singleRawHeader(request, "host");
  const contentLength = singleRawHeader(request, "content-length");
  const transferEncoding = singleRawHeader(request, "transfer-encoding");

  return (
    contentType !== null &&
    contentEncoding !== null &&
    signature !== null &&
    expect !== null &&
    upgrade !== null &&
    host !== null &&
    contentLength !== null &&
    transferEncoding !== null &&
    contentType === JSON_CONTENT_TYPE &&
    (contentEncoding === undefined || contentEncoding === "identity") &&
    (contentLength === undefined || transferEncoding === undefined) &&
    typeof signature === "string" &&
    SIGNATURE_RE.test(signature) &&
    expect === undefined &&
    upgrade === undefined &&
    typeof host === "string" &&
    host.length > 0 &&
    (transferEncoding === undefined || transferEncoding.toLowerCase() === "chunked")
  );
}

/** Returns undefined for absence, and null for a duplicate or invalid pair. */
function singleRawHeader(request: IncomingMessage, name: string): string | undefined | null {
  let value: string | undefined;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() !== name) continue;
    if (value !== undefined) return null;
    value = request.rawHeaders[index + 1];
  }
  return value;
}

function readRequestBody(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("aborted", onAborted);
      request.removeListener("error", onError);
      request.removeListener("close", onClose);
    };
    const fail = (closeSocket: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      if (closeSocket && !response.destroyed) response.destroy();
      reject(new Error("request body unavailable"));
    };
    const onData = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > PROJECTION_PROTOCOL_LIMITS.requestBytes) {
        // Destroy rather than drain an unbounded attacker-controlled request body.
        fail(true);
        return;
      }
      chunks.push(Buffer.from(bytes));
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const bytes = Buffer.concat(chunks, total);
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      try {
        resolve(utf8.decode(bytes));
      } catch {
        bytes.fill(0);
        reject(new Error("request body unavailable"));
        return;
      }
      bytes.fill(0);
    };
    const onAborted = () => fail(false);
    const onError = () => fail(false);
    const onClose = () => {
      if (!request.complete) fail(false);
    };
    const timer = setTimeout(() => fail(true), BODY_READ_TIMEOUT_MS);
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
    request.once("close", onClose);
  });
}

function writeSignedResponse(response: ServerResponse, signed: SignedProjectionResponse): void {
  if (
    !signed ||
    signed.status !== 200 ||
    typeof signed.body !== "string" ||
    Buffer.byteLength(signed.body, "utf8") > PROJECTION_PROTOCOL_LIMITS.responseBytes ||
    !Array.isArray(signed.headers) ||
    signed.headers.length !== 1 ||
    !Array.isArray(signed.headers[0]) ||
    signed.headers[0].length !== 2 ||
    signed.headers[0][0] !== MAC_HEADER ||
    typeof signed.headers[0][1] !== "string" ||
    !SIGNATURE_RE.test(signed.headers[0][1])
  ) {
    rejectAndClose(response);
    return;
  }

  response.statusCode = 200;
  response.setHeader("content-type", JSON_CONTENT_TYPE);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader(MAC_HEADER, signed.headers[0][1]);
  response.setHeader("content-length", Buffer.byteLength(signed.body, "utf8"));
  response.setHeader("connection", "close");
  response.end(signed.body);
}

function rejectAndClose(response: ServerResponse): void {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = 503;
  response.setHeader("content-type", JSON_CONTENT_TYPE);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("connection", "close");
  response.setHeader("content-length", Buffer.byteLength(UNAVAILABLE_BODY));
  response.end(UNAVAILABLE_BODY);
}
