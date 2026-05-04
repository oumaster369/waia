import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { twinPredictionVerifications } from "@/db/schema";
import {
  appendTwinPredictionVerificationForUser,
  clampVerificationListLimit,
  listTwinPredictionVerificationsForUser,
} from "@/lib/twin-persistence/twin-prediction-verifications";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "twin-pred-verify-persist-user-a";
const USER_B = "twin-pred-verify-persist-user-b";

describe("twin-prediction-verifications persistence", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-pred-verify-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "tpv-a@example.com",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "tpv-b@example.com",
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

  beforeEach(() => {
    getDb().delete(twinPredictionVerifications).run();
  });

  it("appends accurate verification without prediction id", () => {
    const db = getDb();
    const row = appendTwinPredictionVerificationForUser(db, USER_A, {
      scenario: "scenario text alpha",
      verification: "accurate",
    });
    expect(row.predictionId).toBe(null);
    expect(row.correction).toBe(null);
    expect(row.verification).toBe("accurate");
    expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("appends partially_accurate with correction and nullable prediction id", () => {
    const db = getDb();
    const row = appendTwinPredictionVerificationForUser(db, USER_A, {
      predictionId: null,
      scenario: "scenario beta",
      verification: "partially_accurate",
      correction: "  tweak needed  ",
    });
    expect(row.predictionId).toBe(null);
    expect(row.correction).toBe("tweak needed");
    expect(row.verification).toBe("partially_accurate");
  });

  it("appends inaccurate with correction and trims prediction id", () => {
    const db = getDb();
    const row = appendTwinPredictionVerificationForUser(db, USER_A, {
      predictionId: "  pid-xyz  ",
      scenario: "gamma path",
      verification: "inaccurate",
      correction: "full rewrite",
    });
    expect(row.predictionId).toBe("pid-xyz");
    expect(row.verification).toBe("inaccurate");
    expect(row.correction).toBe("full rewrite");
  });

  it("lists only current user rows in created_at descending order", () => {
    const db = getDb();
    appendTwinPredictionVerificationForUser(db, USER_A, {
      scenario: "first a",
      verification: "accurate",
    });
    appendTwinPredictionVerificationForUser(db, USER_A, {
      scenario: "second a",
      verification: "inaccurate",
    });
    appendTwinPredictionVerificationForUser(db, USER_B, {
      scenario: "only b secret",
      verification: "accurate",
    });

    const la = listTwinPredictionVerificationsForUser(db, USER_A);
    expect(la).toHaveLength(2);
    expect(new Set(la.map((x) => x.scenario))).toEqual(new Set(["first a", "second a"]));
    expect(Date.parse(la[0]!.createdAt) >= Date.parse(la[1]!.createdAt)).toBe(true);
    expect(la.every((x) => !x.scenario.includes("only b"))).toBe(true);

    const lb = listTwinPredictionVerificationsForUser(db, USER_B);
    expect(lb).toHaveLength(1);
    expect(lb[0]?.scenario).toBe("only b secret");
  });

  it("clampVerificationListLimit enforces sane bounds", () => {
    expect(clampVerificationListLimit(undefined)).toBe(50);
    expect(clampVerificationListLimit(3)).toBe(3);
    expect(clampVerificationListLimit(999)).toBe(100);
  });
});
