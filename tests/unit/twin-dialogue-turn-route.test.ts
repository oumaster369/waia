import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/dashboard/twin-dialogue/turn/route";
import type { TwinDialogueTurnSubmitApiResponse } from "@/lib/dashboard/twin-dialogue-turn-api.types";
import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { twinDialogueTurns } from "@/db/schema";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import * as sessionUser from "@/lib/auth/session-user";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { loadDashboardReadinessPayloadFromDb } from "@/lib/twin-persistence/loader";
import { eq, sql } from "drizzle-orm";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const ROUTE_USER_ID = "twin-submit-route-test-user";

function postJson(body: unknown) {
  return new Request("http://localhost/api/dashboard/twin-dialogue/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dashboard/twin-dialogue/turn", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-submit-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: ROUTE_USER_ID,
      email: "twin-submit@example.com",
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
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER_ID);
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await POST(postJson({ message: "hello" }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 INVALID_BODY when JSON is not an object", async () => {
    const req = new Request("http://localhost/api/dashboard/twin-dialogue/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([1, 2, 3]),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_BODY when JSON is malformed", async () => {
    const req = new Request("http://localhost/api/dashboard/twin-dialogue/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_BODY when message is not a string", async () => {
    const res = await POST(postJson({ message: 42 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("INVALID_BODY");
  });

  it("returns 400 EMPTY_MESSAGE for whitespace-only message", async () => {
    const res = await POST(postJson({ message: "   \n\t " }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("EMPTY_MESSAGE");
  });

  it("returns 400 MESSAGE_TOO_LONG when message exceeds limit", async () => {
    const res = await POST(postJson({ message: "x".repeat(16385) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("MESSAGE_TOO_LONG");
  });

  it("returns 400 when idempotencyKey is wrong type", async () => {
    const res = await POST(postJson({ message: "ok", idempotencyKey: 1 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("INVALID_BODY");
  });

  it("persists user and assistant stub turns, returns twinSignals, assistantTurn, and assistantPlaceholder", async () => {
    const res = await POST(postJson({ message: " Hello twin " }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as TwinDialogueTurnSubmitApiResponse;
    expect(body.userTurn.role).toBe("user");
    expect(body.userTurn.content).toBe("Hello twin");
    expect(typeof body.userTurn.id).toBe("string");
    expect(body.userTurn.sequence).toBe(1);
    expect(typeof body.userTurn.createdAt).toBe("string");
    expect(body.twinSignals.hasMeaningfulExchange).toBe(true);
    expect(body.assistantPlaceholder).toBe(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE);
    expect(body.assistantTurn).not.toBeNull();
    expect(body.assistantTurn!.role).toBe("assistant");
    expect(body.assistantTurn!.content).toBe(TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE);
    expect(body.assistantTurn!.sequence).toBe(2);
    expect(body.assistantTurn!.id).toBeTruthy();

    const payload = await loadDashboardReadinessPayloadFromDb(getDb(), ROUTE_USER_ID);
    expect(payload.twinSignals.hasMeaningfulExchange).toBe(true);

    const [userCount] = getDb()
      .select({ c: sql<number>`count(*)`.mapWith(Number) })
      .from(twinDialogueTurns)
      .where(eq(twinDialogueTurns.role, "user"))
      .all();
    expect(userCount?.c).toBe(1);

    const [assistantCount] = getDb()
      .select({ c: sql<number>`count(*)`.mapWith(Number) })
      .from(twinDialogueTurns)
      .where(eq(twinDialogueTurns.role, "assistant"))
      .all();
    expect(assistantCount?.c).toBe(1);
  });

  it("does not duplicate when idempotencyKey repeats", async () => {
    const first = await POST(postJson({ message: "first", idempotencyKey: "key-a" }));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as TwinDialogueTurnSubmitApiResponse;

    const second = await POST(postJson({ message: "different", idempotencyKey: "key-a" }));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as TwinDialogueTurnSubmitApiResponse;

    expect(secondBody.userTurn.content).toBe("first");
    expect(secondBody.userTurn.id).toBe(firstBody.userTurn.id);
    expect(secondBody.userTurn.sequence).toBe(firstBody.userTurn.sequence);
    expect(secondBody.assistantTurn).toBeNull();

    const [userCount] = getDb()
      .select({ c: sql<number>`count(*)`.mapWith(Number) })
      .from(twinDialogueTurns)
      .where(eq(twinDialogueTurns.role, "user"))
      .all();
    expect(userCount?.c).toBe(1);

    const [assistantCount] = getDb()
      .select({ c: sql<number>`count(*)`.mapWith(Number) })
      .from(twinDialogueTurns)
      .where(eq(twinDialogueTurns.role, "assistant"))
      .all();
    expect(assistantCount?.c).toBe(1);

    const [total] = getDb()
      .select({ c: sql<number>`count(*)`.mapWith(Number) })
      .from(twinDialogueTurns)
      .all();
    expect(total?.c).toBe(2);
  });
});