import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";
import * as diaryMemory from "@/lib/twin-persistence/diary-memory";
import * as twinLoader from "@/lib/twin-persistence/loader";
import * as pgSchema from "@/db/schema.postgres";

vi.mock("@/lib/persistence/sqlite/twin-persistence", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/persistence/sqlite/twin-persistence")>();
  return {
    ...mod,
    createSqliteTwinPersistence: vi.fn(mod.createSqliteTwinPersistence),
  };
});

import { createSqliteTwinPersistence } from "@/lib/persistence/sqlite/twin-persistence";

describe("SQLite twin persistence boundary (DEE-64 D5a)", () => {
  afterEach(() => {
    resetWaiaSqliteSingleton();
    vi.restoreAllMocks();
  });

  it("delegates persistUserTwinExchangeWithAssistantStub to twin-persistence loader with the same db", async () => {
    process.env.DATABASE_URL = ":memory:";
    const db = getDb();
    const spy = vi.spyOn(twinLoader, "persistUserTwinExchangeWithAssistantStub").mockResolvedValue({
      userTurn: {
        id: "u1",
        sequence: 1,
        createdAt: new Date(),
        content: "hi",
        replayed: false,
      },
      assistantTurn: null,
    });

    const persistence = createSqliteTwinPersistence(db);
    await persistence.persistUserTwinExchangeWithAssistantStub({
      twinProfileId: "tp1",
      userContent: "hi",
      assistantContent: "stub",
    });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(db, {
      twinProfileId: "tp1",
      userContent: "hi",
      assistantContent: "stub",
    });
  });

  it("matches direct diary helper behavior for stringifyScenarioPayloadForStorage", () => {
    process.env.DATABASE_URL = ":memory:";
    const db = getDb();
    const persistence = createSqliteTwinPersistence(db);
    const payload = { answer: "a", mood: 7 };
    expect(persistence.stringifyScenarioPayloadForStorage(payload)).toBe(
      diaryMemory.stringifyScenarioPayloadForStorage(payload),
    );
  });

  it("resolveTwinPersistence returns a SQLite boundary backed by the handle db", () => {
    process.env.DATABASE_URL = ":memory:";
    const db = getDb();
    const handle: WaiaRuntimeDb = { kind: "sqlite", db };
    const persistence = resolveTwinPersistence(handle);
    expect(persistence.db).toBe(db);
    expect(typeof persistence.ensureUserTwinSeed).toBe("function");
    expect(createSqliteTwinPersistence).toHaveBeenCalled();
    expect(vi.mocked(createSqliteTwinPersistence).mock.calls[0]?.[0]).toBe(db);
  });

  it("resolveTwinPersistence throws before createSqliteTwinPersistence runs for Postgres handles", () => {
    const mockPg = drizzle.mock({ schema: pgSchema });
    const handle: WaiaRuntimeDb = { kind: "postgres", db: mockPg };
    vi.mocked(createSqliteTwinPersistence).mockClear();

    expect(() => resolveTwinPersistence(handle)).toThrow(
      "[waia] Postgres twin/diary persistence is not supported yet",
    );
    expect(createSqliteTwinPersistence).not.toHaveBeenCalled();
  });

  it("resolveTwinPersistence postgres path does not invoke loader persistence", () => {
    const mockPg = drizzle.mock({ schema: pgSchema });
    const handle: WaiaRuntimeDb = { kind: "postgres", db: mockPg };
    const loaderSpy = vi.spyOn(twinLoader, "ensureUserTwinSeed");

    expect(() => resolveTwinPersistence(handle)).toThrow();
    expect(loaderSpy).not.toHaveBeenCalled();
  });
});
