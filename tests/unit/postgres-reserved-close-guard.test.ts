import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

import { guardSingleConnectionPostgresPool } from "../../db/postgres-reserved-close-guard";

function fixture() {
  const dispatch = vi.fn();
  const cursorNext = vi.fn(async () => ({ done: false, value: [1] }));
  const query = {
    then(resolve: (rows: number[]) => unknown, reject?: (error: unknown) => unknown) {
      dispatch();
      return Promise.resolve([1]).then(resolve, reject);
    },
    catch(reject: (error: unknown) => unknown) { dispatch(); return Promise.resolve([1]).catch(reject); },
    finally(callback: () => void) { dispatch(); return Promise.resolve([1]).finally(callback); },
    values() { return this; },
    execute() { dispatch(); return this; },
    cursor() { return { [Symbol.asyncIterator]: () => ({ next: cursorNext }) }; },
  };
  const reserved = Object.assign(vi.fn(() => query), {
    unsafe: vi.fn(() => query), release: vi.fn(),
  });
  const previousOnClose = vi.fn();
  const pool = Object.assign(vi.fn(), {
    options: { max: 1, onclose: previousOnClose },
    reserve: vi.fn(async () => reserved),
  });
  const guarded = guardSingleConnectionPostgresPool(pool as unknown as postgres.Sql);
  return { guarded, pool, reserved, dispatch, cursorNext, previousOnClose };
}

describe("single-connection reserved backend close guard", () => {
  it("preserves healthy tag/unsafe/chained query results and releases once", async () => {
    const f = fixture();
    const sql = await f.guarded.reserve();
    expect(await sql`SELECT 1`).toEqual([1]);
    expect(await sql.unsafe("SELECT 1").values()).toEqual([1]);
    expect(f.dispatch).toHaveBeenCalledTimes(2);
    sql.release(); sql.release();
    expect(f.reserved.release).toHaveBeenCalledOnce();
  });

  it("rejects both new and already-created lazy queries after close without dispatch", async () => {
    const f = fixture();
    const sql = await f.guarded.reserve();
    const delayed = sql`SELECT 1`;
    const unsafeDelayed = sql.unsafe("SELECT 1").values();
    f.pool.options.onclose(7);
    expect(f.previousOnClose).toHaveBeenCalledOnce();
    expect(f.previousOnClose).toHaveBeenCalledWith(7);
    await expect(delayed).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    await expect(unsafeDelayed).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(() => sql`SELECT 1`).toThrow("CONNECTION_CLOSED");
    expect(() => sql.unsafe("ROLLBACK")).toThrow("CONNECTION_CLOSED");
    expect(f.dispatch).not.toHaveBeenCalled();
    sql.release();
    expect(f.reserved.release).not.toHaveBeenCalled();
    expect(f.pool.reserve).toHaveBeenCalledOnce();
  });

  it("guards explicit execution and deferred cursor iteration", async () => {
    const f = fixture();
    const sql = await f.guarded.reserve();
    const query = sql`SELECT 1`;
    const iterator = sql.unsafe("SELECT 1").cursor()[Symbol.asyncIterator]();
    f.pool.options.onclose(8);
    expect(() => query.execute()).toThrow("CONNECTION_CLOSED");
    await expect(iterator.next()).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.cursorNext).not.toHaveBeenCalled();
    sql.release();
  });

  it("preserves catch/finally rejection handling after closure", async () => {
    const f = fixture();
    const sql = await f.guarded.reserve();
    const query = sql`SELECT 1`;
    f.pool.options.onclose(9);
    const cleanup = vi.fn();
    const error = await query.finally(cleanup).catch(error => error);
    expect(error.code).toBe("CONNECTION_CLOSED");
    expect(cleanup).toHaveBeenCalledOnce();
    expect((await query.catch(error => error)).code).toBe("CONNECTION_CLOSED");
    expect(f.dispatch).not.toHaveBeenCalled();
    sql.release();
  });

  it("refuses asynchronous file queries rather than bypassing the close guard", async () => {
    const f = fixture();
    const sql = await f.guarded.reserve();
    expect(() => sql.file("unused.sql")).toThrow("FILE_QUERY_UNSUPPORTED");
    sql.release();
  });

  it("does not accept a reservation whose acquisition observed a close", async () => {
    const f = fixture();
    f.pool.reserve.mockImplementationOnce(async () => {
      f.pool.options.onclose(10);
      return f.reserved;
    });
    await expect(f.guarded.reserve()).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.pool.reserve).toHaveBeenCalledOnce();
  });

  it("never revives old handles when the caller explicitly reserves a new one", async () => {
    const f = fixture();
    const old = await f.guarded.reserve();
    const delayed = old`SELECT 1`;
    await expect(f.guarded.reserve()).rejects.toThrow("ALREADY_RESERVED");
    old.release();
    const fresh = await f.guarded.reserve();
    expect(await fresh`SELECT 1`).toEqual([1]);
    await expect(delayed).rejects.toMatchObject({ code: "RESERVED_SESSION_RELEASED" });
    expect(() => old`SELECT 1`).toThrow("SESSION_RELEASED");
    expect(f.pool.reserve).toHaveBeenCalledTimes(2);
    fresh.release();
  });

  it("does not admit a concurrent reservation while acquisition is pending", async () => {
    const f = fixture();
    let release!: (value: typeof f.reserved) => void;
    f.pool.reserve.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = f.guarded.reserve();
    await expect(f.guarded.reserve()).rejects.toThrow("ALREADY_RESERVED");
    release(f.reserved);
    (await first).release();
  });

  it("rejects multi-connection pools before altering their callbacks", () => {
    const onclose = vi.fn();
    const pool = Object.assign(vi.fn(), { options: { max: 2, onclose } });
    expect(() => guardSingleConnectionPostgresPool(pool as unknown as postgres.Sql))
      .toThrow("REQUIRES_SINGLE_CONNECTION");
    expect(pool.options.onclose).toBe(onclose);
  });
});
