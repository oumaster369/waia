import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import * as postgresClient from "@/db/postgres-client";
import { resetPostgresSingletonForTests } from "@/db/postgres-client";
import { getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import * as pgSchema from "@/db/schema.postgres";

describe("getWaiaRuntimeDb", () => {
  const saved = {
    WAIA_DB_BACKEND: process.env.WAIA_DB_BACKEND,
    DATABASE_URL_POSTGRES: process.env.DATABASE_URL_POSTGRES,
    DATABASE_URL: process.env.DATABASE_URL,
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

  it("returns postgres branch when backend is postgres", async () => {
    const mockPg = drizzle.mock({ schema: pgSchema });
    const spy = vi.spyOn(postgresClient, "getPostgresDrizzle").mockReturnValue(mockPg);

    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES = "postgresql://127.0.0.1:54329/waia_validate";

    const r = await getWaiaRuntimeDb();
    expect(r.kind).toBe("postgres");
    expect(r.db).toBe(mockPg);
    expect(spy).toHaveBeenCalledOnce();
  });
});
