/**
 * DEE-72.4b: Async twin prediction + pattern summary on Postgres via reasoning ports (opt-in integration).
 * Requires migrated Postgres + WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES.
 * Does not claim SQLite/Postgres behavioral parity.
 *
 * Intentionally avoids `@/db/client` / `getDb()` so this file does not open SQLite.
 */

import { describe, expect, it, afterEach } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { TWIN_PATTERN_SUMMARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-pattern-summary-api.types";
import * as pgSchema from "@/db/schema.postgres";
import { createPostgresTwinPersistence } from "@/lib/persistence/postgres/twin-persistence";
import {
  getTwinPatternSummaryForUserAsync,
  PATTERN_SUMMARY_SEED_QUERIES,
} from "@/lib/reasoning/twin-pattern-summary";
import { runTwinPredictionForUserAsync } from "@/lib/reasoning/twin-prediction";
import { createTwinMemorySearchPortPostgres } from "@/lib/reasoning/twin-reasoning-ports";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

/** Matches `MAX_REASONING_LINES` in `lib/reasoning/twin-prediction.ts` (not exported). */
const MAX_REASONING_LINES = 14;

describe.skipIf(!integrationEnabled || !url)("postgres twin reasoning prediction (DEE-72.4b)", () => {
  const testUserId = "00000000-0000-4000-8000-00000000dee74b";

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
      identityLabel: "DEE-72.4b test",
      email: "dee74b-reasoning@waia.invalid",
      passwordHash: null,
    });
  }

  it("runTwinPredictionForUserAsync returns a bounded TwinPredictionApiResponse with embedded dialogue", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    const twinProfileId = await p.ensureUserTwinSeed(testUserId);

    await p.persistUserTwinExchangeWithAssistantStub({
      twinProfileId,
      userContent: "scenario match content for embeddings",
      userIdempotencyKey: "pg-pred-user-1",
      assistantContent: "Noted.",
    });

    const memoryPort = createTwinMemorySearchPortPostgres(p);
    const scenario = "if we ship next week under deadline pressure calmly";
    const r = await runTwinPredictionForUserAsync(memoryPort, testUserId, scenario);

    expect(r.outcome.length).toBeGreaterThan(0);
    expect(Array.isArray(r.reasoning)).toBe(true);
    expect(r.reasoning.length).toBeGreaterThan(0);
    expect(r.reasoning.length).toBeLessThanOrEqual(MAX_REASONING_LINES);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(Number.isFinite(r.confidence)).toBe(true);
  });

  it("getTwinPatternSummaryForUserAsync returns schema-stable summary after diary write", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    await p.ensureUserTwinSeed(testUserId);

    await p.appendDiaryEntryForUser({
      userId: testUserId,
      body: "values and goals contradiction stress mood",
      idempotencyKey: "pg-sum-diary-1",
    });

    const memoryPort = createTwinMemorySearchPortPostgres(p);
    const summary = await getTwinPatternSummaryForUserAsync(memoryPort, testUserId);

    expect(summary.schemaVersion).toBe(TWIN_PATTERN_SUMMARY_SCHEMA_VERSION);
    expect(summary.seedQueryCount).toBe(PATTERN_SUMMARY_SEED_QUERIES.length);
    expect(summary.memoryItemsConsidered).toBeGreaterThan(0);
  });

  it("runTwinPredictionForUserAsync uses conservative empty-corpus path when no embedded memories exist", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    await p.ensureUserTwinSeed(testUserId);

    const memoryPort = createTwinMemorySearchPortPostgres(p);
    const r = await runTwinPredictionForUserAsync(memoryPort, testUserId, "exploring next steps calmly");

    expect(r.outcome).toContain("Insufficient Twin memory");
    expect(r.confidence).toBe(0.2);
    expect(r.reasoning.some((line) => line.includes("empty corpus"))).toBe(true);
  });
});
