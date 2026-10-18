import { afterEach, describe, expect, it, vi } from "vitest";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { createObservationFailureTrace } from "@/lib/trader/account-observation/failure-stage";
import { handleAccountObservationGet } from "@/lib/trader/account-observation/read-handler";
import {
  createProjectionClient,
  type ProjectionClientOptions,
  type ProjectionScope,
} from "@/lib/trader/account-observation/projection-client";
import {
  createProjectionResponse,
  verifyProjectionRequest,
  PROJECTION_PATHS,
  type ProjectionTuple,
} from "@/lib/trader/account-observation/projection-protocol";
import type { AccountObservation, ObservationBinding } from "@/lib/trader/account-observation/types";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";

const NOW = 1_800_000_000_000;
const KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
const TUPLE: ProjectionTuple = Object.freeze({
  audience: "https://observation-reader.waia.life",
  releaseSha: "a".repeat(40),
  epochId: "00000000-0000-4000-8000-000000000010",
  keyId: "test-key-1",
});
const SCOPE: ProjectionScope = Object.freeze({
  organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002",
  exchangeAccountId: "account-a",
});
const BINDING: ObservationBinding = Object.freeze({ ...SCOPE, credentialRevision: "1", configurationRevision: "cfg-1" });
const OBSERVATION: AccountObservation = Object.freeze({
  schemaVersion: "account-observation/v1",
  observationId: "00000000-0000-4000-8000-000000000003",
  binding: BINDING,
  collectionStartedAtMs: NOW,
  collectionCompletedAtMs: NOW + 20,
  status: "COMPLETE",
  balances: Object.freeze({ status: "COMPLETE", values: Object.freeze([{ asset: "USDT", free: "1", locked: "0", total: "1" }]),
    sourceAsOfMs: null, readStartedAtMs: NOW, readCompletedAtMs: NOW + 10, error: null }),
  holdings: Object.freeze([{ asset: "USDT", free: "1", locked: "0", total: "1" }]),
  openOrders: Object.freeze({ status: "COMPLETE", values: Object.freeze([]), sourceAsOfMs: null,
    readStartedAtMs: NOW, readCompletedAtMs: NOW + 10, error: null }),
  trades: Object.freeze([{ symbol: "BTCUSDT", component: Object.freeze({ status: "COMPLETE", values: Object.freeze([]),
    sourceAsOfMs: null, readStartedAtMs: NOW, readCompletedAtMs: NOW + 10, error: null }) }]),
});

function options(fetch: typeof globalThis.fetch, overrides: Partial<ProjectionClientOptions> = {}): ProjectionClientOptions {
  return {
    fetch,
    clock: () => NOW,
    tuple: TUPLE,
    keyBytes: KEY,
    accessClientId: "synthetic-access-id",
    accessClientSecret: "synthetic-access-secret",
    deadlineMs: NOW + 5_000,
    ...overrides,
  };
}

async function responseFor(request: RequestInfo | URL, init: RequestInit | undefined,
  data: ObservationBinding | AccountObservation | null = BINDING,
  mutate?: (response: { status: number; headers: [string, string][]; body: string }) => void): Promise<Response> {
  const url = new URL(String(request));
  const headers = init?.headers as Record<string, string>;
  const verified = await verifyProjectionRequest({
    method: init?.method,
    path: url.pathname,
    headers: [["x-waia-projection-signature", headers["x-waia-projection-signature"]]],
    body: init?.body,
  }, { expectedTuple: TUPLE, keyBytes: KEY, clock: () => NOW });
  const signed = await createProjectionResponse(verified, data, KEY);
  const result = { status: signed.status, headers: [...signed.headers] as [string, string][], body: signed.body };
  mutate?.(result);
  return new Response(result.body, { status: result.status, headers: {
    "content-type": "application/json",
    ...Object.fromEntries(result.headers),
  } });
}

afterEach(() => vi.useRealTimers());

