import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import {
  runWaiaTransactionOnRuntime,
} from "@/db/waia-transaction";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import * as pgSchema from "@/db/schema.postgres";

describe("runWaiaTransactionOnRuntime", () => {
  afterEach(() => {
    resetWaiaSqliteSingleton();
    vi.restoreAllMocks();
  });

  it("delegates to the SQLite legacy path and returns the callback result", async () => {
    process.env.DATABASE_URL = ":memory:";
    const db = getDb();
    const handle: WaiaRuntimeDb = { kind: "sqlite", db };
    const fn = vi.fn(() => 42);

    await expect(runWaiaTransactionOnRuntime(handle, fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("throws before invoking fn when handle.kind is postgres", async () => {
    const mockPg = drizzle.mock({ schema: pgSchema });
    const handle: WaiaRuntimeDb = { kind: "postgres", db: mockPg };
    const fn = vi.fn(() => {
      throw new Error("fn must not run");
    });

    await expect(runWaiaTransactionOnRuntime(handle, fn)).rejects.toThrow(
      "Postgres transactions are not supported yet (DEE-64 D6+).",
    );
    expect(fn).not.toHaveBeenCalled();
  });
});
