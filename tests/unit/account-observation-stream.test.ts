import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAccountObservationStream } from "@/lib/trader/account-observation/stream-handler";
import {
  handleAccountObservationGet,
  type ObservationReadDependencies,
} from "@/lib/trader/account-observation/read-handler";
import { binding, observation } from "./account-observation-stream-fixtures";

const request = (signal?: AbortSignal) =>
  new Request(
    "http://localhost/api/trader/account-observation/stream?" + new URLSearchParams(binding),
    { signal },
  );
const dependencies = (): ObservationReadDependencies => ({
  getUserId: vi.fn(async () => "user"),
  hasTraderAccess: vi.fn(async () => true),
  hasOrgMembership: vi.fn(async () => true),
  hasOperatorAccess: vi.fn(async () => true),
  resolveActiveBinding: vi.fn(async () => binding),
  readLatest: vi.fn(async () => observation()),
});
const text = (chunk: ReadableStreamReadResult<Uint8Array>) =>
  chunk.value ? new TextDecoder().decode(chunk.value) : "";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe("bounded SSE uses the real scoped read handler with injected storage/auth", () => {
  it.each(["tenant", "admin"] as const)(
    "%s returns HTTP401 before opening a stream/store",
    async (surface) => {
      const deps = dependencies();
      vi.mocked(deps.getUserId).mockResolvedValue(null);
      const result = await handleAccountObservationStream(request(), (next) =>
        handleAccountObservationGet(next, surface, deps),
      );
      expect(result.status).toBe(401);
      expect(deps.readLatest).not.toHaveBeenCalled();
    },
  );
  it.each(Object.keys(binding) as (keyof typeof binding)[])(
    "rejects a mismatch in %s before streaming",
    async (field) => {
      const deps = dependencies();
      vi.mocked(deps.resolveActiveBinding).mockResolvedValue({
        ...binding,
        [field]:
          field.endsWith("Id") && field !== "exchangeAccountId"
            ? "44444444-4444-4444-8444-444444444444"
            : field === "credentialRevision"
              ? "2"
              : "other",
      });
      const result = await handleAccountObservationStream(request(), (next) =>
        handleAccountObservationGet(next, "admin", deps),
      );
      expect(result.status).toBe(403);
      expect(deps.readLatest).not.toHaveBeenCalled();
    },
  );
  it.each(["getUserId", "hasTraderAccess", "hasOrgMembership", "hasOperatorAccess"] as const)(
    "rechecks %s on the next bounded read",
    async (gate) => {
      const deps = dependencies();
      const response = await handleAccountObservationStream(request(), (next) =>
        handleAccountObservationGet(next, "admin", deps),
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("vary")).toBe("Cookie");
      const reader = response.body!.getReader();
      expect(text(await reader.read())).toContain(observation().observationId);
      if (gate === "getUserId") vi.mocked(deps.getUserId).mockResolvedValue(null);
      else vi.mocked(deps[gate]).mockResolvedValue(false);
      const second = reader.read();
      await vi.advanceTimersByTimeAsync(5000);
      expect(text(await second)).toBe("event: revoked\ndata: null\n\n");
      expect((await reader.read()).done).toBe(true);
      expect(deps.readLatest).toHaveBeenCalledTimes(2);
    },
  );
  it("fences rotation during a subsequent read and never emits the old observation", async () => {
    const deps = dependencies();
    const response = await handleAccountObservationStream(request(), (next) =>
      handleAccountObservationGet(next, "tenant", deps),
    );
    const reader = response.body!.getReader();
    await reader.read();
    vi.mocked(deps.readLatest).mockImplementation(async () => {
      vi.mocked(deps.resolveActiveBinding).mockResolvedValue({
        ...binding,
        credentialRevision: "2",
      });
      return observation();
    });
    const next = reader.read();
    await vi.advanceTimersByTimeAsync(5000);
    expect(text(await next)).toBe("event: revoked\ndata: null\n\n");
    expect((await reader.read()).done).toBe(true);
  });
  it("missing is distinct from an observed zero and stops at four cycles", async () => {
    const load = vi.fn(async () => new Response(null, { status: 204 }));
    const response = await handleAccountObservationStream(request(), load);
    const reader = response.body!.getReader();
    for (let n = 0; n < 3; n++) {
      const next = reader.read();
      if (n) await vi.advanceTimersByTimeAsync(5000);
      expect(text(await next)).toBe("event: missing\ndata: null\n\n");
    }
    expect((await reader.read()).done).toBe(true);
    expect(load).toHaveBeenCalledTimes(4);
  });
  it("slow consumers cause no queued reads and lifetime expires independently", async () => {
    const load = vi.fn(async () => Response.json(observation()));
    const response = await handleAccountObservationStream(request(), load);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect((await response.body!.getReader().read()).done).toBe(true);
    expect(load.mock.calls[0]).toBeDefined();
  });
  it("revocation after preflight but before the first consumer pull exposes no cached snapshot", async () => {
    const deps = dependencies();
    const response = await handleAccountObservationStream(request(), (next) =>
      handleAccountObservationGet(next, "tenant", deps),
    );
    vi.mocked(deps.hasOrgMembership).mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(10_000);
    const reader = response.body!.getReader();
    expect(text(await reader.read())).toBe("event: revoked\ndata: null\n\n");
    expect((await reader.read()).done).toBe(true);
    expect(deps.readLatest).toHaveBeenCalledOnce();
  });
  it("bounds even an initial adapter ignoring abort and cancels its late response", async () => {
    let resolve!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    const cancel = vi.fn();
    const pending = handleAccountObservationStream(request(), (next) => {
      signal = next.signal;
      return new Promise((res) => {
        resolve = res;
      });
    });
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await pending).status).toBe(503);
    expect(signal?.aborted).toBe(true);
    resolve(new Response(new ReadableStream({ cancel })));
    await Promise.resolve();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["request", "consumer"])(
    "%s disconnect aborts current read and suppresses late bytes",
    async (kind) => {
      const abort = new AbortController();
      let resolve!: (response: Response) => void;
      let current: AbortSignal | undefined;
      const load = vi.fn(async (next: Request) => {
        current = next.signal;
        if (load.mock.calls.length <= 2) return Response.json(observation());
        return new Promise<Response>((res) => {
          resolve = res;
        });
      });
      const response = await handleAccountObservationStream(request(abort.signal), load);
      const reader = response.body!.getReader();
      await reader.read();
      const next = reader.read();
      await vi.advanceTimersByTimeAsync(5000);
      if (kind === "request") abort.abort();
      else await reader.cancel();
      expect(current?.aborted).toBe(true);
      expect((await next).done).toBe(true);
      resolve(Response.json(observation()));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(load).toHaveBeenCalledTimes(3);
    },
  );
  it("does not serialize oversized data or private errors", async () => {
    const response = await handleAccountObservationStream(request(), async () =>
      Response.json({ secret: "x".repeat(4 * 1024 * 1024) }),
    );
    const reader = response.body!.getReader();
    expect(text(await reader.read())).toBe("event: error\ndata: null\n\n");
    expect((await reader.read()).done).toBe(true);
  });
});
