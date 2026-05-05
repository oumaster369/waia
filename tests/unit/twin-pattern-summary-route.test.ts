import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/dashboard/twin/pattern-summary/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { diaryEntries, scenarioAnswers, twinDialogueTurns } from "@/db/schema";
import { TWIN_PATTERN_SUMMARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-pattern-summary-api.types";
import { PATTERN_SUMMARY_SEED_QUERIES } from "@/lib/reasoning/twin-pattern-summary";
import * as sessionUser from "@/lib/auth/session-user";
import { appendDiaryEntryForUser } from "@/lib/twin-persistence/diary-memory";
import { ensureUserTwinSeed, persistUserTwinExchangeWithAssistantStub } from "@/lib/twin-persistence/loader";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const USER_A = "pattern-sum-route-user-a";
const USER_B = "pattern-sum-route-user-b";
const USER_EMPTY = "pattern-sum-route-empty";

describe("GET /api/dashboard/twin/pattern-summary", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-pattern-sum-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, { id: USER_A, email: "ps-a@example.com", password: "password123" });
    insertEmailPasswordUser(db, { id: USER_B, email: "ps-b@example.com", password: "password123" });
    insertEmailPasswordUser(db, { id: USER_EMPTY, email: "ps-empty@example.com", password: "password123" });
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
    db.delete(twinDialogueTurns).run();
    db.delete(diaryEntries).run();
    db.delete(scenarioAnswers).run();
  });

  it("returns 401 without session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns stable empty-ish summary when user has no memory rows", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_EMPTY);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schemaVersion).toBe(TWIN_PATTERN_SUMMARY_SCHEMA_VERSION);
    expect(body.memoryItemsConsidered).toBe(0);
    expect(body.seedQueryCount).toBe(PATTERN_SUMMARY_SEED_QUERIES.length);
    for (const k of ["repeatedBehaviors", "emotionalPatterns", "decisionTendencies", "contradictions", "dominantThemes"]) {
      expect(Array.isArray(body[k])).toBe(true);
      expect((body[k] as unknown[]).length).toBe(0);
    }
  });

  it("returns 200 with non-empty summaries when seeded memory exists", async () => {
    const db = getDb();
    const twinProfileId = ensureUserTwinSeed(db, USER_A);
    await persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId,
      userContent: "I worry about timelines and deadlines at work frequently",
      userIdempotencyKey: null,
      assistantContent: "Let us prioritize scope next week calmly",
    });
    await appendDiaryEntryForUser(db, {
      userId: USER_A,
      body: "Prefer planning over rushing decisions calmly then anxious mornings",
      idempotencyKey: null,
    });
    await appendDiaryEntryForUser(db, {
      userId: USER_A,
      body: "Relationships matter more than short stress bursts",
      idempotencyKey: null,
    });

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const res = await GET();

    expect(res.status).toBe(200);
    const bodyRaw = JSON.stringify(await res.json());
    expect(bodyRaw.length).toBeGreaterThan(50);
    const body = JSON.parse(bodyRaw) as {
      dominantThemes: string[];
      repeatedBehaviors: string[];
      emotionalPatterns: string[];
      memoryItemsConsidered: number;
    };
    expect(body.memoryItemsConsidered).toBeGreaterThanOrEqual(1);
    const joined = [...body.dominantThemes, ...body.repeatedBehaviors, ...body.emotionalPatterns].join(" ");
    expect(joined.length).toBeGreaterThan(0);
  });

  it("does not leak other users memory tokens across sessions", async () => {
    const db = getDb();
    await appendDiaryEntryForUser(db, {
      userId: USER_A,
      body:
        "alphauniqueAAA streak alphauniqueAAA values goals friendships stress calmly happy moment",
      idempotencyKey: null,
    });
    await appendDiaryEntryForUser(db, {
      userId: USER_B,
      body: "betauniqueBBB lone betauniqueBBB values goals calmly",
      idempotencyKey: null,
    });

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const rawA = JSON.stringify(await (await GET()).json()).toLowerCase();
    expect(rawA).toContain("alphauniqueaaa");
    expect(rawA).not.toContain("betauniquebbb");

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_B);
    const rawB = JSON.stringify(await (await GET()).json()).toLowerCase();
    expect(rawB).toContain("betauniquebbb");
    expect(rawB).not.toContain("alphauniqueaaa");
  });
});
