import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it, vi } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import {
  bindPostgresReservedSession,
  parsePostgresTimestamptz,
} from "@/db/postgres-session-transaction";
import {
  POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS_V2,
  withPostgresSerializableTransactionRetryV2,
  withPostgresSessionTransactionV2,
} from
  "@/lib/trader/historical-simulation-v2/postgres-session-transaction-v2";

function reservedSql(statements: string[]) {
  return (async (strings: TemplateStringsArray) => {
    statements.push(strings.join(""));
    return [];
  }) as unknown as postgres.ReservedSql;
}

describe("postgres session transaction V2", () => {
  it("normalizes Date and canonical PostgreSQL timestamptz text equivalently", () => {
    const expected = "2026-09-03T01:39:03.881Z";
    expect(parsePostgresTimestamptz(new Date(expected)).toISOString()).toBe(expected);
    expect(parsePostgresTimestamptz(
      "2026-09-03 01:39:03.881+00",
    ).toISOString()).toBe(expected);
  });

  it("refuses naive, ambiguous and invalid PostgreSQL timestamps", () => {
    for (const value of [
      "2026-09-03 01:39:03.881",
      "2026-09-03T01:39:03.881Z",
      "not-a-timestamp",
      new Date(Number.NaN),
      null,
    ]) {
      expect(() => parsePostgresTimestamptz(value)).toThrow(
        "POSTGRES_TIMESTAMPTZ_REFUSED",
      );
    }
  });

  it("binds Drizzle metadata without letting reserved queries escape to the pool", () => {
    const poolQuery = vi.fn(() => { throw new Error("POOL_QUERY_ESCAPE"); });
    const pool = Object.assign(poolQuery, {
      options: { parsers: {}, serializers: {}, transform: {} },
      unsafe: vi.fn(() => { throw new Error("POOL_UNSAFE_ESCAPE"); }),
      notify: vi.fn(() => { throw new Error("POOL_NOTIFY_ESCAPE"); }),
      begin: vi.fn(),
      reserve: vi.fn(),
    }) as unknown as postgres.Sql;
    const reservedQuery = vi.fn(() => "reserved-tag-query");
    const reservedUnsafe = vi.fn(() => "reserved-unsafe-query");
    const reserved = Object.assign(reservedQuery, {
      unsafe: reservedUnsafe,
      release: vi.fn(),
    }) as unknown as postgres.ReservedSql;

    const bound = bindPostgresReservedSession(pool, reserved);
    expect(() => drizzle(bound, { schema: pgSchema })).not.toThrow();
    expect(bound`SELECT 1`).toBe("reserved-tag-query");
    expect(bound.unsafe("SELECT 2")).toBe("reserved-unsafe-query");
    expect(poolQuery).not.toHaveBeenCalled();
    expect(pool.unsafe).not.toHaveBeenCalled();
    expect((bound as unknown as { begin?: unknown }).begin).toBeUndefined();
    expect((bound as unknown as { reserve?: unknown }).reserve).toBeUndefined();
    expect((bound as unknown as { notify?: unknown }).notify).toBeUndefined();
    expect(bound.options.parsers).not.toBe(pool.options.parsers);
    expect(bound.options.serializers).not.toBe(pool.options.serializers);
    expect(pool.options.parsers[1184]).toBeUndefined();
    expect(pool.options.serializers[1184]).toBeUndefined();
    expect(pool.notify).not.toHaveBeenCalled();
  });

  it("isolates codec installation between adapters on one reserved backend", () => {
    const pool = Object.assign(vi.fn(), {
      options: { parsers: {}, serializers: {} },
    }) as unknown as postgres.Sql;
    const reserved = Object.assign(vi.fn(), {
      unsafe: vi.fn(),
      release: vi.fn(),
    }) as unknown as postgres.ReservedSql;

    const first = bindPostgresReservedSession(pool, reserved);
    drizzle(first);
    const second = bindPostgresReservedSession(pool, reserved);

    expect(first.options.parsers).not.toBe(second.options.parsers);
    expect(first.options.serializers).not.toBe(second.options.serializers);
    expect(first.options.parsers[1184]).toBeTypeOf("function");
    expect(second.options.parsers[1184]).toBeUndefined();
    expect(pool.options.parsers[1184]).toBeUndefined();
  });

  it("binds Drizzle-serialized JSON for target-type-aware reserved serialization", () => {
    const pool = Object.assign(vi.fn(), {
      options: { parsers: {}, serializers: {} },
    }) as unknown as postgres.Sql;
    const unsafe = vi.fn(() => "reserved-unsafe-query");
    const typed = vi.fn((value: unknown, type: number) => ({ value, type }));
    const reserved = Object.assign(vi.fn(), {
      unsafe,
      typed,
      release: vi.fn(),
    }) as unknown as postgres.ReservedSql;
    const bound = bindPostgresReservedSession(pool, reserved);

    expect(bound.unsafe("SELECT $1, $2, $3", [
      JSON.stringify({ nested: [1, 2] }),
      "plain-text",
      "1",
    ])).toBe("reserved-unsafe-query");
    expect(typed).toHaveBeenCalledTimes(2);
    expect(typed.mock.calls.map((call) => call[1])).toEqual([0, 0]);
    const objectWrapper = typed.mock.calls[0]![0];
    const scalarWrapper = typed.mock.calls[1]![0];
    expect(JSON.stringify(objectWrapper)).toBe('{"nested":[1,2]}');
    expect(String(objectWrapper)).toBe('{"nested":[1,2]}');
    expect(JSON.stringify(scalarWrapper)).toBe("1");
    expect(String(scalarWrapper)).toBe("1");
    expect(unsafe).toHaveBeenCalledWith("SELECT $1, $2, $3", [
      expect.any(Object),
      "plain-text",
      expect.any(Object),
    ]);
  });

  it("passes serialized JSON through when the reserved source already has transparent codecs", () => {
    const transparent = (value: never) => value;
    const pool = Object.assign(vi.fn(), {
      options: {
        parsers: {},
        serializers: { 114: transparent, 3802: transparent },
      },
    }) as unknown as postgres.Sql;
    const unsafe = vi.fn(() => "reserved-unsafe-query");
    const typed = vi.fn();
    const reserved = Object.assign(vi.fn(), {
      unsafe,
      typed,
      release: vi.fn(),
    }) as unknown as postgres.ReservedSql;
    const bound = bindPostgresReservedSession(pool, reserved);
    const serialized = JSON.stringify({ nested: [1, 2] });

    expect(bound.unsafe("SELECT $1", [serialized])).toBe("reserved-unsafe-query");
    expect(unsafe).toHaveBeenCalledWith("SELECT $1", [serialized]);
    expect(typed).not.toHaveBeenCalled();
  });

  it("uses postgres.js native begin on a normal pool handle", async () => {
    const transaction = {} as postgres.Sql;
    const begin = vi.fn(async (_option: string,
      callback: (tx: postgres.Sql) => Promise<string>) => callback(transaction));
    const sql = { begin } as unknown as postgres.Sql;
    const callback = vi.fn(async (tx: postgres.Sql) => {
      expect(tx).toBe(transaction);
      return "committed";
    });

    await expect(withPostgresSessionTransactionV2(
      sql,
      "SERIALIZABLE",
      callback,
    )).resolves.toBe("committed");
    expect(begin).toHaveBeenCalledOnce();
    expect(begin.mock.calls[0]?.[0]).toBe("isolation level serializable");
  });

  it("reuses only the native transaction handle and refuses the captured pool", async () => {
    const transaction = {} as postgres.Sql;
    const begin = vi.fn(async (_option: string,
      callback: (tx: postgres.Sql) => Promise<string>) => callback(transaction));
    const pool = { begin } as unknown as postgres.Sql;

    await expect(withPostgresSessionTransactionV2(
      pool,
      "SERIALIZABLE",
      (outer) => withPostgresSessionTransactionV2(
        outer,
        "REPEATABLE READ",
        async (inner) => {
          expect(inner).toBe(transaction);
          return "same-native-transaction";
        },
      ),
    )).resolves.toBe("same-native-transaction");
    expect(begin).toHaveBeenCalledOnce();

    await expect(withPostgresSessionTransactionV2(
      pool,
      "SERIALIZABLE",
      () => withPostgresSessionTransactionV2(
        pool,
        "REPEATABLE READ",
        async () => "unreachable",
      ),
    )).rejects.toThrow("POSTGRES_SESSION_TRANSACTION_HANDLE_MISMATCH_REFUSED");
    expect(begin).toHaveBeenCalledTimes(2);
  });

  it("manually commits on the exact reserved backend without calling missing begin", async () => {
    const statements: string[] = [];
    const reserved = reservedSql(statements);

    await expect(withPostgresSessionTransactionV2(
      reserved,
      "REPEATABLE READ",
      async (transaction) => {
        expect(transaction).toBe(reserved);
        statements.push("WORK");
        return "same-backend";
      },
    )).resolves.toBe("same-backend");
    expect(statements).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ",
      "WORK",
      "COMMIT",
    ]);
  });

  it("rolls back the reserved backend and preserves the work failure", async () => {
    const statements: string[] = [];
    const reserved = reservedSql(statements);

    await expect(withPostgresSessionTransactionV2(
      reserved,
      "SERIALIZABLE",
      async () => {
        statements.push("WORK");
        throw new Error("expected work failure");
      },
    )).rejects.toThrow("expected work failure");
    expect(statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "WORK",
      "ROLLBACK",
    ]);
  });

  it("reuses the exact backend for nested transactions without a nested BEGIN", async () => {
    const statements: string[] = [];
    const reserved = reservedSql(statements);

    await expect(withPostgresSessionTransactionV2(
      reserved,
      "SERIALIZABLE",
      (outer) => withPostgresSessionTransactionV2(
        outer,
        "REPEATABLE READ",
        async (inner) => {
          expect(inner).toBe(reserved);
          statements.push("NESTED_WORK");
          return "atomic";
        },
      ),
    )).resolves.toBe("atomic");
    expect(statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "NESTED_WORK",
      "COMMIT",
    ]);
  });

  it("refuses to pretend a nested transaction raised its isolation", async () => {
    const statements: string[] = [];
    const reserved = reservedSql(statements);

    await expect(withPostgresSessionTransactionV2(
      reserved,
      "REPEATABLE READ",
      (outer) => withPostgresSessionTransactionV2(
        outer,
        "SERIALIZABLE",
        async () => "unreachable",
      ),
    )).rejects.toThrow("POSTGRES_SESSION_TRANSACTION_ISOLATION_ESCALATION_REFUSED");
    expect(statements).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ",
      "ROLLBACK",
    ]);
  });

  it("opens a fresh transaction after SQLSTATE 40001 and then commits", async () => {
    const statements: string[] = [];
    const reserved = reservedSql(statements);
    let attempts = 0;

    await expect(withPostgresSerializableTransactionRetryV2(
      reserved,
      async () => {
        attempts += 1;
        statements.push(`WORK:${attempts}`);
        if (attempts === 1) {
          throw Object.assign(new Error("serialization failure"), { code: "40001" });
        }
        return "fresh-snapshot";
      },
    )).resolves.toBe("fresh-snapshot");
    expect(attempts).toBe(2);
    expect(statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "WORK:1",
      "ROLLBACK",
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "WORK:2",
      "COMMIT",
    ]);
  });

  it("lets the outer owner retry a nested 40001 on a fresh transaction", async () => {
    const statements: string[] = [];
    const reserved = reservedSql(statements);
    let outerAttempts = 0;
    let nestedCallbacks = 0;

    await expect(withPostgresSerializableTransactionRetryV2(
      reserved,
      async (outer) => {
        outerAttempts += 1;
        statements.push(`OUTER:${outerAttempts}`);
        return withPostgresSerializableTransactionRetryV2(outer, async (inner) => {
          expect(inner).toBe(reserved);
          nestedCallbacks += 1;
          statements.push(`NESTED:${nestedCallbacks}`);
          if (outerAttempts === 1) {
            throw Object.assign(new Error("nested serialization failure"), { code: "40001" });
          }
          return "fresh-outer-snapshot";
        });
      },
    )).resolves.toBe("fresh-outer-snapshot");
    expect(outerAttempts).toBe(2);
    expect(nestedCallbacks).toBe(2);
    expect(statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "OUTER:1",
      "NESTED:1",
      "ROLLBACK",
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "OUTER:2",
      "NESTED:2",
      "COMMIT",
    ]);
  });

  it("does not retry any non-40001 error", async () => {
    const statements: string[] = [];
    const reserved = reservedSql(statements);
    const failure = Object.assign(new Error("deadlock"), { code: "40P01" });
    const callback = vi.fn(async () => { throw failure; });

    await expect(withPostgresSerializableTransactionRetryV2(reserved, callback))
      .rejects.toBe(failure);
    expect(callback).toHaveBeenCalledOnce();
    expect(statements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "ROLLBACK",
    ]);
  });

  it("stops after the fixed maximum number of 40001 attempts", async () => {
    const statements: string[] = [];
    const reserved = reservedSql(statements);
    const failure = Object.assign(new Error("persistent serialization failure"), {
      code: "40001",
    });
    const callback = vi.fn(async () => { throw failure; });

    await expect(withPostgresSerializableTransactionRetryV2(reserved, callback))
      .rejects.toBe(failure);
    expect(callback).toHaveBeenCalledTimes(
      POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS_V2,
    );
    expect(statements.filter((statement) => statement ===
      "BEGIN ISOLATION LEVEL SERIALIZABLE")).toHaveLength(
      POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS_V2,
    );
    expect(statements.filter((statement) => statement === "ROLLBACK")).toHaveLength(
      POSTGRES_SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS_V2,
    );
    expect(statements).not.toContain("COMMIT");
  });
});