describe("DEE-1243 shared projection deadline classification", () => {
  it.each(["FETCH", "BODY"] as const)("retains %s TIMEOUT when the original deadline precedes the handler timer", async phase => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const sink = vi.fn(), trace = createObservationFailureTrace(sink, Date.now);
    let markPhase!: () => void, resolveFetch!: (response: Response) => void;
    const phaseStarted = new Promise<void>(resolve => { markPhase = resolve; });
    const cancel = vi.fn();
    const fetcher: typeof fetch = vi.fn(() => {
      if (phase === "FETCH") return new Promise<Response>(resolve => { resolveFetch = resolve; markPhase(); });
      const stream = new ReadableStream<Uint8Array>({
        pull() { markPhase(); return new Promise<void>(() => undefined); }, cancel,
      }, { highWaterMark: 0 });
      return Promise.resolve(new Response(stream, { headers: {
        "content-type": "application/json", "x-waia-projection-signature": "0".repeat(64),
      } }));
    });
    const client = createProjectionClient(options(fetcher, { clock: Date.now, failureTrace: trace }));
    await vi.advanceTimersByTimeAsync(200);
    const pending = handleAccountObservationGet(new Request("https://local.invalid/observation?" + new URLSearchParams(BINDING)), "tenant", {
      failureTrace: trace, getUserId: async () => "synthetic-user", hasTraderAccess: async () => true,
      hasOrgMembership: async () => true, hasOperatorAccess: async () => true, isAdminListedOrganization: async () => true,
      resolveActiveBinding: ({ organizationId, credentialId, exchangeAccountId }, _userId, signal) =>
        client.resolveActiveBinding({ organizationId, credentialId, exchangeAccountId }, signal), readLatest: vi.fn(),
    });
    await Promise.race([phaseStarted, pending.then(response => { throw new Error(`synthetic early handler status ${response.status}`); })]);
    await vi.advanceTimersByTimeAsync(4800);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ACCOUNT_OBSERVATION_UNAVAILABLE" });
    expect(Date.now()).toBe(NOW + 5000);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual({ event: "ACCOUNT_OBSERVATION_FAILURE", stage: `PROJECTION_${phase}`, outcome: "TIMEOUT", elapsedMs: 5000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0][1]?.body)).deadlineMs).toBe(NOW + 5000);
    expect(vi.mocked(fetcher).mock.calls[0][1]?.signal?.aborted).toBe(true);
    if (phase === "FETCH") resolveFetch(new Response(new ReadableStream<Uint8Array>({ cancel })));
    await vi.advanceTimersByTimeAsync(200);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledTimes(1);
    client.dispose();
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps an earlier caller abort as THREW even after the deadline passes", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const caller = new AbortController(), sink = vi.fn(), trace = createObservationFailureTrace(sink, Date.now);
    let markCalled!: () => void;
    const called = new Promise<void>(resolve => { markCalled = resolve; });
    const fetcher: typeof fetch = vi.fn(() => { markCalled(); return new Promise<Response>(() => undefined); });
    const client = createProjectionClient(options(fetcher, { clock: Date.now, failureTrace: trace }));
    const rejected = expect(client.resolveActiveBinding(SCOPE, caller.signal)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    await called; await vi.advanceTimersByTimeAsync(100); caller.abort(); await rejected;
    await vi.advanceTimersByTimeAsync(4900); trace.report("THREW");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toMatchObject({ stage: "PROJECTION_FETCH", outcome: "THREW" });
    expect(fetcher).toHaveBeenCalledTimes(1); client.dispose();
  });

  it("keeps a genuine fetch rejection as THREW and clears the deadline timer", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const sink = vi.fn(), trace = createObservationFailureTrace(sink, Date.now);
    const fetcher: typeof fetch = vi.fn(async () => { throw new Error("synthetic-private-error-canary"); });
    const client = createProjectionClient(options(fetcher, { clock: Date.now, failureTrace: trace }));
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    await vi.advanceTimersByTimeAsync(5000); trace.report("THREW");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toMatchObject({ stage: "PROJECTION_FETCH", outcome: "THREW" });
    expect(JSON.stringify(sink.mock.calls)).not.toContain("canary");
    expect(fetcher).toHaveBeenCalledTimes(1); client.dispose();
  });
});

