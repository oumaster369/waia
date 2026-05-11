import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import {
  diaryEntries,
  scenarioAnswers,
  twinDialogueTurns,
  twinProfiles,
} from "@/db/schema";
import { eq } from "drizzle-orm";

import {
  composeScenarioEmbedInput,
  embedTwinMemoryText,
  serializeEmbeddingJson,
} from "@/lib/embeddings/twin-memory-embeddings";
import {
  appendDiaryEntryForUser,
  appendScenarioAnswerForUser,
} from "@/lib/twin-persistence/diary-memory";
import {
  ensureUserTwinSeed,
  persistUserTwinExchangeWithAssistantStub,
  type WaiaSqliteDb,
} from "@/lib/twin-persistence/loader";
import { searchTwinMemoriesByText } from "@/lib/twin-persistence/twin-memory-retrieval";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "embed-persist-test-user-a";
const USER_B = "embed-persist-test-user-b";

function getTwinProfile(db: WaiaSqliteDb, userId: string): string | undefined {
  return db.select({ id: twinProfiles.id }).from(twinProfiles).where(eq(twinProfiles.userId, userId)).get()?.id;
}

describe("DEE-32 Twin memory embeddings persistence and retrieval", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-embed-dee32-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "embed-a@example.com",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "embed-b@example.com",
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

  it("stores embedding_json + model on fresh twin dialogue inserts (user + assistant)", async () => {
    const db = getDb();
    const twinProfileId = ensureUserTwinSeed(db, USER_A);
    db.delete(twinDialogueTurns).run();

    const res = await persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId,
      userContent: "persist embed message",
      userIdempotencyKey: null,
      assistantContent: "assistant stub reply",
    });
    expect(res.userTurn.replayed).toBe(false);
    expect(res.assistantTurn).not.toBeNull();

    const userRow = db
      .select({
        embeddingJson: twinDialogueTurns.embeddingJson,
        embeddingModel: twinDialogueTurns.embeddingModel,
      })
      .from(twinDialogueTurns)
      .where(eq(twinDialogueTurns.id, res.userTurn.id))
      .get();
    expect(userRow?.embeddingJson).not.toBe(null);
    expect(userRow?.embeddingModel).toBe("stub-deterministic-v1");

    const asstRow = db
      .select({
        embeddingJson: twinDialogueTurns.embeddingJson,
        embeddingModel: twinDialogueTurns.embeddingModel,
      })
      .from(twinDialogueTurns)
      .where(eq(twinDialogueTurns.id, res.assistantTurn!.id))
      .get();
    expect(asstRow?.embeddingJson).not.toBe(null);
    expect(asstRow?.embeddingModel).toBe("stub-deterministic-v1");
  });

  it("does not change embedding_json on idempotent replay of twin exchange", async () => {
    const db = getDb();
    ensureUserTwinSeed(db, USER_A);
    db.delete(twinDialogueTurns).run();

    await persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId: getTwinProfile(db, USER_A)!,
      userContent: "replay check",
      userIdempotencyKey: "idem-embed-twice",
      assistantContent: "same stub",
    });

    const snapshot = db
      .select({
        embeddingJson: twinDialogueTurns.embeddingJson,
        id: twinDialogueTurns.id,
      })
      .from(twinDialogueTurns)
      .where(eq(twinDialogueTurns.idempotencyKey, "idem-embed-twice"))
      .get();

    await persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId: getTwinProfile(db, USER_A)!,
      userContent: "different body ignored",
      userIdempotencyKey: "idem-embed-twice",
      assistantContent: "ignored",
    });

    const after = db
      .select({
        embeddingJson: twinDialogueTurns.embeddingJson,
      })
      .from(twinDialogueTurns)
      .where(eq(twinDialogueTurns.id, snapshot!.id))
      .get();
    expect(after?.embeddingJson).toBe(snapshot?.embeddingJson);
    expect(db.select().from(twinDialogueTurns).all()).toHaveLength(2);
  });

  it("stores embeddings on diary and scenario inserts; preserves on replay", async () => {
    const db = getDb();
    db.delete(diaryEntries).run();
    db.delete(scenarioAnswers).run();

    await appendDiaryEntryForUser(db, {
      userId: USER_A,
      body: "diary embedding line",
      idempotencyKey: "diary-idem-x",
    });
    let dRow = db
      .select({ embeddingJson: diaryEntries.embeddingJson })
      .from(diaryEntries)
      .where(eq(diaryEntries.idempotencyKey, "diary-idem-x"))
      .get();
    const dEj = dRow?.embeddingJson;
    expect(dEj).not.toBe(null);

    await appendDiaryEntryForUser(db, {
      userId: USER_A,
      body: "other",
      idempotencyKey: "diary-idem-x",
    });
    dRow = db
      .select({ embeddingJson: diaryEntries.embeddingJson })
      .from(diaryEntries)
      .where(eq(diaryEntries.idempotencyKey, "diary-idem-x"))
      .get();
    expect(dRow?.embeddingJson).toBe(dEj);

    const payloadJson = JSON.stringify({ n: 1 });
    const scenarioEmbedExpectedJson = serializeEmbeddingJson(
      embedTwinMemoryText(composeScenarioEmbedInput("scenario-e", payloadJson)),
    );

    await appendScenarioAnswerForUser(db, {
      userId: USER_A,
      scenarioKey: "scenario-e",
      payloadJson,
      idempotencyKey: "scenario-idem-x",
    });
    let sRow = db
      .select({ embeddingJson: scenarioAnswers.embeddingJson })
      .from(scenarioAnswers)
      .where(eq(scenarioAnswers.idempotencyKey, "scenario-idem-x"))
      .get();

    expect(scenarioEmbedExpectedJson).not.toBe(null);
    expect(sRow?.embeddingJson).toBe(scenarioEmbedExpectedJson);

    await appendScenarioAnswerForUser(db, {
      userId: USER_A,
      scenarioKey: "other",
      payloadJson: "{}",
      idempotencyKey: "scenario-idem-x",
    });
    sRow = db
      .select({ embeddingJson: scenarioAnswers.embeddingJson })
      .from(scenarioAnswers)
      .where(eq(scenarioAnswers.idempotencyKey, "scenario-idem-x"))
      .get();
    expect(sRow?.embeddingJson).toBe(scenarioEmbedExpectedJson);
  });

  it("searchTwinMemoriesByText ranks nearer content higher and preserves user isolation", async () => {
    const db = getDb();
    ensureUserTwinSeed(db, USER_A);
    db.delete(diaryEntries).run();
    db.delete(scenarioAnswers).run();
    db.delete(twinDialogueTurns).run();

    const uniqueToken = `retrieval_anchor_TOKEN_${Math.random().toString(36).slice(2)}`;
    await appendDiaryEntryForUser(db, {
      userId: USER_A,
      body: uniqueToken,
      idempotencyKey: null,
    });
    await appendDiaryEntryForUser(db, {
      userId: USER_A,
      body: "!@#^*".repeat(40),
      idempotencyKey: null,
    });

    const hitsA = searchTwinMemoriesByText(db, USER_A, uniqueToken, 10);
    expect(hitsA.length).toBeGreaterThanOrEqual(1);

    expect(hitsA[0]?.previewText).toBe(uniqueToken);
    const noiseHit = hitsA.find((h) => h.previewText.includes("!@#^*"));
    if (noiseHit) {
      expect(hitsA[0]!.score).toBeGreaterThanOrEqual(noiseHit.score);
    }

    await appendDiaryEntryForUser(db, {
      userId: USER_B,
      body: `${uniqueToken} ghost for B`,
      idempotencyKey: null,
    });
    const idsB = new Set(
      db
        .select({ id: diaryEntries.id })
        .from(diaryEntries)
        .where(eq(diaryEntries.userId, USER_B))
        .all()
        .map((r) => r.id),
    );
    const hitsA2 = searchTwinMemoriesByText(db, USER_A, uniqueToken, 10);
    for (const h of hitsA2) {
      if (h.source === "diary" && idsB.has(h.id)) {
        throw new Error("user A leaked user B diary");
      }
    }
  });
});
