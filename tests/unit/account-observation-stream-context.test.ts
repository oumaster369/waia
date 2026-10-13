import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAccountObservationStream } from "@/lib/trader/account-observation/stream-handler";
const request = (signal?: AbortSignal) => new Request("https://synthetic.invalid/api/trader/account-observation/stream", { signal });
const text = (value: ReadableStreamReadResult<Uint8Array>) => new TextDecoder().decode(value.value);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("observation stream request context without retaining authorization", () => {
  it("retains request context on a pull outside its original scope", async () => {
    const context = new AsyncLocalStorage<string>();
    const seen: (string | undefined)[] = [];
    const response = await context.run("request-A", () => handleAccountObservationStream(request(), async () => {
      seen.push(context.getStore());
      if (context.getStore() !== "request-A") throw new Error("MISSING_CONTEXT");
      return new Response(null, { status: 204 });
    }));
    expect(context.getStore()).toBeUndefined();
    const reader = response.body!.getReader();
    expect(text(await reader.read())).toBe("event: missing\ndata: null\n\n");
    expect(seen).toEqual(["request-A", "request-A"]);
    await reader.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("isolates simultaneous request A and B contexts on interleaved outside pulls", async () => {
    const context = new AsyncLocalStorage<string>();
    const seen: string[] = [];
    const open = (id: string) => context.run(id, () => handleAccountObservationStream(request(), async () => {
      expect(context.getStore()).toBe(id);
      seen.push(context.getStore()!);
      return new Response(null, { status: 204 });
    }));
    const a = (await open("A")).body!.getReader();
    const b = (await open("B")).body!.getReader();
    expect(text(await b.read())).toContain("event: missing");
    expect(text(await a.read())).toContain("event: missing");
    expect(seen).toEqual(["A", "B", "B", "A"]);
    await a.cancel(); await b.cancel();
    expect(context.getStore()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("revalidates current permission every read and revokes after a prior good frame", async () => {
    const context = new AsyncLocalStorage<string>();
    let allowed = true;
    const read = vi.fn(async () => {
      expect(context.getStore()).toBe("A");
      return new Response(null, { status: allowed ? 204 : 403 });
    });
    const response = await context.run("A", () => handleAccountObservationStream(request(), read));
    const reader = response.body!.getReader();
    expect(text(await reader.read())).toContain("event: missing");
    allowed = false;
    const next = reader.read();
    await vi.advanceTimersByTimeAsync(5000);
    expect(text(await next)).toBe("event: revoked\ndata: null\n\n");
    expect((await reader.read()).done).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps the original lifetime and abort cleanup without another scoped read", async () => {
    const context = new AsyncLocalStorage<string>();
    const read = vi.fn(async () => {
      expect(context.getStore()).toBe("A");
      return new Response(null, { status: 204 });
    });
    const response = await context.run("A", () => handleAccountObservationStream(request(), read));
    await vi.advanceTimersByTimeAsync(25000);
    expect((await response.body!.getReader().read()).done).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    const abort = new AbortController();
    const cancelled = await context.run("A", () => handleAccountObservationStream(request(abort.signal), read));
    abort.abort();
    expect((await cancelled.body!.getReader().read()).done).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
