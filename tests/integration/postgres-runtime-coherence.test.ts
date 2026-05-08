/**
 * DEE-105: Opt-in Postgres coherence chain (verification → list → repeatability → Twin Engine).
 *
 * Mirrors production ordering for the Postgres persistence boundary (see
 * POST /api/dashboard/twin/prediction/verification and runTwinEnginePostgresAsync paths):
 * persist verification → record repeatability (best-effort, same as route) → read list → analyze
 * repeatability → async engine orchestration — all via one {@link createPostgresTwinPersistence}
 * against DATABASE_URL_POSTGRES.
 *
 * Opt-in gate: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES. Default CI / pnpm test skips this file.
 */

import { describe, expect, it, afterEach } from "vitest";
import postgres from "postgres";

import { TWIN_ENGINE_SCHEMA_VERSION } from "@/lib/dashboard/twin-engine-api.types";
import type { TwinPredictionVerificationKind } from "@/lib/dashboard/twin-prediction-verification-api.types";
import { TWIN_REPEATABILITY_SCHEMA_VERSION } from "@/lib/dashboard/twin-repeatability-api.types";
import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { createPostgresTwinPersistence } from "@/lib/persistence/postgres/twin-persistence";
import { runTwinEnginePostgresAsync } from "@/lib/reasoning/twin-engine-postgres";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)("postgres runtime coherence (DEE-105)", () => {
  const testUserId = "00000000-0000-4000-8000-00000000105co";

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
      identityLabel: "DEE-105 coherence test",
      email: "dee105-coherence@waia.invalid",
      passwordHash: null,
    });
  }

  it("append verification → list verifications → analyze repeatability → runTwinEnginePostgresAsync", async () => {
    await seedTestUser();

    const db = getPostgresDrizzle();
    const p = createPostgresTwinPersistence(db);

    const twinProfileId = await p.ensureUserTwinSeed(testUserId);
    await p.persistUserTwinExchangeWithAssistantStub({
      twinProfileId,
      userContent: "coherence grounding exchange for deterministic prediction inputs",
      userIdempotencyKey: "dee105-coherence-exchange",
      assistantContent: "Acknowledged.",
    });

    const scenarioTrimmed =
      "DEE-105 coherence scenario for bounded verification repeatability and twin engine on one postgres boundary";
    const verification: TwinPredictionVerificationKind = "accurate";

    const dto = await p.appendTwinPredictionVerificationForUser({
      userId: testUserId,
      scenario: scenarioTrimmed,
      verification,
      predictionId: "pred-coherence-dee105",
    });

    await p.appendRepeatabilityRecordForUser({
      userId: testUserId,
      scenarioTrimmed,
      verificationResult: verification,
    });

    const listed = await p.listTwinPredictionVerificationsForUser(testUserId);
    expect(listed.length).toBeGreaterThanOrEqual(1);
    expect(listed[0]?.id).toBe(dto.id);

    const repeatabilityRead = await p.analyzeRepeatabilityForUser(testUserId, {
      scenarioText: scenarioTrimmed,
    });
    expect(repeatabilityRead.schemaVersion).toBe(TWIN_REPEATABILITY_SCHEMA_VERSION);
    expect(repeatabilityRead.repeatedPatterns.some((row) => row.occurrences >= 1)).toBe(true);

    const engineResponse = await runTwinEnginePostgresAsync(p, {
      userId: testUserId,
      scenario: scenarioTrimmed,
      includePrediction: true,
    });

    expect(engineResponse.schemaVersion).toBe(TWIN_ENGINE_SCHEMA_VERSION);
    expect(engineResponse.repeatability.schemaVersion).toBe(TWIN_REPEATABILITY_SCHEMA_VERSION);
    expect(engineResponse.prediction).not.toBeNull();
    expect(engineResponse.engineMeta.predictionRequested).toBe(true);
  });
});
