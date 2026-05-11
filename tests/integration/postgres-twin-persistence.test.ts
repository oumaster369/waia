/**
 * DEE-72.1 / DEE-72.2 / DEE-72.3 / DEE-72.5: Postgres twin/diary, verifications, memory retrieval, repeatability (opt-in integration).
 * Requires migrated Postgres + WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES.
 * Does not claim SQLite/Postgres behavioral parity.
 */

import { describe, expect, it, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import {
  composeTwinDialogueTurnEmbedInput,
  embedTwinMemoryText,
  serializeEmbeddingJson,
} from "@/lib/embeddings/twin-memory-embeddings";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { TWIN_REPEATABILITY_SCHEMA_VERSION } from "@/lib/dashboard/twin-repeatability-api.types";
import { createPostgresTwinPersistence } from "@/lib/persistence/postgres/twin-persistence";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";
import { hashTwinScenarioRepeatabilityHex, inferRepeatabilityPatternType } from "@/lib/twin-persistence/twin-repeatability";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)("postgres twin persistence (DEE-72.1, DEE-72.2, DEE-72.3, DEE-72.5)", () => {
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
      await sql.unsafe(`DELETE FROM twin_prediction_verifications WHERE user_id = $1`, [testUserId]);
      await sql.unsafe(`DELETE FROM twin_repeatability_records WHERE user_id = $1`, [testUserId]);
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

  it("prediction verification append persists (separate session)", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    const dto = await p.appendTwinPredictionVerificationForUser({
      userId: testUserId,
      scenario: "scenario-pg",
      verification: "accurate",
      predictionId: "pred-1",
      correction: " c ",
    });

    const verify = postgres(url!, { max: 1 });
    try {
      const rows = await verify<
        { prediction_id: string | null; correction: string | null; verification: string }[]
      >`
        SELECT prediction_id, correction, verification FROM twin_prediction_verifications
        WHERE user_id = ${testUserId} AND id = ${dto.id}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0]?.prediction_id).toBe("pred-1");
      expect(rows[0]?.correction).toBe("c");
      expect(rows[0]?.verification).toBe("accurate");
    } finally {
      await verify.end({ timeout: 5 });
    }
  });

  it("prediction verification list is newest-first with limit", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    await p.appendTwinPredictionVerificationForUser({
      userId: testUserId,
      scenario: "older",
      verification: "partially_accurate",
    });
    await new Promise((r) => setTimeout(r, 15));
    await p.appendTwinPredictionVerificationForUser({
      userId: testUserId,
      scenario: "newer",
      verification: "inaccurate",
    });

    const list = await p.listTwinPredictionVerificationsForUser(testUserId);
    expect(list.length).toBe(2);
    expect(list[0]?.scenario).toBe("newer");
    expect(list[1]?.scenario).toBe("older");

    const one = await p.listTwinPredictionVerificationsForUser(testUserId, 1);
    expect(one.length).toBe(1);
    expect(one[0]?.scenario).toBe("newer");
  });

  it("prediction verification list clamps limit to 100", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    for (let i = 0; i < 102; i += 1) {
      await p.appendTwinPredictionVerificationForUser({
        userId: testUserId,
        scenario: `clamp-${i}`,
        verification: "accurate",
      });
    }

    const list = await p.listTwinPredictionVerificationsForUser(testUserId, 200);
    expect(list.length).toBe(100);
  });

  it("searchTwinMemoriesByText ranks dialogue match above diary and scenario (embed query)", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    const twinProfileId = await p.ensureUserTwinSeed(testUserId);

    await p.appendTwinDialogueTurnResult({
      twinProfileId,
      role: "user",
      content: "hello-rank-mem",
      idempotencyKey: "mem-d1",
    });
    await p.appendDiaryEntryForUser({
      userId: testUserId,
      body: "diary-distractor-body",
      idempotencyKey: "mem-di1",
    });
    await p.appendScenarioAnswerForUser({
      userId: testUserId,
      scenarioKey: "mem-sk",
      payloadJson: "{}",
      idempotencyKey: "mem-sc1",
    });

    const query = composeTwinDialogueTurnEmbedInput("user", "hello-rank-mem");
    const hits = await p.searchTwinMemoriesByText(testUserId, query, 10);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.source).toBe("dialogue");
    expect(hits[0]?.previewText).toBe("user: hello-rank-mem");
  });

  it("searchTwinMemoriesByText topN defaults to 10 when omitted", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    for (let i = 0; i < 12; i += 1) {
      await p.appendDiaryEntryForUser({
        userId: testUserId,
        body: `bulk-diary-${i}`,
        idempotencyKey: `mem-bulk-${i}`,
      });
    }

    const hits = await p.searchTwinMemoriesByText(testUserId, "bulk-diary");
    expect(hits.length).toBe(10);
  });

  it("searchTwinMemoriesByText clamps topN to max 100", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    for (let i = 0; i < 102; i += 1) {
      await p.appendDiaryEntryForUser({
        userId: testUserId,
        body: `clamp-mem-${i}`,
        idempotencyKey: `mem-clamp-${i}`,
      });
    }

    const hits = await p.searchTwinMemoriesByText(testUserId, "clamp-mem", 500);
    expect(hits.length).toBe(100);
  });

  it("searchTwinMemoriesByText returns empty when user has no embedded rows", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    const hits = await p.searchTwinMemoriesByText(testUserId, "nothing", 10);
    expect(hits).toEqual([]);
  });

  it("searchTwinMemoriesByText unknown user yields no hits and creates no twin profile", async () => {
    const ghostUserId = "00000000-0000-4000-8000-00000000d0e2";
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    const hits = await p.searchTwinMemoriesByText(ghostUserId, "ghost-query", 5);
    expect(hits).toEqual([]);

    const verify = postgres(url!, { max: 1 });
    try {
      const rows = await verify<{ n: string }[]>`
        SELECT count(*)::text AS n FROM twin_profiles WHERE user_id = ${ghostUserId}
      `;
      expect(rows[0]?.n).toBe("0");
    } finally {
      await verify.end({ timeout: 5 });
    }
  });

  it("searchTwinMemoriesByText diary preview truncates at 200 chars like SQLite", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    const longBody = "x".repeat(250);
    await p.appendDiaryEntryForUser({
      userId: testUserId,
      body: longBody,
      idempotencyKey: "mem-long",
    });

    const hits = await p.searchTwinMemoriesByText(testUserId, longBody.slice(0, 20), 5);
    const diaryHit = hits.find((h) => h.source === "diary");
    expect(diaryHit).toBeDefined();
    expect(diaryHit?.previewText.length).toBe(198);
    expect(diaryHit?.previewText.endsWith("…")).toBe(true);
    expect(diaryHit?.previewText.startsWith("xxx")).toBe(true);
  });

  it("searchTwinMemoriesByText scenario preview uses stringified jsonb payload", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    await p.appendScenarioAnswerForUser({
      userId: testUserId,
      scenarioKey: "payload-sk",
      payloadJson: JSON.stringify({ alpha: "zeta", beta: 2 }),
      idempotencyKey: "mem-pay1",
    });

    const hits = await p.searchTwinMemoriesByText(testUserId, "payload-sk", 5);
    const sc = hits.find((h) => h.source === "scenario");
    expect(sc).toBeDefined();
    expect(sc?.previewText.startsWith("payload-sk:")).toBe(true);
    expect(sc?.previewText).toContain("alpha");
    expect(sc?.previewText).toContain("zeta");
  });

  it("searchTwinMemoriesByText parses embedding_json stored as jsonb array literal", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    const twinProfileId = await p.ensureUserTwinSeed(testUserId);
    const vec = embedTwinMemoryText("jsonb-array-needle");
    const sj = serializeEmbeddingJson(vec);
    expect(sj).not.toBeNull();

    await db.insert(pgSchema.diaryEntries).values({
      id: crypto.randomUUID(),
      userId: testUserId,
      twinProfileId,
      body: "jsonb-array-body",
      idempotencyKey: "mem-jsonb-arr",
      embeddingJson: JSON.parse(sj!) as unknown,
      embeddingModel: "stub-deterministic-v1",
    });

    const hits = await p.searchTwinMemoriesByText(testUserId, "jsonb-array-needle", 5);
    expect(hits.some((h) => h.previewText === "jsonb-array-body")).toBe(true);
  });

  it("resolveTwinPersistence exposes memory search without seed on read-only path", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = resolveTwinPersistence({ kind: "postgres", db });

    await p.appendDiaryEntryForUser({
      userId: testUserId,
      body: "resolver-mem",
      idempotencyKey: "mem-res1",
    });

    const hits = await p.searchTwinMemoriesByText(testUserId, "resolver-mem", 5);
    expect(hits.some((h) => h.previewText === "resolver-mem")).toBe(true);
  });

  it("appendRepeatabilityRecordForUser + analyzeRepeatabilityForUser aggregate by pattern type (DEE-72.5)", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    const scenarioA = "neutral topic one";
    const scenarioB = "neutral topic two";
    const patternType = inferRepeatabilityPatternType(
      hashTwinScenarioRepeatabilityHex(scenarioA).normalized,
    );

    const r1 = await p.appendRepeatabilityRecordForUser({
      userId: testUserId,
      scenarioTrimmed: scenarioA,
      verificationResult: "accurate",
      predictionOutcomeOverride: "outcome-a",
    });
    const r2 = await p.appendRepeatabilityRecordForUser({
      userId: testUserId,
      scenarioTrimmed: scenarioB,
      verificationResult: "accurate",
      predictionOutcomeOverride: "outcome-b",
    });
    expect(r1.status).toBe("inserted");
    expect(r2.status).toBe("inserted");

    const analyzed = await p.analyzeRepeatabilityForUser(testUserId);
    expect(analyzed.schemaVersion).toBe(TWIN_REPEATABILITY_SCHEMA_VERSION);
    const agg = analyzed.repeatedPatterns.find((x) => x.patternType === patternType);
    expect(agg?.occurrences).toBe(2);
    expect(agg?.lastSeenAt).toMatch(/^\d{4}-/);
  });

  it("appendRepeatabilityRecordForUser dedupes identical tuple within window (DEE-72.5)", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    const scenario = "dedup window scenario pg";
    const a = await p.appendRepeatabilityRecordForUser({
      userId: testUserId,
      scenarioTrimmed: scenario,
      verificationResult: "partially_accurate",
      predictionOutcomeOverride: "o1",
    });
    const b = await p.appendRepeatabilityRecordForUser({
      userId: testUserId,
      scenarioTrimmed: scenario,
      verificationResult: "partially_accurate",
      predictionOutcomeOverride: "o2",
    });
    expect(a.status).toBe("inserted");
    expect(b.status).toBe("deduped");
  });

  it("analyzeRepeatabilityForUser respects scenario filter (DEE-72.5)", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    await p.appendRepeatabilityRecordForUser({
      userId: testUserId,
      scenarioTrimmed: "only filter scenario pg",
      verificationResult: "accurate",
      predictionOutcomeOverride: "a",
    });
    await p.appendRepeatabilityRecordForUser({
      userId: testUserId,
      scenarioTrimmed: "other topic entirely pg",
      verificationResult: "accurate",
      predictionOutcomeOverride: "b",
    });
    const filtered = await p.analyzeRepeatabilityForUser(testUserId, {
      scenarioText: "only filter scenario pg",
    });
    expect(filtered.repeatedPatterns.length).toBe(1);
    expect(filtered.repeatedPatterns[0]?.occurrences).toBe(1);
  });
});
