/**
 * DEE-72.6: Postgres async Twin engine orchestration (opt-in integration).
 * Requires migrated Postgres + WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES.
 * Asserts response shape and engineMeta only — not SQLite/string parity.
 *
 * Intentionally avoids `@/db/client` / `getDb()` so this file does not open SQLite.
 */

import { describe, expect, it, afterEach } from "vitest";
import postgres from "postgres";

import { MAX_SCENARIO_CHARS } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import { TWIN_ENGINE_SCHEMA_VERSION } from "@/lib/dashboard/twin-engine-api.types";
import { TWIN_PATTERN_SUMMARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-pattern-summary-api.types";
import { TWIN_PERSONALITY_MODEL_SCHEMA_VERSION } from "@/lib/dashboard/twin-personality-model-api.types";
import { TWIN_REPEATABILITY_SCHEMA_VERSION } from "@/lib/dashboard/twin-repeatability-api.types";
import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { createPostgresTwinPersistence } from "@/lib/persistence/postgres/twin-persistence";
import { TwinEngineScenarioTooLongError, TWIN_ENGINE_LAYER_BOUNDARIES } from "@/lib/reasoning/twin-engine";
import { runTwinEnginePostgresAsync } from "@/lib/reasoning/twin-engine-postgres";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)("postgres twin engine async (DEE-72.6)", () => {
  const testUserId = "00000000-0000-4000-8000-00000000dee726";

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
      identityLabel: "DEE-72.6 test",
      email: "dee726-engine@waia.invalid",
      passwordHash: null,
    });
  }

  it("rejects scenario over max length like sync engine", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    await p.ensureUserTwinSeed(testUserId);
    const long = "x".repeat(MAX_SCENARIO_CHARS + 1);
    await expect(runTwinEnginePostgresAsync(p, { userId: testUserId, scenario: long })).rejects.toThrow(
      TwinEngineScenarioTooLongError,
    );
  });

  it("runTwinEnginePostgresAsync without scenario returns shaped response and null prediction", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    await p.ensureUserTwinSeed(testUserId);

    const r = await runTwinEnginePostgresAsync(p, { userId: testUserId });

    expect(TWIN_ENGINE_LAYER_BOUNDARIES).toContain("prediction");
    expect(r.schemaVersion).toBe(TWIN_ENGINE_SCHEMA_VERSION);
    expect(r.patternSummary.schemaVersion).toBe(TWIN_PATTERN_SUMMARY_SCHEMA_VERSION);
    expect(r.repeatability.schemaVersion).toBe(TWIN_REPEATABILITY_SCHEMA_VERSION);
    expect(r.personalityModel.schemaVersion).toBe(TWIN_PERSONALITY_MODEL_SCHEMA_VERSION);
    expect(Array.isArray(r.contradictions.contradictions)).toBe(true);
    expect(Array.isArray(r.repeatability.repeatedPatterns)).toBe(true);
    expect(r.prediction).toBeNull();
    expect(r.engineMeta.scenarioUsed).toBe(false);
    expect(r.engineMeta.predictionRequested).toBe(false);
    expect(r.engineMeta.generatedAt).toBeNull();
    expect(r.engineMeta.modulesRun).toEqual([
      "pattern_summary",
      "contradiction_detector",
      "repeatability_analyzer",
      "personality_model",
    ]);
    expect(r.engineMeta.modulesRun).not.toContain("prediction");
  });

  it("runTwinEnginePostgresAsync with scenario and includePrediction false leaves prediction null", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    await p.ensureUserTwinSeed(testUserId);

    const r = await runTwinEnginePostgresAsync(p, {
      userId: testUserId,
      scenario: "stress avoidance delay decision",
      includePrediction: false,
    });

    expect(r.engineMeta.scenarioUsed).toBe(true);
    expect(r.prediction).toBeNull();
    expect(r.contradictions.scenarioUsed).toBe(true);
    expect(r.engineMeta.modulesRun).not.toContain("prediction");
  });

  it("runTwinEnginePostgresAsync with includePrediction true appends prediction module", async () => {
    await seedTestUser();
    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);
    const twinProfileId = await p.ensureUserTwinSeed(testUserId);
    await p.persistUserTwinExchangeWithAssistantStub({
      twinProfileId,
      userContent: "calm planning notes for embeddings",
      userIdempotencyKey: "pg-engine-1",
      assistantContent: "Acknowledged.",
    });

    const r = await runTwinEnginePostgresAsync(p, {
      userId: testUserId,
      scenario: "calm planning for next week",
      includePrediction: true,
    });

    expect(r.prediction).not.toBeNull();
    expect(r.prediction!.outcome.length).toBeGreaterThan(0);
    expect(r.engineMeta.predictionRequested).toBe(true);
    expect(r.engineMeta.modulesRun[r.engineMeta.modulesRun.length - 1]).toBe("prediction");
  });
});
