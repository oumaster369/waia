import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/dashboard/twin/contradictions/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import {
  diaryEntries,
  scenarioAnswers,
  twinDialogueTurns,
  twinPredictionVerifications,
} from "@/db/schema";
import {
  MAX_SCENARIO_CHARS,
  TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION,
} from "@/lib/dashboard/twin-contradiction-detector-api.types";
import * as sessionUser from "@/lib/auth/session-user";
import { appendDiaryEntryForUser } from "@/lib/twin-persistence/diary-memory";
import {
  appendTwinPredictionVerificationForUser,
} from "@/lib/twin-persistence/twin-prediction-verifications";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const USER_A = "cdetect-route-user-a";
const USER_B = "cdetect-route-user-b";

function req(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/twin/contradictions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dashboard/twin/contradictions (DEE-30)", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-contrad-route-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, { id: USER_A, email: "cda@example.com", password: "password123" });
    insertEmailPasswordUser(db, { id: USER_B, email: "cdb@example.com", password: "password123" });
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
    vi.mocked(sessionUser.getOptionalSessionUserId).mockReset();
    const db = getDb();
    db.delete(twinPredictionVerifications).run();
    db.delete(twinDialogueTurns).run();
    db.delete(diaryEntries).run();
    db.delete(scenarioAnswers).run();
  });

  it("returns 401 without session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    const j = (await res.json()) as { error: { code: string } };
    expect(j.error.code).toBe("UNAUTHORIZED");
  });

  it("accepts empty JSON body", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schemaVersion: string; scenarioUsed: boolean };
    expect(body.schemaVersion).toBe(TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION);
    expect(body.scenarioUsed).toBe(false);
  });

  it("accepts null scenario", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const res = await POST(req({ scenario: null }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scenarioUsed: boolean };
    expect(body.scenarioUsed).toBe(false);
  });

  it("accepts empty string scenario", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const res = await POST(req({ scenario: " \t\n " }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { scenarioUsed: boolean }).scenarioUsed).toBe(false);
  });

  it("rejects scenario over max length after trim content", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const res = await POST(req({ scenario: "z".repeat(MAX_SCENARIO_CHARS + 1) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SCENARIO_TOO_LONG",
    );
  });

  it("returns schemaVersion and private no-store cache control", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const body = (await res.json()) as { schemaVersion: string };
    expect(body.schemaVersion).toBe(TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION);
  });

  it("rejects scenario when wrong JSON type", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const res = await POST(req({ scenario: 42 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_BODY",
    );
  });

  it("does not leak other users diary tokens", async () => {
    appendDiaryEntryForUser(getDb(), {
      userId: USER_A,
      body: "alphauniqueYYY streak calmly planning values goals calmly",
      idempotencyKey: null,
    });
    appendDiaryEntryForUser(getDb(), {
      userId: USER_B,
      body: "betauniqueZZZ lone calmly values goals calmly",
      idempotencyKey: null,
    });
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_B);
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    const raw = JSON.stringify(await res.json());
    expect(raw.includes("alphauniqueYYY")).toBe(false);
    expect(raw.includes("betauniqueZZZ")).toBe(false);
  });

  it("returns repeated_failure_patterns when seeded verifications exist", async () => {
    appendTwinPredictionVerificationForUser(getDb(), USER_A, {
      scenario: "route contradiction one",
      verification: "inaccurate",
      correction: "adjust",
    });
    appendTwinPredictionVerificationForUser(getDb(), USER_A, {
      scenario: "route contradiction two mismatch",
      verification: "inaccurate",
      correction: "",
    });
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contradictions: { type: string }[] };
    expect(
      body.contradictions.some((c) => c.type === "repeated_failure_patterns"),
    ).toBe(true);
  });
});
