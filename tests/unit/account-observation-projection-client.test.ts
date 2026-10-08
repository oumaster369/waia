import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("account observation projection client", () => {
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
      expect(init.redirect).toBe("error");
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
