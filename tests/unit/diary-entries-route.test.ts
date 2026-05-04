import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/dashboard/diary/entries/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { diaryEntries } from "@/db/schema";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import * as sessionUser from "@/lib/auth/session-user";
import type { DiaryEntriesListApiResponse, DiaryEntryAppendApiResponse } from "@/lib/dashboard/diary-memory-api.types";
import { MAX_DIARY_BODY_CHARS } from "@/lib/twin-persistence/diary-memory";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { sql } from "drizzle-orm";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const USER_A = "diary-entries-route-user-a";
const USER_B = "diary-entries-route-user-b";

function postJson(body: unknown) {
  return new Request("http://localhost/api/dashboard/diary/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/dashboard/diary/entries", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-diary-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "diary-a@example.com",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "diary-b@example.com",
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
    getDb().delete(diaryEntries).run();
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
  });

  it("GET and POST return 401 when there is no session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const getRes = await GET();
    expect(getRes.status).toBe(401);
    expect(((await getRes.json()) as ApiErrorEnvelope).error.code).toBe("UNAUTHORIZED");

    const postRes = await POST(postJson({ body: "hello" }));
    expect(postRes.status).toBe(401);
    expect(((await postRes.json()) as ApiErrorEnvelope).error.code).toBe("UNAUTHORIZED");
  });

  it("POST persists and GET returns shape with no-store", async () => {
    const post = await POST(postJson({ body: "  Daily note  " }));
    expect(post.status).toBe(200);
    expect(post.headers.get("Cache-Control")).toContain("no-store");

    const postBody = (await post.json()) as DiaryEntryAppendApiResponse;
    expect(postBody.replayed).toBe(false);
    expect(postBody.entry.body).toBe("Daily note");
    expect(typeof postBody.entry.id).toBe("string");
    expect(typeof postBody.entry.createdAt).toBe("string");

    const getRes = await GET();
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("Cache-Control")).toContain("no-store");
    const list = (await getRes.json()) as DiaryEntriesListApiResponse;
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toEqual(postBody.entry);
  });

  it("does not duplicate when idempotencyKey repeats", async () => {
    const first = await POST(postJson({ body: "first", idempotencyKey: "idem-diary" }));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as DiaryEntryAppendApiResponse;

    const second = await POST(postJson({ body: "ignored", idempotencyKey: "idem-diary" }));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as DiaryEntryAppendApiResponse;

    expect(secondBody.replayed).toBe(true);
    expect(secondBody.entry.id).toBe(firstBody.entry.id);
    expect(secondBody.entry.body).toBe("first");

    const [c] = getDb()
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(diaryEntries)
      .all();
    expect(c?.n).toBe(1);
  });

  it("does not expose user A entries to user B session", async () => {
    await POST(postJson({ body: "secret A" }));

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_B);
    const getB = await GET();
    expect(getB.status).toBe(200);
    const listB = (await getB.json()) as DiaryEntriesListApiResponse;
    expect(listB.entries).toHaveLength(0);
  });

  it("returns 400 INVALID_BODY when body is not a string", async () => {
    const res = await POST(postJson({ body: 1 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("INVALID_BODY");
  });

  it("returns 400 EMPTY_MESSAGE for whitespace body", async () => {
    const res = await POST(postJson({ body: "  \n" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("EMPTY_MESSAGE");
  });

  it("returns 400 BODY_TOO_LONG when body exceeds limit", async () => {
    const res = await POST(postJson({ body: "x".repeat(MAX_DIARY_BODY_CHARS + 1) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("BODY_TOO_LONG");
  });
});
