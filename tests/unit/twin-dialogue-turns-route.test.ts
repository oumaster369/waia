import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/dashboard/twin-dialogue/turns/route";
import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";
import type { TwinDialogueTurnsMemoryApiResponse } from "@/lib/dashboard/twin-dialogue-memory-api.types";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import * as sessionUser from "@/lib/auth/session-user";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { twinDialogueTurns } from "@/db/schema";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { ensureUserTwinSeed, persistUserTwinExchangeWithAssistantStub } from "@/lib/twin-persistence/loader";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const ROUTE_USER_A = "twin-turns-route-user-a";
const ROUTE_USER_B = "twin-turns-route-user-b";

describe("GET /api/dashboard/twin-dialogue/turns", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-turns-get-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: ROUTE_USER_A,
      email: "twin-turns-a@example.com",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: ROUTE_USER_B,
      email: "twin-turns-b@example.com",
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
    vi.mocked(sessionUser.getOptionalSessionUserId).mockReset();
    const db = getDb();
    db.delete(twinDialogueTurns).run();
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiErrorEnvelope;
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 with ISO turns, chronological order, and private no-store cache", async () => {
    const db = getDb();
    const twinA = ensureUserTwinSeed(db, ROUTE_USER_A);
    persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId: twinA,
      userContent: "hello memory",
      userIdempotencyKey: "idem-a",
      assistantContent: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
    });

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER_A);
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as TwinDialogueTurnsMemoryApiResponse;
    expect(body.turns).toHaveLength(2);
    expect(body.turns[0]?.role).toBe("user");
    expect(body.turns[0]?.content).toBe("hello memory");
    expect(body.turns[1]?.role).toBe("assistant");
    expect(body.turns[1]?.content).toBe(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE);
    expect(Number.isFinite(Number(body.turns[0]?.sequence))).toBe(true);
    expect(body.turns[0]!.sequence).toBeLessThan(body.turns[1]!.sequence);
    expect(body.turns.every((t) => typeof t.id === "string" && t.id.length > 0)).toBe(true);
    expect(body.turns.every((t) => typeof t.createdAt === "string" && /\d{4}-\d{2}-\d{2}T/.test(t.createdAt)))
      .toBe(true);
  });

  it("does not expose user A dialogue rows to user B session", async () => {
    const db = getDb();
    const twinA = ensureUserTwinSeed(db, ROUTE_USER_A);
    persistUserTwinExchangeWithAssistantStub(db, {
      twinProfileId: twinA,
      userContent: "private to A",
      userIdempotencyKey: "idem-b-isolation",
      assistantContent: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
    });

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER_B);
    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as TwinDialogueTurnsMemoryApiResponse;
    expect(body.turns).toHaveLength(0);
  });
});
