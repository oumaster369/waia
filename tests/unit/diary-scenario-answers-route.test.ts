import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/dashboard/diary/scenario-answers/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { scenarioAnswers } from "@/db/schema";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import * as sessionUser from "@/lib/auth/session-user";
import type {
  ScenarioAnswerAppendApiResponse,
  ScenarioAnswersListApiResponse,
} from "@/lib/dashboard/scenario-memory-api.types";
import {
  MAX_SCENARIO_KEY_CHARS,
  MAX_SCENARIO_PAYLOAD_JSON_CHARS,
} from "@/lib/twin-persistence/diary-memory";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { sql } from "drizzle-orm";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const USER_A = "scenario-route-user-a";
const USER_B = "scenario-route-user-b";

function postJson(body: unknown) {
  return new Request("http://localhost/api/dashboard/diary/scenario-answers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/dashboard/diary/scenario-answers", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-scenario-"));
    const dbPath = path.join(tmpRoot, "scenario-route.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "scenario-a@example.com",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "scenario-b@example.com",
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
    getDb().delete(scenarioAnswers).run();
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_A);
  });

  it("GET and POST return 401 when there is no session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const getRes = await GET();
    expect(getRes.status).toBe(401);

    const postRes = await POST(postJson({ scenarioKey: "k", payload: {} }));
    expect(postRes.status).toBe(401);
    expect(((await postRes.json()) as ApiErrorEnvelope).error.code).toBe("UNAUTHORIZED");
  });

  it("POST persists payload and GET returns round-trip JSON", async () => {
    const post = await POST(
      postJson({ scenarioKey: "morning-reflect", payload: { mood: "calm", n: 1 } }),
    );
    expect(post.status).toBe(200);
    expect(post.headers.get("Cache-Control")).toContain("no-store");

    const postBody = (await post.json()) as ScenarioAnswerAppendApiResponse;
    expect(postBody.replayed).toBe(false);
    expect(postBody.answer.scenarioKey).toBe("morning-reflect");
    expect(postBody.answer.payload).toEqual({ mood: "calm", n: 1 });

    const getRes = await GET();
    expect(getRes.status).toBe(200);
    const list = (await getRes.json()) as ScenarioAnswersListApiResponse;
    expect(list.answers).toHaveLength(1);
    expect(list.answers[0]?.scenarioKey).toBe("morning-reflect");
    expect(list.answers[0]?.payload).toEqual({ mood: "calm", n: 1 });
  });

  it("does not duplicate when idempotencyKey repeats", async () => {
    const payload = { v: true };
    const first = await POST(
      postJson({ scenarioKey: "s", payload, idempotencyKey: "idem-scenario" }),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ScenarioAnswerAppendApiResponse;

    const second = await POST(
      postJson({ scenarioKey: "other", payload: { ignored: true }, idempotencyKey: "idem-scenario" }),
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as ScenarioAnswerAppendApiResponse;

    expect(secondBody.replayed).toBe(true);
    expect(secondBody.answer.id).toBe(firstBody.answer.id);
    expect(secondBody.answer.scenarioKey).toBe("s");
    expect(secondBody.answer.payload).toEqual(payload);

    const [c] = getDb()
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(scenarioAnswers)
      .all();
    expect(c?.n).toBe(1);
  });

  it("does not expose user A answers to user B session", async () => {
    await POST(postJson({ scenarioKey: "secret", payload: { x: 1 } }));

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_B);
    const getB = await GET();
    const listB = (await getB.json()) as ScenarioAnswersListApiResponse;
    expect(listB.answers).toHaveLength(0);
  });

  it("returns 400 EMPTY_SCENARIO_KEY for blank scenarioKey", async () => {
    const res = await POST(postJson({ scenarioKey: "  ", payload: {} }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("EMPTY_SCENARIO_KEY");
  });

  it("returns 400 SCENARIO_KEY_TOO_LONG when scenarioKey exceeds limit", async () => {
    const res = await POST(
      postJson({ scenarioKey: "x".repeat(MAX_SCENARIO_KEY_CHARS + 1), payload: {} }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("SCENARIO_KEY_TOO_LONG");
  });

  it("returns 400 when payload key is missing", async () => {
    const res = await POST(postJson({ scenarioKey: "k" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_PAYLOAD when payload serializes unsuccessfully after parse", async () => {
    const req = {
      json: vi.fn(() =>
        Promise.resolve({
          scenarioKey: "k",
          payload: { n: BigInt(42) },
        }),
      ),
    };
    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("INVALID_PAYLOAD");
  });

  it("returns 400 PAYLOAD_TOO_LARGE when serialized payload exceeds limit", async () => {
    const inner = "y".repeat(MAX_SCENARIO_PAYLOAD_JSON_CHARS);
    const res = await POST(postJson({ scenarioKey: "k", payload: { inner } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
