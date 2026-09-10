import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamingObservationSubscriber } from "@/components/trader/account-observation/streaming-subscriber";
import { binding, observation, sse, streamed } from "./account-observation-stream-fixtures";

const endpointPath = "/api/trader/account-observation";
const settle = async () => {
  for (let n = 0; n < 100; n++) await Promise.resolve();
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
function subscribe(fetcher: typeof fetch) {
  const emit = vi.fn();
  const controller = new AbortController();
  const stop = createStreamingObservationSubscriber({ endpointPath, fetcher })(
    binding,
    emit,
    controller.signal,
  );
  return { emit, stop, controller };
}
describe("authenticated fetch SSE and serialized fallback, no external network", () => {
  it("validates split UTF-8 frames and reconnects using the same exact scope", async () => {
    const encoded = new TextEncoder().encode(sse("observation", observation()));
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(encoded.slice(0, 17));
              c.enqueue(encoded.slice(17));
              c.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const { emit, stop } = subscribe(fetcher);
    await settle();
    expect(emit).toHaveBeenCalledWith({ type: "observation", observation: observation() });
    expect(fetcher.mock.calls[0][0]).toBe(`${endpointPath}/stream?${new URLSearchParams(binding)}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
      mode: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "text/event-stream" },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    stop();
  });
  it.each([401, 403])("HTTP%s permanently revokes without fallback", async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status }));
    const { emit } = subscribe(fetcher);
    await settle();
    expect(emit).toHaveBeenCalledWith({ type: "revoked" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("a revoke event stops even when more frames already arrived", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      streamed(sse("revoked", null) + sse("observation", observation())),
    );
    const { emit } = subscribe(fetcher);
    await settle();
    expect(emit).toHaveBeenCalledWith({ type: "revoked" });
    expect(emit.mock.calls.some(([event]) => event.type === "observation")).toBe(false);
  });
  it("falls back to three authenticated polls then retries SSE", async () => {
    let fail = true;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/stream?")) {
        if (fail) {
          fail = false;
          return new Response(null, { status: 503 });
        }
        return streamed(sse("missing", null));
      }
      return Response.json(observation());
    });
    const { emit, stop } = subscribe(fetcher);
    await settle();
    for (let n = 0; n < 4; n++) await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher.mock.calls.map(([input]) => String(input).includes("/stream?"))).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
    expect(emit).toHaveBeenCalledWith({ type: "transport", transport: "POLLING" });
    expect(emit).toHaveBeenCalledWith({ type: "connected" });
    stop();
  });
  it.each(Object.keys(binding) as (keyof typeof binding)[])(
    "never publishes a mismatched %s",
    async (key) => {
      const incoming = observation();
      const fetcher = vi.fn<typeof fetch>(async () =>
        streamed(
          sse("observation", {
            ...incoming,
            binding: {
              ...binding,
              [key]:
                key.endsWith("Id") && key !== "exchangeAccountId"
                  ? "44444444-4444-4444-8444-444444444444"
                  : key === "credentialRevision"
                    ? "2"
                    : "other",
            },
          }),
        ),
      );
      const { emit, stop } = subscribe(fetcher);
      await settle();
      expect(emit.mock.calls.some(([event]) => event.type === "observation")).toBe(false);
      expect(emit).toHaveBeenCalledWith({ type: "error" });
      stop();
    },
  );
  it.each(["raw", "oversize", "truncated", "too-many"])(
    "rejects %s frames with generic error",
    async (kind) => {
      const body =
        kind === "raw"
          ? "private-driver-detail\n\n"
          : kind === "oversize"
            ? "x".repeat(4 * 1024 * 1024 + 1)
            : kind === "truncated"
              ? sse("observation", observation()).slice(0, -1)
              : sse("missing", null).repeat(5);
      const { emit, stop } = subscribe(async () => streamed(body));
      await settle();
      expect(emit).toHaveBeenCalledWith({ type: "error" });
      expect(JSON.stringify(emit.mock.calls)).not.toContain("private-driver-detail");
      stop();
    },
  );
  it("timeout cannot overlap an ignored-abort fetch or publish its late reply", async () => {
    let resolve!: (r: Response) => void;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise((res) => {
          resolve = res;
        }),
    );
    const { emit, stop } = subscribe(fetcher);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    resolve(streamed(sse("observation", observation())));
    await settle();
    expect(emit.mock.calls.some(([event]) => event.type === "observation")).toBe(false);
    stop();
  });
  it("abort cancels a stalled body, clears timers, and ignores late old-scope data", async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const { emit, controller } = subscribe(fetcher);
    await settle();
    controller.abort();
    await settle();
    expect(cancel).toHaveBeenCalledOnce();
    expect(emit.mock.calls.some(([event]) => event.type === "observation")).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
