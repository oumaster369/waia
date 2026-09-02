import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

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
