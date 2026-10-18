// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createObservationResponseBodyOwner, settleObservationResponseBody } from "@/lib/trader/account-observation/response-body-settlement";

describe("owned observation response-body settlement", () => {
  it("settles a native body already errored before ownership acquisition", async () => {
    const failure = new Error("synthetic body error");
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.error(failure); }, cancel });
    await expect(settleObservationResponseBody(body)).resolves.toBeUndefined();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("settles a native body that errors while its private reader is reading", async () => {
    const failure = new Error("synthetic body error");
    const cancel = vi.fn();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel });
    const owner = createObservationResponseBodyOwner(body);
    const read = owner.read();
    controller.error(failure);
    await expect(read).rejects.toBe(failure);
    await expect(owner.settled()).resolves.toBeUndefined();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("retains failed underlying cancellation even after native cancellation closes the stream", async () => {
    const failure = new Error("synthetic cancellation failure");
    const cancel = vi.fn(() => { throw failure; });
    const owner = createObservationResponseBodyOwner(new ReadableStream<Uint8Array>({ cancel }));
    const read = owner.read();
    const work = owner.settled();
    await expect(work).rejects.toBe(failure);
    await expect(read).resolves.toMatchObject({ done: true });
    expect(owner.settled()).toBe(work);
    await expect(owner.settled()).rejects.toBe(failure);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("retains an underlying cancellation that remains pending after the stream closes", async () => {
    let finish!: () => void;
    const cancel = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const owner = createObservationResponseBodyOwner(new ReadableStream<Uint8Array>({ cancel }));
    const read = owner.read();
    let settled = false;
    const work = owner.settled();
    void work.then(() => { settled = true; });
    await expect(read).resolves.toMatchObject({ done: true });
    expect(settled).toBe(false);
    expect(owner.settled()).toBe(work);
    expect(cancel).toHaveBeenCalledOnce();
    finish(); await work;
    expect(settled).toBe(true);
  });

  it("cannot accept a released reader after the same body is relocked", async () => {
    const body = new ReadableStream<Uint8Array>();
    const released = body.getReader();
    void released.closed.catch(() => {});
    released.releaseLock();
    const current = body.getReader();
    expect(() => createObservationResponseBodyOwner(body)).toThrow();
    // @ts-expect-error A caller-provided reader is not part of the cleanup API.
    await expect(settleObservationResponseBody(body, released)).rejects.toThrow();
    expect(body.locked).toBe(true);
    await current.cancel();
  });

  it("cannot substitute an unrelated errored reader for the body's cancellation obligation", async () => {
    const unrelated = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error("unrelated")); } }).getReader();
    void unrelated.closed.catch(() => {});
    const failure = new Error("actual body cancellation failure");
    const cancel = vi.fn(() => { throw failure; });
    const body = new ReadableStream<Uint8Array>({ cancel });
    // @ts-expect-error A caller-provided reader is not part of the cleanup API.
    await expect(settleObservationResponseBody(body, unrelated)).rejects.toBe(failure);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bypasses a native body's overridden getReader returning an unrelated errored reader", async () => {
    const unrelated = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error("unrelated")); } }).getReader();
    void unrelated.closed.catch(() => {});
    const failure = new Error("actual body cancellation failure");
    const cancel = vi.fn(() => { throw failure; });
    const body = new ReadableStream<Uint8Array>({ cancel });
    const getReader = vi.fn(() => unrelated);
    Object.defineProperty(body, "getReader", { value: getReader });
    const owner = createObservationResponseBodyOwner(body);
    expect(body.locked).toBe(true);
    await expect(owner.settled()).rejects.toBe(failure);
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("exposes only frozen read and settlement capabilities with no reader release or substitution", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const owner = createObservationResponseBodyOwner(body);
    expect(Object.keys(owner).sort()).toEqual(["read", "settled"]);
    expect(Object.isFrozen(owner)).toBe(true);
    expect(owner).not.toHaveProperty("reader");
    expect(owner).not.toHaveProperty("releaseLock");
    expect(() => body.getReader()).toThrow();
    await owner.settled.call({ body: new ReadableStream<Uint8Array>() });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not accept a structural reader's fabricated closed rejection as native settlement", async () => {
    const closed = Promise.reject(new Error("synthetic closed"));
    void closed.catch(() => {});
    const failure = new Error("synthetic cancellation failure");
    const reader = { closed, read: vi.fn(), cancel: vi.fn(async () => { throw failure; }) };
    const body = { getReader: () => reader } as unknown as ReadableStream<Uint8Array>;
    await expect(settleObservationResponseBody(body)).rejects.toBe(failure);
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("settles an absent body and a fully consumed native body", async () => {
    await expect(settleObservationResponseBody(null)).resolves.toBeUndefined();
    const owner = createObservationResponseBodyOwner(new ReadableStream<Uint8Array>({ start(c) { c.close(); } }));
    await owner.read();
    await expect(owner.settled()).resolves.toBeUndefined();
  });
});
