import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/dashboard/twin/prediction/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { diaryEntries, twinDialogueTurns } from "@/db/schema";
import * as sessionUser from "@/lib/auth/session-user";
import { appendDiaryEntryForUser } from "@/lib/twin-persistence/diary-memory";
import { ensureUserTwinSeed, persistUserTwinExchangeWithAssistantStub } from "@/lib/twin-persistence/loader";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const USER_A = "twin-pred-route-user-a";
const USER_B = "twin-pred-route-user-b";

function req(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/twin/prediction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dashboard/twin/prediction", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-twin-pred-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, { id: USER_A, email: "tp-a@example.com", password: "password123" });
    insertEmailPasswordUser(db, { id: USER_B, email: "tp-b@example.com", password: "password123" });
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
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await POST(req({ scenario: "ship product next week deadline" }));
    expect(res.status).toBe(401);
    const j401 = (await res.json()) as { error: { code: string } };
    expect(j401.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 for invalid JSON", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const raw = await POST(
      new Request("http://localhost/api/dashboard/twin/prediction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json{",
      }),
    );
    expect(raw.status).toBe(400);
  });

  it("returns 400 when scenario missing or empty", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);

    let res = await POST(req({}));
    expect(res.status).toBe(400);

    res = await POST(req({ scenario: "   \n\t  " }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("EMPTY_SCENARIO");

    res = await POST(req([]));
    expect(res.status).toBe(400);
  });

  it("returns projection with bounded confidence when user has seeded memory", async () => {
    const db = getDb();
    const twinProfileId = ensureUserTwinSeed(db, USER_A);
    persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId,
      userContent: "Worried about the deadline sprint next week calmly",
      userIdempotencyKey: null,
      assistantContent: "Let us prioritize scope calmly",
    });
    await appendDiaryEntryForUser(db, {
      userId: USER_A,
      body: "relationships friendships planning tradeoffs calmly",
      idempotencyKey: null,
    });

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);

    const res = await POST(
      req({ scenario: "If I push harder on the sprint deadline, what strains appear?" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as {
      outcome: string;
      reasoning: string[];
      confidence: number;
    };

    expect(typeof body.outcome).toBe("string");
    expect(body.outcome.length).toBeGreaterThan(10);
    expect(body.reasoning.length).toBeGreaterThanOrEqual(1);
    expect(body.confidence).toBeGreaterThanOrEqual(0);
    expect(body.confidence).toBeLessThanOrEqual(1);

    expect(body.reasoning.some((line) => line.startsWith("Retrieval:"))).toBe(true);
  });

  it("does not expose another user diary tokens in projections", async () => {
    const db = getDb();
    await appendDiaryEntryForUser(db, {
      userId: USER_A,
      body: "onlyaunique999 planning calmly deadline stress calmly goals",
      idempotencyKey: null,
    });
    await appendDiaryEntryForUser(db, {
      userId: USER_B,
      body: "onlybunique888 calmly weekend hobby tradeoffs calmly",
      idempotencyKey: null,
    });

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_B);

    const res = await POST(
      req({
        scenario: "How does my hobby weekend affect planning tradeoffs calmly?",
      }),
    );

    expect(res.status).toBe(200);

    const raw = JSON.stringify(await res.json()).toLowerCase();
    expect(raw).toContain("onlybunique888");
    expect(raw).not.toContain("onlyaunique999");

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
    const resA = await POST(
      req({ scenario: "Describe planning tradeoffs calmly for my roadmap deadline." }),
    );
    const rawA = JSON.stringify(await resA.json()).toLowerCase();
    expect(rawA).toContain("onlyaunique999");
    expect(rawA).not.toContain("onlybunique888");
  });
});