describe("account observation projection client", () => {
  it("uses workerd-supported Request construction for both signed operations", async () => {
    // Installed workerd rejects the error redirect mode before any subrequest.
    const fetcher: typeof fetch = vi.fn(async (request, init) => {
      if (init?.redirect !== "manual" && init?.redirect !== "follow") {
        throw new TypeError("SYNTHETIC_WORKER_REDIRECT_REJECTION");
      }
      expect(new Request(request, init).redirect).toBe("manual");
      return responseFor(request, init,
        new URL(String(request)).pathname === PROJECTION_PATHS.readLatest ? OBSERVATION : BINDING);
    });
    const client = createProjectionClient(options(fetcher));
    try {
      await expect(client.resolveActiveBinding(SCOPE)).resolves.toEqual(BINDING);
      await expect(client.readLatest(BINDING)).resolves.toEqual(OBSERVATION);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { client.dispose(); }
  });

  it.each([301, 302, 303, 307, 308])("refuses redirect %s, cancels its body and never follows for either operation", async status => {
    for (const operation of ["resolveBinding", "readLatest"] as const) {
      const cancel = vi.fn();
      const fetcher: typeof fetch = vi.fn(async (_request, init) => {
        expect(init?.redirect).toBe("manual");
        return new Response(new ReadableStream<Uint8Array>({ cancel }), {
          status, headers: { location: "https://redirect-canary.invalid/private" },
        });
      });
      const client = createProjectionClient(options(fetcher));
      try {
        await expect(operation === "resolveBinding" ? client.resolveActiveBinding(SCOPE) : client.readLatest(BINDING))
          .rejects.toThrow("PROJECTION_UNAVAILABLE");
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledTimes(1);
      } finally { client.dispose(); }
    }
  });

  it("uses only the fixed POST paths with no-store, redirect refusal, HMAC and Access service headers", async () => {
    expect(parseAccountObservation(OBSERVATION)).toEqual(OBSERVATION);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher: typeof fetch = vi.fn(async (request, init) => {
      calls.push({ url: String(request), init: init! });
      return responseFor(request, init, new URL(String(request)).pathname === PROJECTION_PATHS.readLatest ? OBSERVATION : BINDING);
    });
    const client = createProjectionClient(options(fetcher));

    await expect(client.resolveActiveBinding(SCOPE)).resolves.toEqual(BINDING);
    await expect(client.readLatest(BINDING)).resolves.toEqual(OBSERVATION);

    expect(calls.map(({ url }) => url)).toEqual([
      `https://observation-reader.waia.life${PROJECTION_PATHS.resolveBinding}`,
      `https://observation-reader.waia.life${PROJECTION_PATHS.readLatest}`,
    ]);
    for (const { init } of calls) {
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("manual");
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers).toMatchObject({
        "content-type": "application/json",
        "CF-Access-Client-Id": "synthetic-access-id",
        "CF-Access-Client-Secret": "synthetic-access-secret",
      });
      expect((init.headers as Record<string, string>)["x-waia-projection-signature"]).toMatch(/^[0-9a-f]{64}$/);
      expect(new URL(String(calls[0].url)).search).toBe("");
    }
  });

  it.each(["resolveBinding", "readLatest"] as const)(
    "requests an identity representation when the endpoint negotiates compression for %s",
    async (operation) => {
      const representations: string[] = [];
      const expected = operation === "resolveBinding" ? BINDING : OBSERVATION;
      const fetcher: typeof fetch = vi.fn(async (request, init) => {
        const signed = await responseFor(request, init, expected);
        const representation = new Headers(init?.headers).get("accept-encoding") === "identity"
          ? "identity" : "gzip";
        representations.push(representation);
        const body = await signed.arrayBuffer();
        return new Response(representation === "identity" ? body : Uint8Array.from(gzipSync(Buffer.from(body))), {
          status: signed.status,
          headers: { ...Object.fromEntries(signed.headers), "content-encoding": representation },
        });
      });
      const client = createProjectionClient(options(fetcher));
      try {
        const result = operation === "resolveBinding"
          ? client.resolveActiveBinding(SCOPE) : client.readLatest(BINDING);
        await expect(result).resolves.toEqual(expected);
        expect(representations).toEqual(["identity"]);
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally { client.dispose(); }
    },
  );

  it.each(["resolveBinding", "readLatest"] as const)(
    "accepts retained gzip metadata over an automatically decoded signed body for %s",
    async (operation) => {
      const fetcher: typeof fetch = vi.fn(async (request, init) => {
        expect(new Headers(init?.headers).get("accept-encoding")).toBe("identity");
        const signed = await responseFor(request, init, operation === "resolveBinding" ? BINDING : OBSERVATION);
        // Workerd Fetch can decode the stream while preserving the original header.
        signed.headers.set("content-encoding", "gzip");
        return signed;
      });
      const client = createProjectionClient(options(fetcher));
      try {
        const result = operation === "resolveBinding"
          ? client.resolveActiveBinding(SCOPE) : client.readLatest(BINDING);
        await expect(result).resolves.toEqual(operation === "resolveBinding" ? BINDING : OBSERVATION);
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally { client.dispose(); }
    },
  );

  it("refuses invalid, expired or already aborted calls before fetch", async () => {
    const fetcher = vi.fn(async () => new Response(null));
    expect(() => createProjectionClient(options(fetcher, { tuple: { ...TUPLE, audience: "https://elsewhere.example" } })))
      .toThrow("PROJECTION_CLIENT_CONFIG");
    expect(() => createProjectionClient(options(fetcher, { deadlineMs: NOW }))).toThrow("PROJECTION_CLIENT_CONFIG");
    const oversizedAuth = createProjectionClient(options(fetcher, { accessClientSecret: "s".repeat(20 * 1024) }));
    await expect(oversizedAuth.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    const aborted = new AbortController();
    aborted.abort();
    const client = createProjectionClient(options(fetcher, { signal: aborted.signal }));
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    await expect(client.resolveActiveBinding({ ...SCOPE, unexpected: true } as ProjectionScope))
      .rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("disposes the client key and prevents later fetches", async () => {
    const fetcher = vi.fn(async () => new Response(null));
    const client = createProjectionClient(options(fetcher));
    client.dispose();
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the construction-time client signal when the caller mutates its options object", async () => {
    const clientAbort = new AbortController();
    const replacementAbort = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    let markCalled!: () => void;
    const fetchCalled = new Promise<void>((resolve) => { markCalled = resolve; });
    const fetcher: typeof fetch = vi.fn((_request, init) => {
      fetchSignal = init?.signal as AbortSignal;
      markCalled();
      return new Promise<Response>(() => undefined);
    });
    const mutableOptions = options(fetcher, { signal: clientAbort.signal }) as
      Omit<ProjectionClientOptions, "signal"> & { signal?: AbortSignal };
    const client = createProjectionClient(mutableOptions);
    mutableOptions.signal = replacementAbort.signal;

    const pending = client.resolveActiveBinding(SCOPE);
    await fetchCalled;
    clientAbort.abort();
    const rejectedFromOriginalSignal = await Promise.race([
      pending.then(() => true, () => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    replacementAbort.abort();

    expect(rejectedFromOriginalSignal).toBe(true);
    await expect(pending).rejects.toThrow("PROJECTION_UNAVAILABLE");
    expect(fetchSignal?.aborted).toBe(true);
  });

  it("rejects redirects and malformed or duplicate security headers", async () => {
    const redirectClient = createProjectionClient(options(vi.fn(async () => new Response("", { status: 302,
      headers: { location: "https://elsewhere.example" } }))));
    await expect(redirectClient.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");

    const badTypeClient = createProjectionClient(options(vi.fn(async (request, init) =>
      new Response((await responseFor(request, init)).body, { status: 200,
        headers: { "content-type": "text/plain", "x-waia-projection-signature": "0".repeat(64) } }))));
    await expect(badTypeClient.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");

    const duplicateClient = createProjectionClient(options(vi.fn(async (request, init) =>
      new Response((await responseFor(request, init)).body, { status: 200, headers: [
        ["content-type", "application/json"], ["x-waia-projection-signature", "0".repeat(64)],
        ["x-waia-projection-signature", "1".repeat(64)],
      ] }))));
    await expect(duplicateClient.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
  });

  it("rejects wrong tuple, signature and binding scope responses", async () => {
    const wrongTuple = createProjectionClient(options(vi.fn(async (request, init) =>
      responseFor(request, init, BINDING, (response) => {
        const envelope = JSON.parse(response.body) as Record<string, unknown>;
        envelope.tuple = { ...TUPLE, epochId: "00000000-0000-4000-8000-000000000011" };
        response.body = JSON.stringify(envelope);
      }))));
    await expect(wrongTuple.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");

    const wrongSignature = createProjectionClient(options(vi.fn(async (request, init) =>
      responseFor(request, init, BINDING, (response) => { response.headers[0][1] = "0".repeat(64); }))));
    await expect(wrongSignature.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");

    const wrongScope = createProjectionClient(options(vi.fn(async (request, init) =>
      responseFor(request, init, { ...BINDING, organizationId: "00000000-0000-4000-8000-000000000099" }))));
    await expect(wrongScope.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
  });

  it("accepts a signed empty snapshot as null", async () => {
    const client = createProjectionClient(options(vi.fn(async (request, init) => responseFor(request, init, null))));
    await expect(client.resolveActiveBinding(SCOPE)).resolves.toBeNull();
  });

  it("keeps the original deadline across consecutive operations", async () => {
    let now = NOW;
    const deadlines: number[] = [];
    const fetcher: typeof fetch = vi.fn(async (request, init) => {
      const body = JSON.parse(String(init?.body)) as { deadlineMs: number };
      deadlines.push(body.deadlineMs);
      const response = await responseFor(request, init, BINDING);
      if (deadlines.length === 1) now = NOW + 4_000;
      else now = NOW + 5_001;
      return response;
    });
    const client = createProjectionClient(options(fetcher, { clock: () => now }));
    await expect(client.resolveActiveBinding(SCOPE)).resolves.toEqual(BINDING);
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    expect(deadlines).toEqual([NOW + 5_000, NOW + 5_000]);
  });

  it("rejects an over-limit streamed envelope and cancels its stream", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(12 * 1024 * 1024 + 1)); },
      cancel() { canceled = true; },
    });
    const client = createProjectionClient(options(vi.fn(async (request, init) => {
      const signed = await responseFor(request, init);
      return new Response(stream, { status: 200, headers: signed.headers });
    })));
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    expect(canceled).toBe(true);
  });

  it("cancels a response stream on caller abort", async () => {
    const caller = new AbortController();
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() { return new Promise<void>(() => undefined); },
      cancel() { canceled = true; },
    });
    const fetcher: typeof fetch = vi.fn(async (request, init) => {
      const signed = await responseFor(request, init);
      setTimeout(() => caller.abort(), 0);
      return new Response(stream, { status: 200, headers: signed.headers });
    });
    const client = createProjectionClient(options(fetcher));
    await expect(client.resolveActiveBinding(SCOPE, caller.signal)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    expect(canceled).toBe(true);
  });

  it("detaches from a fetch implementation that resolves after abort and cleans up its late response", async () => {
    const caller = new AbortController();
    let resolveFetch!: (response: Response) => void;
    let canceled = false;
    let markCalled!: () => void;
    const fetchCalled = new Promise<void>((resolve) => { markCalled = resolve; });
    const fetcher: typeof fetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
      markCalled();
    }));
    const client = createProjectionClient(options(fetcher));
    const pending = client.resolveActiveBinding(SCOPE, caller.signal);
    await fetchCalled;
    caller.abort();
    await expect(pending).rejects.toThrow("PROJECTION_UNAVAILABLE");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { canceled = true; },
    });
    resolveFetch(new Response(stream));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(canceled).toBe(true);
  });
});


describe("DEE-1243 decoded Fetch representation and finite failure phases", () => {
  it.each(["gzip", "br"])("reads a decoded signed body once despite retained %s metadata", async encoding => {
    const fetcher: typeof fetch = vi.fn(async (request, init) => {
      const response = await responseFor(request, init);
      response.headers.set("content-encoding", encoding);
      return response;
    });
    const client = createProjectionClient(options(fetcher));
    await expect(client.resolveActiveBinding(SCOPE)).resolves.toEqual(BINDING);
    expect(fetcher).toHaveBeenCalledTimes(1); client.dispose();
  });

  it.each(["gzip", "br"])("never decompresses genuinely compressed %s bytes again", async encoding => {
    const fetcher: typeof fetch = vi.fn(async (request, init) => {
      const signed = await responseFor(request, init); const text = await signed.text();
      const bytes = encoding === "gzip" ? gzipSync(Buffer.from(text)) : brotliCompressSync(Buffer.from(text));
      return new Response(Uint8Array.from(bytes), { headers: { ...Object.fromEntries(signed.headers), "content-encoding": encoding } });
    });
    const client = createProjectionClient(options(fetcher));
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    expect(fetcher).toHaveBeenCalledTimes(1); client.dispose();
  });

  it.each(["deflate", "gzip, br", "gzip, gzip", "", "GZIP"])("refuses unknown/combined encoding %s", async encoding => {
    const client = createProjectionClient(options(async (request, init) => {
      const response = await responseFor(request, init); response.headers.set("content-encoding", encoding); return response;
    }));
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE"); client.dispose();
  });

  it.each(["fetch", "status", "representation", "body", "mac"])("records only the fixed %s failure phase", async failure => {
    const sink = vi.fn(), trace = createObservationFailureTrace(sink, () => NOW);
    const fetcher: typeof fetch = vi.fn(async (request, init) => {
      if (failure === "fetch") throw new Error("private-fetch-cookie-canary");
      const signed = await responseFor(request, init);
      if (failure === "status") return new Response("private-body-canary", { status: 403 });
      if (failure === "representation") signed.headers.set("content-encoding", "deflate");
      if (failure === "body") return new Response(Uint8Array.from([255]), { headers: signed.headers });
      if (failure === "mac") signed.headers.set("x-waia-projection-signature", "0".repeat(64));
      return signed;
    });
    const client = createProjectionClient(options(fetcher, { failureTrace: trace }));
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    trace.enter("PROJECTION_REQUEST"); trace.report("THREW"); trace.report("THREW");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual({ event: "ACCOUNT_OBSERVATION_FAILURE", stage: `PROJECTION_${failure.toUpperCase()}`, outcome: failure === "status" ? "HTTP_403" : "THREW", elapsedMs: 0 });
    expect(JSON.stringify(sink.mock.calls)).not.toContain("canary"); client.dispose();
  });

  it("still caps decoded bytes before signature verification with compressed metadata", async () => {
    const client = createProjectionClient(options(async () => new Response("x".repeat(12 * 1024 * 1024 + 1), {
      headers: { "content-type": "application/json", "content-encoding": "br", "x-waia-projection-signature": "0".repeat(64) },
    })));
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE"); client.dispose();
  });
});


it.each([[401, "HTTP_401"], [403, "HTTP_403"], [404, "HTTP_404"], [502, "HTTP_5XX"], [429, "HTTP_OTHER"]] as const)(
  "DEE-1243 reports non200 %i as finite %s outcome", async (status, outcome) => {
    const sink = vi.fn(), trace = createObservationFailureTrace(sink, () => NOW);
    const client = createProjectionClient(options(async () => new Response("private-response-canary", { status }), { failureTrace: trace }));
    await expect(client.resolveActiveBinding(SCOPE)).rejects.toThrow("PROJECTION_UNAVAILABLE");
    trace.report("THREW"); expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toEqual({ event: "ACCOUNT_OBSERVATION_FAILURE", stage: "PROJECTION_STATUS", outcome, elapsedMs: 0 });
    client.dispose();
  },
);
