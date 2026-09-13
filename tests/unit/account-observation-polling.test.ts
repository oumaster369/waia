import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountObservation,
  ObservationBinding,
} from "@/lib/trader/account-observation/types";
import { createPollingObservationSubscriber } from "@/components/trader/account-observation/polling-subscriber";

const binding: ObservationBinding = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  credentialId: "22222222-2222-4222-8222-222222222222",
  exchangeAccountId: "account-a",
  credentialRevision: "1",
  configurationRevision: "1",
};
function observation(): AccountObservation {
  const empty = {
    status: "COMPLETE" as const,
    values: [],
    error: null,
    sourceAsOfMs: 100,
    readStartedAtMs: 100,
    readCompletedAtMs: 101,
  };
  return {
    schemaVersion: "account-observation/v1",
    observationId: "33333333-3333-4333-8333-333333333333",
    binding,
    collectionStartedAtMs: 100,
    collectionCompletedAtMs: 101,
    status: "COMPLETE",
    balances: empty,
    openOrders: empty,
    holdings: [],
    trades: [{ symbol: "BTCUSDT", component: empty }],
  };
}
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
const stops: (() => void)[] = [];
function start(fetcher: typeof fetch) {
  const emit = vi.fn();
  const abort = new AbortController();
  const subscribe = createPollingObservationSubscriber({
    endpointPath: "/api/test-observation",
    fetcher,
    intervalMs: 1000,
    requestTimeoutMs: 1000,
    maxBackoffMs: 4000,
  });
  const stop = subscribe(binding, emit, abort.signal);
  stops.push(stop);
  return { emit, abort, stop };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});

describe("DEE-961 same-origin polling adapter (fake fetch only)", () => {
  it("requests exact scope with cookie auth/no caching and emits strict projection automatically", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(observation()));
    const { emit } = start(fetcher);
    await settle();
    expect(emit).toHaveBeenCalledWith({ type: "observation", observation: observation() });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain("organizationId=11111111");
    expect(String(url)).toContain("credentialRevision=1");
    expect(init).toMatchObject({
      method: "GET",
      credentials: "same-origin",
      mode: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403])("treats HTTP %s as terminal access loss", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    const { emit } = start(fetcher);
    await settle();
    expect(emit).toHaveBeenCalledWith({ type: "revoked" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not replace missing data with zero on HTTP 204", async () => {
    const { emit } = start(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await settle();
    expect(emit.mock.calls).toEqual([[{ type: "connected" }]]);
  });
  it.each(["binding", "raw", "malformed"])(
    "rejects %s payload without leaking it",
    async (mode) => {
      const body =
        mode === "binding"
          ? { ...observation(), binding: { ...binding, credentialRevision: "2" } }
          : mode === "raw"
            ? { ...observation(), rawSecret: "must-not-escape" }
            : { ok: true };
      const { emit } = start(vi.fn<typeof fetch>().mockResolvedValue(response(body)));
      await settle();
      expect(emit.mock.calls).toEqual([[{ type: "error" }]]);
    },
  );
  it("backs off retryable failure and recovers after success", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("private-diagnostic"))
      .mockResolvedValueOnce(response(observation()));
    const { emit } = start(fetcher);
    await settle();
    expect(emit.mock.calls).toEqual([[{ type: "error" }]]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith({ type: "observation", observation: observation() });
  });
  it("times out without overlap and ignores late fetch after abort", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise((res) => {
          resolve = res;
        }),
    );
    const { emit, stop } = start(fetcher);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(emit.mock.calls).toEqual([[{ type: "error" }]]);
    stop();
    resolve(response(observation()));
    await settle();
    expect(emit.mock.calls).toEqual([[{ type: "error" }]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels an active response body on unsubscribe", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } }));
    const { emit, abort } = start(fetcher);
    await settle();
    abort.abort();
    await settle();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects oversized body with bounded buffering", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
      },
      cancel,
    });
    const { emit } = start(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } })),
    );
    await settle();
    expect(emit.mock.calls).toEqual([[{ type: "error" }]]);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each([
    "https://outside.test/api/read",
    "//outside.test/api/read",
    "/api/read?token=secret",
    "/api/../auth",
    "/api/%2e%2e/auth",
  ])("rejects unsafe endpoint %s before fetch", (endpointPath) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createPollingObservationSubscriber({ endpointPath, fetcher })).toThrow(
      "INVALID_TRANSPORT_CONFIG",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not start an already cancelled subscription", () => {
    const fetcher = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort();
    const subscribe = createPollingObservationSubscriber({
      endpointPath: "/api/test-observation",
      fetcher,
    });
    subscribe(binding, vi.fn(), controller.signal);
    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
