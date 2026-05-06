/**
 * DEE-72.1: Postgres twin/diary persistence (opt-in integration).
 * Requires migrated Postgres + WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES.
 * Does not claim SQLite/Postgres behavioral parity.
 */

import { describe, expect, it, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { createPostgresTwinPersistence } from "@/lib/persistence/postgres/twin-persistence";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)("postgres twin persistence (DEE-72.1)", () => {
  const testUserId = "00000000-0000-4000-8000-00000000dee7";

  afterEach(async () => {
    if (!url) return;
    const sql = postgres(url, { max: 1 });
    try {
      await sql.unsafe(`DELETE FROM twin_dialogue_turns WHERE twin_profile_id IN (SELECT id FROM twin_profiles WHERE user_id = $1)`, [
        testUserId,
      ]);
      await sql.unsafe(`DELETE FROM scenario_answers WHERE twin_profile_id IN (SELECT id FROM twin_profiles WHERE user_id = $1)`, [
        testUserId,
      ]);
      await sql.unsafe(`DELETE FROM diary_entries WHERE user_id = $1`, [testUserId]);
      await sql.unsafe(`DELETE FROM twin_readiness_state WHERE twin_profile_id IN (SELECT id FROM twin_profiles WHERE user_id = $1)`, [
        testUserId,
      ]);
      await sql.unsafe(`DELETE FROM twin_profiles WHERE user_id = $1`, [testUserId]);
      await sql.unsafe(`DELETE FROM users WHERE id = $1`, [testUserId]);
    } finally {
      await sql.end({ timeout: 5 });
    }
    await resetPostgresSingletonForTests();
  });

  async function seedTestUser(): Promise<void> {
    const db = getPostgresDrizzle();
    await db.insert(pgSchema.users).values({
      id: testUserId,
      identityLabel: "DEE-72.1 test",
      email: "dee72-test@waia.invalid",
      passwordHash: null,
    });
  }

  it("dialogue write persists (verified via separate session)", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    const twinProfileId = await p.ensureUserTwinSeed(testUserId);

    await p.appendTwinDialogueTurnResult({
      twinProfileId,
      role: "user",
      content: "hello postgres",
      idempotencyKey: "idem-dialogue-1",
    });

    const verify = postgres(url!, { max: 1 });
    try {
      const rows = await verify<{ c: string }[]>`
        SELECT content AS c FROM twin_dialogue_turns
        WHERE twin_profile_id = ${twinProfileId} AND idempotency_key = ${"idem-dialogue-1"}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0]?.c).toBe("hello postgres");
    } finally {
      await verify.end({ timeout: 5 });
    }
  });

  it("diary write persists (verified via separate session)", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    await p.appendDiaryEntryForUser({
      userId: testUserId,
      body: "diary body pg",
      idempotencyKey: "idem-diary-1",
    });

    const verify = postgres(url!, { max: 1 });
    try {
      const rows = await verify<{ body: string }[]>`
        SELECT body FROM diary_entries WHERE user_id = ${testUserId}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0]?.body).toBe("diary body pg");
    } finally {
      await verify.end({ timeout: 5 });
    }
  });

  it("scenario answer write persists (verified via separate session)", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    const json = JSON.stringify({ k: "v" });
    await p.appendScenarioAnswerForUser({
      userId: testUserId,
      scenarioKey: "scenario-a",
      payloadJson: json,
      idempotencyKey: "idem-scen-1",
    });

    const verify = postgres(url!, { max: 1 });
    try {
      const rows = await verify<{ scenario_key: string }[]>`
        SELECT scenario_key FROM scenario_answers
        WHERE scenario_key = ${"scenario-a"} AND idempotency_key = ${"idem-scen-1"}
      `;
      expect(rows.length).toBe(1);
    } finally {
      await verify.end({ timeout: 5 });
    }
  });

  it("chronological dialogue reads work", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    const twinProfileId = await p.ensureUserTwinSeed(testUserId);

    await p.appendTwinDialogueTurnResult({
      twinProfileId,
      role: "user",
      content: "first",
      idempotencyKey: "c1",
    });
    await p.appendTwinDialogueTurnResult({
      twinProfileId,
      role: "assistant",
      content: "second",
      idempotencyKey: "c2",
    });

    const rows = await p.listTwinDialogueTurnsChronological(twinProfileId);
    expect(rows.length).toBe(2);
    expect(rows[0]?.sequence).toBe(1);
    expect(rows[1]?.sequence).toBe(2);
    expect(rows[0]?.content).toBe("first");
  });

  it("readiness payload loads after seed", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    const payload = await p.loadDashboardReadinessPayloadFromDb(testUserId);
    expect(payload.identityLabel).toBe("DEE-72.1 test");
    expect(payload.readinessInput.indicators.length).toBe(6);
    expect(payload.twinSignals.hasMeaningfulExchange).toBe(false);
  });

  it("rolls back multi-step dialogue write on throw (separate session)", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    const twinProfileId = await p.ensureUserTwinSeed(testUserId);

    await expect(
      runWaiaPostgresTransaction(db, async (tx) => {
        await tx.insert(pgSchema.twinDialogueTurns).values({
          id: crypto.randomUUID(),
          twinProfileId,
          sequence: 1,
          role: "user",
          content: "will rollback",
          idempotencyKey: "rb-1",
          embeddingJson: null,
          embeddingModel: null,
        });
        throw new Error("intentional abort");
      }),
    ).rejects.toThrow("intentional abort");

    const verify = postgres(url!, { max: 1 });
    try {
      const rows = await verify<{ n: string }[]>`
        SELECT count(*)::text AS n FROM twin_dialogue_turns WHERE twin_profile_id = ${twinProfileId}
      `;
      expect(rows[0]?.n).toBe("0");
    } finally {
      await verify.end({ timeout: 5 });
    }
  });

  it("resolveTwinPersistence postgres handle returns working boundary", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = resolveTwinPersistence({ kind: "postgres", db });
    await p.appendDiaryEntryForUser({ userId: testUserId, body: "via resolver" });

    const rows = await db.select().from(pgSchema.diaryEntries).where(eq(pgSchema.diaryEntries.userId, testUserId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.body).toBe("via resolver");
  });
});
