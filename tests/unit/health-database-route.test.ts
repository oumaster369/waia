import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/database/route";
import { resetWaiaSqliteSingleton } from "@/db/client";
import * as waiaRuntimeDb from "@/db/waia-runtime-db";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import * as pgSchema from "@/db/schema.postgres";

describe("GET /api/health/database", () => {
  const saved = {
    WAIA_DB_BACKEND: process.env.WAIA_DB_BACKEND,
    DATABASE_URL: process.env.DATABASE_URL,
  };

  afterEach(() => {
    if (saved.WAIA_DB_BACKEND === undefined) {
      delete process.env.WAIA_DB_BACKEND;
    } else {
      process.env.WAIA_DB_BACKEND = saved.WAIA_DB_BACKEND;
    }
    if (saved.DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = saved.DATABASE_URL;
    }
    resetWaiaSqliteSingleton();
    vi.restoreAllMocks();
  });

  it("returns sqlite ok when backend is sqlite", async () => {
    delete process.env.WAIA_DB_BACKEND;
    process.env.DATABASE_URL = ":memory:";

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ backend: "sqlite", ok: true });
  });

  it("runs select 1 when backend is postgres", async () => {
    const mockPg = drizzle.mock({ schema: pgSchema });
    const executeSpy = vi.spyOn(mockPg, "execute").mockResolvedValue([] as never);

    const pgHandle: WaiaRuntimeDb = { kind: "postgres", db: mockPg };
    vi.spyOn(waiaRuntimeDb, "getWaiaRuntimeDb").mockResolvedValue(pgHandle);

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ backend: "postgres", ok: true });
    expect(executeSpy).toHaveBeenCalledOnce();
    const [[arg]] = executeSpy.mock.calls;
    expect(arg).toEqual(sql`select 1`);
  });
});
