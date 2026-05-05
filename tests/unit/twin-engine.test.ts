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
import { MAX_SCENARIO_CHARS } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import { TWIN_ENGINE_SCHEMA_VERSION } from "@/lib/dashboard/twin-engine-api.types";
import {
  normalizeTwinEngineScenario,
  runTwinEngine,
  TwinEngineScenarioTooLongError,
  TWIN_ENGINE_LAYER_BOUNDARIES,
} from "@/lib/reasoning/twin-engine";
import { TWIN_PATTERN_SUMMARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-pattern-summary-api.types";
import { TWIN_PERSONALITY_MODEL_SCHEMA_VERSION } from "@/lib/dashboard/twin-personality-model-api.types";
import { TWIN_REPEATABILITY_SCHEMA_VERSION } from "@/lib/dashboard/twin-repeatability-api.types";
import {
  appendTwinPredictionVerificationForUser,
} from "@/lib/twin-persistence/twin-prediction-verifications";
import { ensureUserTwinSeed, persistUserTwinExchangeWithAssistantStub } from "@/lib/twin-persistence/loader";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_EMPTY = "engine-empty";
const USER_SEED_A = "engine-user-a";
const USER_SEED_B = "engine-user-b";

describe("twin engine (DEE-36)", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-twin-engine-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    for (const u of [USER_EMPTY, USER_SEED_A, USER_SEED_B]) {
      insertEmailPasswordUser(db, {
        id: u,
        email: `${u}@example.com`,
        password: "password123",
      });
    }
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

  it("exports layer boundaries marker for docs", () => {
    expect(TWIN_ENGINE_LAYER_BOUNDARIES).toContain("memory");
    expect(TWIN_ENGINE_LAYER_BOUNDARIES).toContain("personality");
  });

  it("normalizeTwinEngineScenario rejects over max length", () => {
    const long = "x".repeat(MAX_SCENARIO_CHARS + 1);
    expect(() => normalizeTwinEngineScenario(long)).toThrow(TwinEngineScenarioTooLongError);
    try {
      normalizeTwinEngineScenario(long);
    } catch (e) {
      expect(e).toBeInstanceOf(TwinEngineScenarioTooLongError);
      expect((e as TwinEngineScenarioTooLongError).code).toBe("SCENARIO_TOO_LONG");
    }
  });

  it("runTwinEngine without scenario returns all sections and null prediction", () => {
    const db = getDb();
    const r = runTwinEngine(db, { userId: USER_EMPTY });
    expect(r.schemaVersion).toBe(TWIN_ENGINE_SCHEMA_VERSION);
    expect(r.patternSummary.schemaVersion).toBe(TWIN_PATTERN_SUMMARY_SCHEMA_VERSION);
    expect(r.contradictions.contradictions).toEqual([]);
    expect(r.repeatability.schemaVersion).toBe(TWIN_REPEATABILITY_SCHEMA_VERSION);
    expect(r.repeatability.repeatedPatterns).toEqual([]);
    expect(r.personalityModel.schemaVersion).toBe(TWIN_PERSONALITY_MODEL_SCHEMA_VERSION);
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

  it("runTwinEngine with scenario and includePrediction false uses detector scenario path", () => {
    const db = getDb();
    const r = runTwinEngine(db, {
      userId: USER_EMPTY,
      scenario: "stress avoidance delay decision",
      includePrediction: false,
    });
    expect(r.engineMeta.scenarioUsed).toBe(true);
    expect(r.prediction).toBeNull();
    expect(r.contradictions.scenarioUsed).toBe(true);
    expect(r.engineMeta.modulesRun).not.toContain("prediction");
  });

  it("runTwinEngine with scenario and includePrediction true runs prediction", () => {
    const db = getDb();
    const r = runTwinEngine(db, {
      userId: USER_EMPTY,
      scenario: "calm planning for next week",
      includePrediction: true,
    });
    expect(r.prediction).not.toBeNull();
    expect(r.prediction?.outcome.length).toBeGreaterThan(0);
    expect(r.engineMeta.predictionRequested).toBe(true);
    expect(r.engineMeta.modulesRun[r.engineMeta.modulesRun.length - 1]).toBe("prediction");
  });

  it("runTwinEngine is deterministic for same input and db state", () => {
    const db = getDb();
    const input = { userId: USER_EMPTY, scenario: "hello world scenario", includePrediction: true };
    const a = runTwinEngine(db, input);
    const b = runTwinEngine(db, input);
    expect(a).toEqual(b);
  });

  it("empty user: no crash and stable empty personality envelope", () => {
    const db = getDb();
    const r = runTwinEngine(db, { userId: USER_EMPTY });
    expect(r.personalityModel.model.confidence).toBeGreaterThanOrEqual(0);
    expect(r.personalityModel.model.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(r.personalityModel.model.dominantTraits)).toBe(true);
    expect(Array.isArray(r.personalityModel.model.contradictionProfile)).toBe(true);
  });

  it("user isolation: seeded user differs from empty user", async () => {
    const db = getDb();
    const twinA = ensureUserTwinSeed(db, USER_SEED_A);
    await persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId: twinA,
      userContent: "I value consistency and calm planning before big decisions.",
      userIdempotencyKey: null,
      assistantContent: "Acknowledged; we'll anchor on steady planning signals.",
    });

    const a = runTwinEngine(db, { userId: USER_SEED_A });
    const b = runTwinEngine(db, { userId: USER_SEED_B });

    expect(a.patternSummary).not.toEqual(b.patternSummary);
  });

  it("personality input uses safe slices only (no extra keys on model)", () => {
    const db = getDb();
    const r = runTwinEngine(db, { userId: USER_EMPTY });
    const keys = Object.keys(r.personalityModel.model).sort();
    expect(keys).toEqual([
      "behavioralPatterns",
      "confidence",
      "contradictionProfile",
      "decisionStyle",
      "dominantTraits",
      "emotionalBaseline",
      "growthEdges",
      "relationshipStyle",
    ]);
  });

  it("verification rows increase personality verificationItemsConsidered", () => {
    const db = getDb();
    appendTwinPredictionVerificationForUser(db, USER_EMPTY, {
      scenario: "x",
      verification: "accurate",
    });
    const r = runTwinEngine(db, { userId: USER_EMPTY });
    expect(r.personalityModel.sourceSignals.verificationItemsConsidered).toBe(1);
  });
});
