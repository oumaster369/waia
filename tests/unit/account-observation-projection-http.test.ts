import { afterEach, describe, expect, it } from "vitest";
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import { once } from "node:events";
import {
  createProjectionHttpServer,
  type ProjectionHttpDispatcher,
} from "@/lib/trader/account-observation/projection-http";
import {
  createProjectionRequest,
  createProjectionResponse,
  verifyProjectionRequest,
  verifyProjectionResponse,
  PROJECTION_PATHS,
  type SignedProjectionRequest,
} from "@/lib/trader/account-observation/projection-protocol";
import { binding, observation } from "./account-observation-stream-fixtures";

const tuple = Object.freeze({
  audience: "https://observation-reader.waia.life",
  releaseSha: "a".repeat(40),
  epochId: "11111111-1111-4111-8111-111111111111",
  keyId: "http-test",
});
const key = new Uint8Array(32).fill(7);
const scope = {
  organizationId: binding.organizationId,
  credentialId: binding.credentialId,
  exchangeAccountId: binding.exchangeAccountId,
};
const servers: ReturnType<typeof createProjectionHttpServer>[] = [];
const clients = new Set<ClientRequest>();
const sockets = new Set<Socket>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function createDispatcher(run?: (raw: unknown) => Promise<unknown>) {
  const calls = { acquired: 0, released: 0, ran: 0 };
  const dispatcher: ProjectionHttpDispatcher = {
    acquire() {
      calls.acquired++;
      const controller = new AbortController();
      let released = false;
      return {
        signal: controller.signal,
        release() {
          if (released) return;
          released = true;
          calls.released++;
          controller.abort();
        },
        async run(raw) {
          calls.ran++;
          if (run) return (await run(raw)) as never;
          const request = await verifyProjectionRequest(raw, {
            expectedTuple: tuple,
            keyBytes: key,
            clock: Date.now,
          });
          return createProjectionResponse(request, observation(), key);
        },
      };
    },
  };
  return { dispatcher, calls };
}

async function start(dispatcher: ProjectionHttpDispatcher) {
  const server = createProjectionHttpServer({ dispatcher });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected loopback socket");
  return { server, port: address.port };
}

function sendRaw(port: number, raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, "127.0.0.1");
    sockets.add(socket);
    const chunks: Buffer[] = [];
    socket.once("connect", () => socket.write(raw));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.once("error", reject);
    socket.once("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function signedRequest(
  operation: "resolveBinding" | "readLatest" = "readLatest",
): Promise<SignedProjectionRequest> {
  const now = Date.now();
  return createProjectionRequest(
    {
      operation,
      tuple,
      requestId: `aaaaaaaa-aaaa-4aaa-8aaa-${Math.floor(Math.random() * 0xffffffffffff)
        .toString(16)
        .padStart(12, "0")}`,
      issuedAtMs: now,
      deadlineMs: now + 5_000,
      payload: operation === "readLatest" ? binding : scope,
    },
    key,
  );
}

type Reply = { status: number; headers: IncomingMessage["headers"]; body: string };
function send(
  port: number,
  path: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string | number | string[]> | readonly string[];
    flushHeaders?: boolean;
  } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "POST",
        agent: false,
        headers: options.headers ?? {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(options.body ?? ""),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.once("error", reject);
      },
    );
    clients.add(request);
    request.once("close", () => clients.delete(request));
    request.once("error", reject);
    if (options.flushHeaders) request.flushHeaders();
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

async function postSigned(
  port: number,
  request: SignedProjectionRequest,
  overrides: {
    path?: string;
    method?: string;
    body?: string;
    headers?: Record<string, string | number | string[]> | readonly string[];
  } = {},
) {
  return send(port, overrides.path ?? request.path, {
    method: overrides.method,
    body: overrides.body ?? request.body,
    headers: overrides.headers ?? {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(overrides.body ?? request.body),
      [request.headers[0][0]]: request.headers[0][1],
      connection: "close",
    },
  });
}

