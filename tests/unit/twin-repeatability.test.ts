import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { twinRepeatabilityRecords } from "@/db/schema";
import {
  appendRepeatabilityRecordForUser,
  countRepeatabilityForPattern,
  hashTwinScenarioRepeatabilityHex,
  inferRepeatabilityPatternType,
  listRepeatabilityRecordsForUser,
  TWIN_REPEATABILITY_DEDUP_WINDOW_MS,
} from "@/lib/twin-persistence/twin-repeatability";
import { analyzeRepeatability } from "@/lib/reasoning/twin-repeatability-analyzer";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "rep-test-user-a";
const USER_B = "rep-test-user-b";

describe("twin repeatability (DEE-28)", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-rep-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "rep-a@example.com",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "rep-b@example.com",
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

  it("hashing is deterministic for the same normalized scenario", () => {
    const h1 = hashTwinScenarioRepeatabilityHex("  Hello   World ").scenarioHashHex;
    const h2 = hashTwinScenarioRepeatabilityHex("hello world").scenarioHashHex;
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64);
  });

  it("different raw scenarios that normalize the same share a hash", () => {
    const a = hashTwinScenarioRepeatabilityHex("  X  Y ").scenarioHashHex;
    const b = hashTwinScenarioRepeatabilityHex("x y").scenarioHashHex;
    expect(a).toBe(b);
  });

  it("different scenarios do not collide (distinct hashes)", () => {
    const a = hashTwinScenarioRepeatabilityHex("alpha scenario uno").scenarioHashHex;
    const b = hashTwinScenarioRepeatabilityHex("beta scenario dos").scenarioHashHex;
    expect(a).not.toBe(b);
  });

  it("inferRepeatabilityPatternType picks first ordered match", () => {
    expect(inferRepeatabilityPatternType("i avoid that meeting")).toBe("avoidance");
    expect(inferRepeatabilityPatternType("missed the deadline yesterday")).toBe("delay");
    expect(inferRepeatabilityPatternType("constant argument with boss")).toBe("conflict_loop");
    expect(inferRepeatabilityPatternType("plain day")).toBe("general_pattern");
  });

  it("append increments count and analyzer aggregates by pattern type", () => {
    const db = getDb();
    db.delete(twinRepeatabilityRecords).run();

    const scenarioA = "neutral topic one";
    const scenarioB = "neutral topic two";
    const hashA = hashTwinScenarioRepeatabilityHex(scenarioA).scenarioHashHex;
    const patternType = inferRepeatabilityPatternType(
      hashTwinScenarioRepeatabilityHex(scenarioA).normalized,
    );

    const r1 = appendRepeatabilityRecordForUser(db, USER_A, {
      scenarioTrimmed: scenarioA,
      verificationResult: "accurate",
      predictionOutcomeOverride: "outcome-a",
    });
    expect(r1.status).toBe("inserted");

    const r2 = appendRepeatabilityRecordForUser(db, USER_A, {
      scenarioTrimmed: scenarioB,
      verificationResult: "accurate",
      predictionOutcomeOverride: "outcome-b",
    });
    expect(r2.status).toBe("inserted");

    expect(countRepeatabilityForPattern(db, USER_A, patternType, hashA)).toBe(1);

    const analyzed = analyzeRepeatability(db, USER_A);
    const agg = analyzed.repeatedPatterns.find((p) => p.patternType === patternType);
    expect(agg?.occurrences).toBe(2);
    expect(agg?.lastSeenAt).toMatch(/^\d{4}-/);

    const sorted = [...analyzed.repeatedPatterns].map((p) => p.patternType);
    expect(sorted).toEqual([...sorted].sort((a, b) => a.localeCompare(b)));
  });

  it("dedupes identical tuple within timestamp window", () => {
    const db = getDb();
    db.delete(twinRepeatabilityRecords).run();

    const scenario = "dedup window scenario";
    const a = appendRepeatabilityRecordForUser(db, USER_A, {
      scenarioTrimmed: scenario,
      verificationResult: "partially_accurate",
      predictionOutcomeOverride: "o1",
    });
    const b = appendRepeatabilityRecordForUser(db, USER_A, {
      scenarioTrimmed: scenario,
      verificationResult: "partially_accurate",
      predictionOutcomeOverride: "o2",
    });
    expect(a.status).toBe("inserted");
    expect(b.status).toBe("deduped");

    const rows = listRepeatabilityRecordsForUser(db, USER_A);
    expect(rows).toHaveLength(1);
  });

  it("user isolation: counts are per user", () => {
    const db = getDb();
    db.delete(twinRepeatabilityRecords).run();

    const scenario = "isolation case";
    const { scenarioHashHex } = hashTwinScenarioRepeatabilityHex(scenario);
    const pt = inferRepeatabilityPatternType(hashTwinScenarioRepeatabilityHex(scenario).normalized);

    appendRepeatabilityRecordForUser(db, USER_A, {
      scenarioTrimmed: scenario,
      verificationResult: "inaccurate",
      predictionOutcomeOverride: "x",
    });

    expect(countRepeatabilityForPattern(db, USER_B, pt, scenarioHashHex)).toBe(0);
    expect(analyzeRepeatability(db, USER_B).repeatedPatterns).toEqual([]);
    expect(countRepeatabilityForPattern(db, USER_A, pt, scenarioHashHex)).toBe(1);
  });

  it("analyzeRepeatability with scenario filter restricts to matching hash", () => {
    const db = getDb();
    db.delete(twinRepeatabilityRecords).run();

    appendRepeatabilityRecordForUser(db, USER_A, {
      scenarioTrimmed: "only filter scenario",
      verificationResult: "accurate",
      predictionOutcomeOverride: "a",
    });
    appendRepeatabilityRecordForUser(db, USER_A, {
      scenarioTrimmed: "other topic entirely",
      verificationResult: "accurate",
      predictionOutcomeOverride: "b",
    });

    const filtered = analyzeRepeatability(db, USER_A, { scenarioText: "only filter scenario" });
    expect(filtered.repeatedPatterns.length).toBe(1);
    expect(filtered.repeatedPatterns[0]!.occurrences).toBe(1);
  });

  it("analyzeRepeatability for user with no rows returns empty repeatedPatterns", () => {
    const db = getDb();
    db.delete(twinRepeatabilityRecords).run();
    expect(analyzeRepeatability(db, USER_B).repeatedPatterns).toEqual([]);
  });

  it("exports dedup window constant for stability", () => {
    expect(TWIN_REPEATABILITY_DEDUP_WINDOW_MS).toBe(60_000);
  });
});
