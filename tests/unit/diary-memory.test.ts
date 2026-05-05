import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { diaryEntries, scenarioAnswers } from "@/db/schema";
import {
  appendDiaryEntryForUser,
  appendScenarioAnswerForUser,
  listDiaryEntriesForUser,
  listScenarioAnswersForUser,
  stringifyScenarioPayloadForStorage,
} from "@/lib/twin-persistence/diary-memory";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const MEMORY_USER_ID = "diary-memory-loader-test-user";

describe("diary-memory persistence", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-diary-memory-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: MEMORY_USER_ID,
      email: "diary-memory@example.com",
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

  it("rejects circular payload structures for storage", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(stringifyScenarioPayloadForStorage(circular)).toBeNull();
  });

  it("rejects payloads containing bigint for storage", () => {
    expect(stringifyScenarioPayloadForStorage({ n: BigInt(1) })).toBeNull();
  });

  it("appends and lists diary entries with idempotent replay scoped to user_id", async () => {
    const db = getDb();
    db.delete(diaryEntries).run();

    const a = await appendDiaryEntryForUser(db, {
      userId: MEMORY_USER_ID,
      body: "one",
      idempotencyKey: "d1",
    });
    expect(a.replayed).toBe(false);

    const b = await appendDiaryEntryForUser(db, {
      userId: MEMORY_USER_ID,
      body: "should not apply",
      idempotencyKey: "d1",
    });
    expect(b.replayed).toBe(true);
    expect(b.id).toBe(a.id);
    expect(b.body).toBe("one");

    const rows = await listDiaryEntriesForUser(db, MEMORY_USER_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("one");
  });

  it("appends scenario answers with idempotent replay scoped to twin profile", async () => {
    const db = getDb();
    db.delete(scenarioAnswers).run();

    const json = stringifyScenarioPayloadForStorage({ k: "v" });
    expect(json).toBeTruthy();

    const first = await appendScenarioAnswerForUser(db, {
      userId: MEMORY_USER_ID,
      scenarioKey: "s1",
      payloadJson: json!,
      idempotencyKey: "sa1",
    });
    expect(first.replayed).toBe(false);

    const second = await appendScenarioAnswerForUser(db, {
      userId: MEMORY_USER_ID,
      scenarioKey: "s2",
      payloadJson: stringifyScenarioPayloadForStorage({ other: true })!,
      idempotencyKey: "sa1",
    });
    expect(second.replayed).toBe(true);
    expect(second.scenarioKey).toBe("s1");

    const listed = await listScenarioAnswersForUser(db, MEMORY_USER_ID);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.payload).toEqual({ k: "v" });
  });
});
