import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectionDispatcher } from "@/lib/trader/account-observation/projection-dispatcher";
import { createProjectionRequest, verifyProjectionRequest, verifyProjectionResponse, type ProjectionOperation } from "@/lib/trader/account-observation/projection-protocol";
import { binding, observation } from "./account-observation-stream-fixtures";

const tuple = { audience: "https://observation-reader.waia.life", releaseSha: "a".repeat(40),
  epochId: "11111111-1111-4111-8111-111111111111", keyId: "isolated-test" };
const key = new Uint8Array(32).fill(9);
const scope = { organizationId: binding.organizationId, credentialId: binding.credentialId, exchangeAccountId: binding.exchangeAccountId };
let wall: number;
let mono: number;
let serial: number;
const dispatchers: ReturnType<typeof createProjectionDispatcher>[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function create(reader = {
  resolveActiveBinding: vi.fn(async () => binding), readLatest: vi.fn(async () => observation()),
}) {
  const dispatcher = createProjectionDispatcher({ tuple, keyBytes: key, reader,
    wallClock: () => wall, monotonicClock: () => mono });
  dispatchers.push(dispatcher);
  return { dispatcher, reader };
}
async function advance(ms: number) {
  wall += ms; mono += ms;
  await vi.advanceTimersByTimeAsync(ms);
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 1000 && !predicate(); i++) await new Promise<void>(r => setImmediate(r));
  expect(predicate()).toBe(true);
}
async function request(operation: ProjectionOperation = "readLatest", issued = wall, deadline = issued + 5000, id?: string) {
  return createProjectionRequest({ operation, tuple,
    requestId: id ?? `aaaaaaaa-aaaa-4aaa-8aaa-${(++serial).toString(16).padStart(12, "0")}`,
    issuedAtMs: issued, deadlineMs: deadline,
    payload: operation === "readLatest" ? binding : scope }, key);
}
beforeEach(() => {
  wall = 1_800_000_000_000; mono = 0; serial = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(() => { for (const d of dispatchers.splice(0)) d.stop(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("projection dispatcher lifetime and concurrency", () => {
  it("quarantines boot, fences pre-floor requests, and signs canonical reader results", async () => {
    const snapshot = observation();
    const { dispatcher, reader } = create({ resolveActiveBinding: vi.fn(async () => binding),
      readLatest: vi.fn(async () => snapshot) });
    expect(dispatcher.status().ready).toBe(false);
    expect(() => dispatcher.acquire()).toThrow();
    await advance(10_000);
    expect(dispatcher.status().ready).toBe(true);
    const old = dispatcher.acquire();
    await expect(old.run(await request("readLatest", wall - 1, wall + 4999))).rejects.toThrow();
    old.release();
    expect(reader.readLatest).not.toHaveBeenCalled();
    for (const op of ["resolveBinding", "readLatest"] as const) {
      const raw = await request(op);
      const lease = dispatcher.acquire();
      const response = await lease.run(raw);
      const context = await verifyProjectionRequest(raw, { expectedTuple: tuple, keyBytes: key, clock: () => wall });
      expect(await verifyProjectionResponse(response, context, { expectedTuple: tuple, keyBytes: key, clock: () => wall }))
        .toEqual(op === "readLatest" ? snapshot : binding);
      expect(dispatcher.status().httpRequests).toBe(1); // response finish belongs to HTTP owner
      lease.release();
    }
  });

  it("shares atomic nonce consumption across methods and refuses concurrent replay before SQL", async () => {
    const { dispatcher, reader } = create();
    await advance(10_000);
    const id = "ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF";
    const raw = await request("resolveBinding", wall, wall + 5000, id);
    const leases = [dispatcher.acquire(), dispatcher.acquire()];
    const outcomes = await Promise.allSettled(leases.map(l => l.run(raw)));
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(reader.resolveActiveBinding).toHaveBeenCalledTimes(1);
    leases.forEach(l => l.release());
    const next = dispatcher.acquire();
    await expect(next.run(await request("readLatest", wall, wall + 5000, id.toLowerCase()))).rejects.toThrow();
    expect(reader.readLatest).not.toHaveBeenCalled();
    next.release();
  });

  it("holds one active query and three FIFO slots while four response leases limit admission", async () => {
    const pending = Array.from({ length: 4 }, () => deferred<ReturnType<typeof observation>>());
    let calls = 0;
    const { dispatcher } = create({ resolveActiveBinding: vi.fn(async () => binding),
      readLatest: vi.fn(() => pending[calls++].promise) });
    await advance(10_000);
    const leases = Array.from({ length: 4 }, () => dispatcher.acquire());
    expect(() => dispatcher.acquire()).toThrow();
    const promises: ReturnType<(typeof leases)[0]["run"]>[] = [];
    for (let i = 0; i < 4; i++) {
      promises.push(leases[i].run(await request()));
      await until(() => dispatcher.status().nonceCount === i + 1);
    }
    expect(calls).toBe(1);
    expect(dispatcher.status()).toMatchObject({ activeReads: 1, queuedReads: 3, httpRequests: 4 });
    for (let i = 0; i < 4; i++) {
      expect(calls).toBe(i + 1);
      pending[i].resolve(observation());
      await promises[i];
      expect(dispatcher.status().httpRequests).toBe(4 - i);
      leases[i].release();
    }
    expect(dispatcher.status()).toMatchObject({ activeReads: 0, queuedReads: 0, httpRequests: 0 });
  });

  it("removes aborted queued requests without freeing the aborted active DB slot", async () => {
    const pending = deferred<ReturnType<typeof observation>>();
    let calls = 0;
    const { dispatcher } = create({ resolveActiveBinding: vi.fn(async () => binding),
      readLatest: vi.fn(() => { calls++; return pending.promise; }) });
    await advance(10_000);
    const first = dispatcher.acquire();
    const firstResult = first.run(await request()).catch(e => e);
    await until(() => calls === 1);
    const queued = dispatcher.acquire();
    const queuedResult = queued.run(await request()).catch(e => e);
    await until(() => dispatcher.status().queuedReads === 1);
    queued.release();
    expect(await queuedResult).toBeInstanceOf(Error);
    expect(dispatcher.status().queuedReads).toBe(0);
    first.release();
    expect(await firstResult).toBeInstanceOf(Error);
    expect(dispatcher.status()).toMatchObject({ httpRequests: 0, activeReads: 1 });
    const later = dispatcher.acquire();
    const laterResult = later.run(await request()).catch(e => e);
    await until(() => dispatcher.status().queuedReads === 1);
    expect(calls).toBe(1);
    later.release(); await laterResult;
    pending.resolve(observation());
    await until(() => dispatcher.status().activeReads === 0);
    expect(calls).toBe(1);
  });

  it("does not dispatch expired queue entries and poisons stuck cleanup without replacing its slot", async () => {
    const pending = deferred<ReturnType<typeof observation>>();
    const { dispatcher, reader } = create({ resolveActiveBinding: vi.fn(async () => binding),
      readLatest: vi.fn(() => pending.promise) });
    await advance(10_000);
    const first = dispatcher.acquire();
    const one = first.run(await request()).catch(e => e);
    await until(() => dispatcher.status().activeReads === 1);
    const second = dispatcher.acquire();
    const two = second.run(await request()).catch(e => e);
    await until(() => dispatcher.status().queuedReads === 1);
    await advance(5000);
    expect(await one).toBeInstanceOf(Error); expect(await two).toBeInstanceOf(Error);
    expect(dispatcher.status()).toMatchObject({ activeReads: 1, queuedReads: 0, poisoned: false });
    await advance(3000);
    expect(dispatcher.status()).toMatchObject({ activeReads: 1, ready: false, poisoned: true });
    expect(() => dispatcher.acquire()).toThrow();
    pending.resolve(observation());
    await until(() => dispatcher.status().activeReads === 0);
    expect(dispatcher.status().poisoned).toBe(true);
    expect(reader.readLatest).toHaveBeenCalledTimes(1);
    first.release(); second.release();
  });

  it("re-quarantines a wall-clock jump, cancels old work and fences replay after the new boundary", async () => {
    const pending = deferred<ReturnType<typeof observation>>();
    const { dispatcher } = create({ resolveActiveBinding: vi.fn(async () => binding),
      readLatest: vi.fn(() => pending.promise) });
    await advance(10_000);
    const raw = await request();
    const lease = dispatcher.acquire();
    const result = lease.run(raw).catch(e => e);
    await until(() => dispatcher.status().activeReads === 1);
    wall -= 1001;
    expect(dispatcher.status().ready).toBe(false);
    expect(await result).toBeInstanceOf(Error);
    expect(dispatcher.status().activeReads).toBe(1);
    lease.release(); pending.resolve(observation());
    await until(() => dispatcher.status().activeReads === 0);
    await advance(10_000);
    expect(dispatcher.status()).toMatchObject({ ready: true, nonceCount: 0 });
    const replay = dispatcher.acquire();
    await expect(replay.run(raw)).rejects.toThrow();
    replay.release();
  });

  it("retains all unexpired nonces and refuses capacity instead of evicting replay protection", async () => {
    const { dispatcher, reader } = create();
    await advance(10_000);
    for (let i = 0; i < 1024; i++) {
      const lease = dispatcher.acquire();
      await lease.run(await request()); lease.release();
    }
    const full = dispatcher.acquire();
    await expect(full.run(await request())).rejects.toThrow(); full.release();
    expect(dispatcher.status().nonceCount).toBe(1024);
    expect(reader.readLatest).toHaveBeenCalledTimes(1024);
    await advance(6001);
    const freed = dispatcher.acquire();
    await freed.run(await request()); freed.release();
    expect(dispatcher.status().nonceCount).toBe(1);
  });

  it("consumes a signed request refused by a full queue so it cannot run after capacity opens", async () => {
    const pending = deferred<ReturnType<typeof observation>>();
    const { dispatcher, reader } = create({ resolveActiveBinding: vi.fn(async () => binding),
      readLatest: vi.fn(() => pending.promise) });
    await advance(10_000);
    const active = dispatcher.acquire();
    const activeResult = active.run(await request()).catch(e => e);
    await until(() => dispatcher.status().activeReads === 1);
    active.release(); await activeResult; // HTTP slot free; DB cleanup still occupies its slot.
    const queued = [];
    for (let i = 0; i < 3; i++) {
      const lease = dispatcher.acquire();
      const result = lease.run(await request()).catch(e => e);
      queued.push({ lease, result });
      await until(() => dispatcher.status().queuedReads === i + 1);
    }
    const raw = await request();
    const busy = dispatcher.acquire();
    await expect(busy.run(raw)).rejects.toThrow(); busy.release();
    queued[0].lease.release(); await queued[0].result;
    const retry = dispatcher.acquire();
    await expect(retry.run(raw)).rejects.toThrow(); retry.release();
    expect(reader.readLatest).toHaveBeenCalledTimes(1);
    for (const item of queued.slice(1)) { item.lease.release(); await item.result; }
    pending.resolve(observation());
    await until(() => dispatcher.status().activeReads === 0);
  });

  it("drain rejects work and keeps a transaction slot until actual cleanup, without publishing its result", async () => {
    const pending = deferred<ReturnType<typeof observation>>();
    const { dispatcher } = create({ resolveActiveBinding: vi.fn(async () => binding),
      readLatest: vi.fn(() => pending.promise) });
    await advance(10_000);
    const lease = dispatcher.acquire();
    const result = lease.run(await request()).catch(e => e);
    await until(() => dispatcher.status().activeReads === 1);
    dispatcher.stop();
    expect(await result).toBeInstanceOf(Error);
    expect(dispatcher.status()).toMatchObject({ draining: true, activeReads: 1, ready: false });
    expect(() => dispatcher.acquire()).toThrow();
    pending.resolve(observation());
    await until(() => dispatcher.status().activeReads === 0);
    lease.release();
  });

  it.each(["verify", "sign"] as const)("retains a disconnected HTTP admission slot until asynchronous %s settles", async (operation) => {
    const { dispatcher, reader } = create();
    await advance(10_000);
    const raw = await request();
    const pending = deferred<boolean | ArrayBuffer>();
    const spy = operation === "verify"
      ? vi.spyOn(crypto.subtle, "verify").mockImplementationOnce(() => pending.promise as Promise<boolean>)
      : vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(() => pending.promise as Promise<ArrayBuffer>);
    const lease = dispatcher.acquire();
    const result = lease.run(raw).catch(e => e);
    await until(() => spy.mock.calls.length === 1);
    lease.release();
    expect(dispatcher.status().httpRequests).toBe(1);
    const spare = Array.from({ length: 3 }, () => dispatcher.acquire());
    expect(() => dispatcher.acquire()).toThrow();
    pending.resolve(operation === "verify" ? true : new ArrayBuffer(32));
    expect(await result).toBeInstanceOf(Error);
    await until(() => dispatcher.status().httpRequests === 3);
    spare.forEach(item => item.release());
    if (operation === "verify") expect(reader.readLatest).not.toHaveBeenCalled();
  });
});
