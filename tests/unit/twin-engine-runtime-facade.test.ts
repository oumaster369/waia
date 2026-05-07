import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import {
  diaryEntries,
  scenarioAnswers,
  twinDialogueTurns,
  twinPredictionVerifications,
} from "@/db/schema";
import { MAX_SCENARIO_CHARS } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import { TWIN_ENGINE_SCHEMA_VERSION } from "@/lib/dashboard/twin-engine-api.types";
import type { TwinEngineApiResponse } from "@/lib/dashboard/twin-engine-api.types";
import { TWIN_PATTERN_SUMMARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-pattern-summary-api.types";
import { runTwinEngineForRuntimeAsync } from "@/lib/reasoning/twin-engine-runtime";
import {
  runTwinEngine,
  TwinEngineScenarioTooLongError,
} from "@/lib/reasoning/twin-engine";
import * as twinEnginePostgres from "@/lib/reasoning/twin-engine-postgres";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_EMPTY = "facade-engine-empty";

describe("runTwinEngineForRuntimeAsync (DEE-95a)", () => {
  describe("sqlite handle", () => {
    let tmpRoot: string;
    let prevDb: string | undefined;

    beforeAll(() => {
      prevDb = process.env.DATABASE_URL;
      tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-twin-engine-facade-"));
      const dbPath = path.join(tmpRoot, "walita.sqlite");
      mkdirSync(tmpRoot, { recursive: true });
      process.env.DATABASE_URL = `file:${dbPath}`;
      migrateDatabaseFromEnv();
      insertEmailPasswordUser(getDb(), {
        id: USER_EMPTY,
        email: `${USER_EMPTY}@example.com`,
        password: "password123",
      });
    });

    afterAll(() => {
      resetWaiaSqliteSingleton();
      if (prevDb === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = prevDb;
      }
      try {
        rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    });

    beforeEach(() => {
      const db = getDb();
      db.delete(twinPredictionVerifications).run();
      db.delete(twinDialogueTurns).run();
      db.delete(diaryEntries).run();
      db.delete(scenarioAnswers).run();
    });

    it("matches direct runTwinEngine output and engineMeta.modulesRun", async () => {
      const db = getDb();
      const handle: WaiaRuntimeDb = { kind: "sqlite", db };
      const input = { userId: USER_EMPTY, scenario: undefined, includePrediction: false };
      const direct = runTwinEngine(db, input);
      const viaFacade = await runTwinEngineForRuntimeAsync(handle, input);
      expect(viaFacade).toEqual(direct);
      expect(viaFacade.schemaVersion).toBe(TWIN_ENGINE_SCHEMA_VERSION);
      expect(viaFacade.patternSummary.schemaVersion).toBe(TWIN_PATTERN_SUMMARY_SCHEMA_VERSION);
      expect(viaFacade.engineMeta.modulesRun).toEqual(direct.engineMeta.modulesRun);
    });

    it("rejects with TwinEngineScenarioTooLongError like runTwinEngine", async () => {
      const db = getDb();
      const handle: WaiaRuntimeDb = { kind: "sqlite", db };
      const long = "x".repeat(MAX_SCENARIO_CHARS + 1);
      await expect(
        runTwinEngineForRuntimeAsync(handle, { userId: USER_EMPTY, scenario: long }),
      ).rejects.toThrow(TwinEngineScenarioTooLongError);
      expect(() => runTwinEngine(db, { userId: USER_EMPTY, scenario: long })).toThrow(
        TwinEngineScenarioTooLongError,
      );
    });
  });

  describe("postgres handle", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("delegates to runTwinEnginePostgresAsync with persistence from resolveTwinPersistence", async () => {
      const mockPg = drizzle.mock({ schema: pgSchema });
      const handle: WaiaRuntimeDb = { kind: "postgres", db: mockPg };
      const input = { userId: "pg-user", scenario: "hello", includePrediction: true };
      /** Stub return; delegation test only checks call shape and reference identity of result. */
      const fake = {
        schemaVersion: TWIN_ENGINE_SCHEMA_VERSION,
        engineMeta: {
          scenarioUsed: true,
          predictionRequested: true,
          modulesRun: [
            "pattern_summary",
            "contradiction_detector",
            "repeatability_analyzer",
            "personality_model",
          ] as const,
          generatedAt: null,
        },
      } as unknown as TwinEngineApiResponse;
      const spy = vi.spyOn(twinEnginePostgres, "runTwinEnginePostgresAsync").mockResolvedValue(fake);

      const result = await runTwinEngineForRuntimeAsync(handle, input);
      expect(result).toBe(fake);
      expect(spy).toHaveBeenCalledTimes(1);
      const [persistenceArg, inputArg] = spy.mock.calls[0]!;
      expect(inputArg).toEqual(input);
      expect(persistenceArg).toMatchObject({ db: mockPg });
    });

    it("rejects with TwinEngineScenarioTooLongError before engine I/O", async () => {
      const mockPg = drizzle.mock({ schema: pgSchema });
      const handle: WaiaRuntimeDb = { kind: "postgres", db: mockPg };
      const long = "x".repeat(MAX_SCENARIO_CHARS + 1);
      await expect(
        runTwinEngineForRuntimeAsync(handle, { userId: "pg-user", scenario: long }),
      ).rejects.toThrow(TwinEngineScenarioTooLongError);
    });
  });
});