async function closeServer(server: ReturnType<typeof createProjectionHttpServer>) {
  server.closeAllConnections();
  if (server.listening) {
    server.close();
    await once(server, "close");
  }
}

afterEach(async () => {
  for (const client of clients) client.destroy();
  clients.clear();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  for (const server of servers.splice(0)) await closeServer(server);
});

describe("projection Node HTTP adapter", () => {
  it("forwards the exact signed request and returns a verifiable no-store response", async () => {
    const { dispatcher, calls } = createDispatcher();
    const { port } = await start(dispatcher);
    const request = await signedRequest();
    const reply = await postSigned(port, request);
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe("application/json");
    expect(reply.headers["cache-control"]).toBe("no-store");
    const verifiedRequest = await verifyProjectionRequest(request, {
      expectedTuple: tuple,
      keyBytes: key,
    });
    await expect(
      verifyProjectionResponse(
        {
          status: reply.status,
          headers: [[request.headers[0][0], reply.headers[request.headers[0][0]] as string]],
          body: reply.body,
        },
        verifiedRequest,
        { expectedTuple: tuple, keyBytes: key },
      ),
    ).resolves.toMatchObject({
      schemaVersion: "account-observation/v1",
      binding,
    });
    expect(calls).toEqual({ acquired: 1, released: 1, ran: 1 });
  });

  it("acquires its HTTP lease before reading the body and releases it on client disconnect", async () => {
    const { dispatcher, calls } = createDispatcher();
    const { port } = await start(dispatcher);
    const request = await signedRequest();
    const client = httpRequest({
      host: "127.0.0.1",
      port,
      path: request.path,
      method: "POST",
      agent: false,
      headers: {
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        [request.headers[0][0]]: request.headers[0][1],
        connection: "close",
      },
    });
    clients.add(client);
    client.on("error", () => undefined);
    client.flushHeaders();
    for (let i = 0; i < 50 && calls.acquired === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.acquired).toBe(1);
    client.destroy();
    for (let i = 0; i < 100 && calls.released === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.released).toBe(1);
    expect(calls.ran).toBe(0);
  });

  it("rejects duplicate signature headers and raw path aliases without dispatch", async () => {
    const { dispatcher, calls } = createDispatcher();
    const { port } = await start(dispatcher);
    const request = await signedRequest();
    const duplicate = await sendRaw(
      port,
      [
        `POST ${request.path} HTTP/1.1`,
        "Host: 127.0.0.1",
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(request.body)}`,
        "Connection: close",
        `${request.headers[0][0]}: ${request.headers[0][1]}`,
        `${request.headers[0][0]}: ${request.headers[0][1]}`,
        "",
        request.body,
      ].join("\r\n"),
    );
    expect(duplicate).toContain("503 Service Unavailable");
    expect(duplicate).toContain('{"error":"ACCOUNT_OBSERVATION_PROJECTION_UNAVAILABLE"}');
    const alias = await postSigned(port, request, { path: `${request.path}?ignored=1` });
    expect(alias.status).toBe(503);
    expect(calls).toMatchObject({ acquired: 0, ran: 0 });
  });

  it("rejects a duplicate signature after more than two thousand unknown headers", async () => {
    const { dispatcher, calls } = createDispatcher();
    const { port } = await start(dispatcher);
    const request = await signedRequest();
    const unknownHeaders = Array.from({ length: 2_001 }, () => "x: y");
    const raw = [
      `POST ${request.path} HTTP/1.1`,
      "Host: 127.0.0.1",
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(request.body)}`,
      "Connection: close",
      `${request.headers[0][0]}: ${request.headers[0][1]}`,
      ...unknownHeaders,
      `${request.headers[0][0]}: ${request.headers[0][1]}`,
      "",
      request.body,
    ].join("\r\n");
    expect(Buffer.byteLength(raw)).toBeLessThan(16 * 1024);
    const response = await sendRaw(port, raw);
    expect(response).toContain("503 Service Unavailable");
    expect(response).toContain('{"error":"ACCOUNT_OBSERVATION_PROJECTION_UNAVAILABLE"}');
    expect(calls).toMatchObject({ acquired: 0, ran: 0 });
  });

  it("refuses oversized bodies and closes instead of draining them", async () => {
    const { dispatcher, calls } = createDispatcher();
    const { port } = await start(dispatcher);
    const request = await signedRequest();
    const oversized = `${request.body}${" ".repeat(8_200)}`;
    const declaredTooLarge = await postSigned(port, request, { body: oversized });
    expect(declaredTooLarge.status).toBe(503);
    expect(calls.acquired).toBe(0);

    const streamed = httpRequest({
      host: "127.0.0.1",
      port,
      path: request.path,
      method: "POST",
      agent: false,
      headers: {
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        [request.headers[0][0]]: request.headers[0][1],
        connection: "close",
      },
    });
    clients.add(streamed);
    streamed.on("error", () => undefined);
    streamed.end(oversized);
    for (let i = 0; i < 200 && calls.released === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toMatchObject({ acquired: 1, released: 1, ran: 0 });
  });

  it("applies the one-second body read deadline and releases its lease", async () => {
    const { dispatcher, calls } = createDispatcher();
    const { port } = await start(dispatcher);
    const request = await signedRequest();
    const client = httpRequest({
      host: "127.0.0.1",
      port,
      path: request.path,
      method: "POST",
      agent: false,
      headers: {
        "content-type": "application/json",
        "transfer-encoding": "chunked",
        [request.headers[0][0]]: request.headers[0][1],
        connection: "close",
      },
    });
    clients.add(client);
    client.on("error", () => undefined);
    client.flushHeaders();
    for (let i = 0; i < 200 && calls.released === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.acquired).toBe(1);
    expect(calls.released).toBe(1);
    expect(calls.ran).toBe(0);
  }, 4_000);

  it("rejects unknown routes and Expect requests without invoking the dispatcher", async () => {
    const { dispatcher, calls } = createDispatcher();
    const { port } = await start(dispatcher);
    const unknown = await send(port, "/internal/v1/account-observation/other", { body: "{}" });
    expect(unknown.status).toBe(503);
    const wrongMethod = await send(port, PROJECTION_PATHS.readLatest, { method: "GET" });
    expect(wrongMethod.status).toBe(503);
    const expectContinue = await send(port, PROJECTION_PATHS.readLatest, {
      body: "{}",
      headers: { "content-type": "application/json", expect: "100-continue", connection: "close" },
    });
    expect(expectContinue.status).not.toBe(100);
    expect(calls).toMatchObject({ acquired: 0, ran: 0 });
  });

  it("closes partial-header sockets within the bounded pre-admission phase", async () => {
    const { dispatcher, calls } = createDispatcher();
    const { port } = await start(dispatcher);
    const socket = netConnect(port, "127.0.0.1");
    sockets.add(socket);
    socket.once("error", () => undefined);
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    socket.once("connect", () =>
      socket.write(
        `POST ${PROJECTION_PATHS.readLatest} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n`,
      ),
    );
    let timeout: ReturnType<typeof setTimeout>;
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("partial header socket was not closed")),
          2_500,
        );
      }),
    ]);
    clearTimeout(timeout!);
    expect(calls).toMatchObject({ acquired: 0, ran: 0 });
  }, 3_500);

  it("bounds a dispatcher response that remains pending past the route deadline", async () => {
    const pending = deferred<unknown>();
    const { dispatcher, calls } = createDispatcher(() => pending.promise);
    const { port } = await start(dispatcher);
    const request = await signedRequest();
    const client = httpRequest({
      host: "127.0.0.1",
      port,
      path: request.path,
      method: "POST",
      agent: false,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(request.body),
        [request.headers[0][0]]: request.headers[0][1],
        connection: "close",
      },
    });
    clients.add(client);
    client.end(request.body);
    await new Promise<void>((resolve) => {
      client.once("close", () => resolve());
      client.once("error", () => resolve());
    });
    expect(calls).toMatchObject({ acquired: 1, ran: 1, released: 1 });
    pending.resolve(undefined);
  }, 7_000);
});
