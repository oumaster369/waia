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
  CONTRADICTION_DETECTOR_SEED_QUERIES,
  runTwinContradictionDetectorForUser,
} from "@/lib/reasoning/twin-contradiction-detector";
import { TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import { appendDiaryEntryForUser } from "@/lib/twin-persistence/diary-memory";
import {
  appendTwinPredictionVerificationForUser,
} from "@/lib/twin-persistence/twin-prediction-verifications";
import { ensureUserTwinSeed, persistUserTwinExchangeWithAssistantStub } from "@/lib/twin-persistence/loader";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_EMPTY = "cdetect-empty";
const USER_STATED = "cdetect-stated";
const USER_EMOTION = "cdetect-emotion";
const USER_FAIL = "cdetect-fail";

function rankSeverity(s: string): number {
  if (s === "high") {
    return 0;
  }
  if (s === "medium") {
    return 1;
  }
  return 2;
}

describe("runTwinContradictionDetectorForUser (DEE-30)", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-contra-det-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    for (const u of [USER_EMPTY, USER_STATED, USER_EMOTION, USER_FAIL]) {
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

  it("returns empty contradictions for user with no memory and no verifications (seed retrieval)", () => {
    const db = getDb();
    const r = runTwinContradictionDetectorForUser(db, USER_EMPTY, {});
    expect(r.schemaVersion).toBe(TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION);
    expect(r.contradictions).toEqual([]);
    expect(r.memoryItemsConsidered).toBe(0);
    expect(r.verificationItemsConsidered).toBe(0);
    expect(r.seedQueryCount).toBe(CONTRADICTION_DETECTOR_SEED_QUERIES.length);
    expect(r.scenarioUsed).toBe(false);
  });

  it("scenario path uses single retrieval seed count and retrieval top-N cap", () => {
    const db = getDb();
    const twinProfileId = ensureUserTwinSeed(db, USER_STATED);
    persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId,
      userContent: "nightly coding drills for skills",
      userIdempotencyKey: null,
      assistantContent: "Steady practice helps.",
    });
    const r = runTwinContradictionDetectorForUser(db, USER_STATED, {
      scenarioForRulesAndRetrieval: "I will never procrastinate on coding anymore",
    });
    expect(r.scenarioUsed).toBe(true);
    expect(r.seedQueryCount).toBe(1);
    expect(r.memoryItemsConsidered).toBeLessThanOrEqual(16);
    expect(r.contradictions.some((c) => c.type === "stated_intention_vs_past_behavior")).toBe(true);
  });

  it("pattern summary lexical contradictions surface emotional_inconsistency (high severity)", () => {
    const db = getDb();
    appendDiaryEntryForUser(db, {
      userId: USER_EMOTION,
      body: "Today I remain calm about the rollout plan",
      idempotencyKey: null,
    });
    appendDiaryEntryForUser(db, {
      userId: USER_EMOTION,
      body: "Later I grew anxious waiting for uptime quietly",
      idempotencyKey: null,
    });
    const r = runTwinContradictionDetectorForUser(db, USER_EMOTION, {});
    const emo = r.contradictions.find((c) => c.type === "emotional_inconsistency");
    expect(emo).toBeDefined();
    expect(emo?.severity).toBe("high");
    expect(emo?.evidence.some((e) => e.includes("[pattern_summary]"))).toBe(true);
  });

  it("repeated inaccurate verifications trigger repeated_failure_patterns", () => {
    const db = getDb();
    ensureUserTwinSeed(db, USER_FAIL);
    appendTwinPredictionVerificationForUser(db, USER_FAIL, {
      scenario: "alpha path contradiction",
      verification: "inaccurate",
      correction: "missed blocker",
    });
    appendTwinPredictionVerificationForUser(db, USER_FAIL, {
      scenario: "beta path contradiction signal",
      verification: "inaccurate",
      correction: "",
    });
    const r = runTwinContradictionDetectorForUser(db, USER_FAIL, {});
    expect(
      r.contradictions.some((c) => c.type === "repeated_failure_patterns"),
    ).toBe(true);
    expect(r.verificationItemsConsidered).toBe(2);
  });

  it("produces identical output for identical invocation (deterministic)", () => {
    const db = getDb();
    const twinProfileId = ensureUserTwinSeed(db, USER_STATED);
    persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId,
      userContent: "nightly coding drills for skills practice",
      userIdempotencyKey: null,
      assistantContent: "Keep iterating.",
    });
    const o = {
      scenarioForRulesAndRetrieval:
        "I will never procrastinate on coding anymore I always commit daily",
    } as const;
    const a = runTwinContradictionDetectorForUser(db, USER_STATED, o);
    const b = runTwinContradictionDetectorForUser(db, USER_STATED, o);
    expect(a).toEqual(b);
  });

  it("orders contradictions by severity high before medium before low", () => {
    const db = getDb();
    appendDiaryEntryForUser(db, {
      userId: USER_EMOTION,
      body: "Today calm about work then anxious spike later",
      idempotencyKey: null,
    });
    appendDiaryEntryForUser(db, {
      userId: USER_EMOTION,
      body: "Opposite mood swings during project calm anxious",
      idempotencyKey: null,
    });
    appendTwinPredictionVerificationForUser(db, USER_EMOTION, {
      scenario: "v1 contradiction",
      verification: "inaccurate",
      correction: "fix",
    });
    appendTwinPredictionVerificationForUser(db, USER_EMOTION, {
      scenario: "v2 contradiction repeat",
      verification: "inaccurate",
      correction: "oops",
    });
    appendTwinPredictionVerificationForUser(db, USER_EMOTION, {
      scenario: "v3 contradiction third",
      verification: "inaccurate",
      correction: "",
    });

    const r = runTwinContradictionDetectorForUser(db, USER_EMOTION, {});
    const ranks = r.contradictions.map((c) => rankSeverity(c.severity));
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]!);
    }
  });
});
