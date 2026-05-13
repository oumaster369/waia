import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import * as postgresClient from "@/db/postgres-client";
import { resetPostgresSingletonForTests } from "@/db/postgres-client";
import type postgres from "postgres";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import * as pgSchema from "@/db/schema.postgres";

describe("getWaiaRuntimeDb", () => {
  const saved = {
    WAIA_DB_BACKEND: process.env.WAIA_DB_BACKEND,
    DATABASE_URL_POSTGRES: process.env.DATABASE_URL_POSTGRES,
    DATABASE_URL: process.env.DATABASE_URL,
    WAIA_POSTGRES_PER_REQUEST_CLIENT: process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT,
  };

  afterEach(async () => {
    if (saved.WAIA_DB_BACKEND === undefined) {
      delete process.env.WAIA_DB_BACKEND;
    } else {
      process.env.WAIA_DB_BACKEND = saved.WAIA_DB_BACKEND;
    }
    if (saved.DATABASE_URL_POSTGRES === undefined) {
      delete process.env.DATABASE_URL_POSTGRES;
    } else {
      process.env.DATABASE_URL_POSTGRES = saved.DATABASE_URL_POSTGRES;
    }
    if (saved.DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = saved.DATABASE_URL;
    }
    if (saved.WAIA_POSTGRES_PER_REQUEST_CLIENT === undefined) {
      delete process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT;
    } else {
      process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT = saved.WAIA_POSTGRES_PER_REQUEST_CLIENT;
    }
    resetWaiaSqliteSingleton();
    await resetPostgresSingletonForTests();
    vi.restoreAllMocks();
  });

  it("returns sqlite branch when WAIA_DB_BACKEND is unset", async () => {
    delete process.env.WAIA_DB_BACKEND;
    process.env.DATABASE_URL = ":memory:";
    const r = await getWaiaRuntimeDb();
    expect(r.kind).toBe("sqlite");
    const direct = getDb();
    expect(typeof r.db.select).toBe("function");
    expect(r.db).not.toBe(direct);
  });

  it("returns sqlite branch when WAIA_DB_BACKEND is sqlite", async () => {
    process.env.WAIA_DB_BACKEND = "sqlite";
    process.env.DATABASE_URL = ":memory:";
    const r = await getWaiaRuntimeDb();
    expect(r.kind).toBe("sqlite");
    expect(typeof r.db.select).toBe("function");
  });

  it("returns postgres singleton branch when backend is postgres and per-request is disabled", async () => {
    const mockPg = drizzle.mock({ schema: pgSchema });
    const spy = vi.spyOn(postgresClient, "getPostgresDrizzle").mockReturnValue(mockPg);

    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES = "postgresql://127.0.0.1:54329/waia_validate";
    process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT = "false";

    const r = await getWaiaRuntimeDb();
    expect(r.kind).toBe("postgres");
    expect(r.db).toBe(mockPg);
    expect((r as Extract<WaiaRuntimeDb, { kind: "postgres" }>)._sql).toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("returns postgres per-request handle when backend is postgres (default flag)", async () => {
    const mockPg = drizzle.mock({ schema: pgSchema });
    const mockSql = { end: vi.fn().mockResolvedValue(undefined) } as unknown as postgres.Sql;
    const spy = vi.spyOn(postgresClient, "createPerRequestPostgresRuntime").mockReturnValue({
      kind: "postgres",
      db: mockPg,
      _sql: mockSql,
    });

    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES = "postgresql://127.0.0.1:54329/waia_validate";
    delete process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT;

    const r = await getWaiaRuntimeDb();
    expect(r.kind).toBe("postgres");
    expect(r.db).toBe(mockPg);
    expect((r as Extract<WaiaRuntimeDb, { kind: "postgres" }>)._sql).toBe(mockSql);
    expect(spy).toHaveBeenCalledOnce();

    await disposeWaiaRuntimeDb(r);
    expect(mockSql.end).toHaveBeenCalled();
  });
});
