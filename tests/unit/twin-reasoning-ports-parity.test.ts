import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import {
  diaryEntries,
  scenarioAnswers,
  twinDialogueTurns,
  twinPredictionVerifications,
} from "@/db/schema";
import {
  getTwinPatternSummaryForUser,
  getTwinPatternSummaryForUserAsync,
} from "@/lib/reasoning/twin-pattern-summary";
import {
  runTwinContradictionDetectorForUser,
  runTwinContradictionDetectorForUserAsync,
} from "@/lib/reasoning/twin-contradiction-detector";
import { runTwinPredictionForUser, runTwinPredictionForUserAsync } from "@/lib/reasoning/twin-prediction";
import {
  createTwinMemorySearchPortSqlite,
  createTwinVerificationListPortSqlite,
} from "@/lib/reasoning/twin-reasoning-ports";
import { appendDiaryEntryForUser } from "@/lib/twin-persistence/diary-memory";
import { ensureUserTwinSeed, persistUserTwinExchangeWithAssistantStub } from "@/lib/twin-persistence/loader";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER = "dee724-parity";

describe("DEE-72.4 SQLite port adapters parity with sync reasoning entrypoints", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-d724-parity-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER,
      email: `${USER}@example.com`,
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

  it("pattern summary async matches sync (empty corpus)", async () => {
    const db = getDb();
    const memoryPort = createTwinMemorySearchPortSqlite(db);
    const a = getTwinPatternSummaryForUser(db, USER);
    const b = await getTwinPatternSummaryForUserAsync(memoryPort, USER);
    expect(b).toEqual(a);
  });

  it("pattern summary async matches sync after diary writes", async () => {
    const db = getDb();
    await appendDiaryEntryForUser(db, {
      userId: USER,
      body: "values and goals contradiction stress mood",
      idempotencyKey: null,
    });
    const memoryPort = createTwinMemorySearchPortSqlite(db);
    expect(await getTwinPatternSummaryForUserAsync(memoryPort, USER)).toEqual(
      getTwinPatternSummaryForUser(db, USER),
    );
  });

  it("contradiction detector async matches sync (seed and scenario paths)", async () => {
    const db = getDb();
    const memoryPort = createTwinMemorySearchPortSqlite(db);
    const verificationPort = createTwinVerificationListPortSqlite(db);

    const seedOpts = {};
    expect(await runTwinContradictionDetectorForUserAsync(memoryPort, verificationPort, USER, seedOpts)).toEqual(
      runTwinContradictionDetectorForUser(db, USER, seedOpts),
    );

    const twinProfileId = ensureUserTwinSeed(db, USER);
    await persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId,
      userContent: "nightly coding drills for skills",
      userIdempotencyKey: null,
      assistantContent: "Steady practice helps.",
    });
    const scenarioOpts = {
      scenarioForRulesAndRetrieval: "I will never procrastinate on coding anymore",
    } as const;
    expect(
      await runTwinContradictionDetectorForUserAsync(memoryPort, verificationPort, USER, scenarioOpts),
    ).toEqual(runTwinContradictionDetectorForUser(db, USER, scenarioOpts));
  });

  it("prediction async matches sync", async () => {
    const db = getDb();
    const twinProfileId = ensureUserTwinSeed(db, USER);
    await persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId,
      userContent: "scenario match content for embeddings",
      userIdempotencyKey: null,
      assistantContent: "Noted.",
    });
    const memoryPort = createTwinMemorySearchPortSqlite(db);
    const scenario = "if we ship next week under deadline pressure calmly";
    expect(await runTwinPredictionForUserAsync(memoryPort, USER, scenario)).toEqual(
      runTwinPredictionForUser(db, USER, scenario),
    );
  });
});
