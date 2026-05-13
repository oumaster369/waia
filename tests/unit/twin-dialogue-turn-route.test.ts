import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/dashboard/twin-dialogue/turn/route";
import type { TwinDialogueTurnSubmitApiResponse } from "@/lib/dashboard/twin-dialogue-turn-api.types";
import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { twinDialogueTurns, twinProfiles, twinReadinessState } from "@/db/schema";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { DEFAULT_READINESS_INPUT } from "@/lib/dashboard/readiness-snapshot-default";
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
    delete process.env.WAIA_AI_GATEWAY_FOUNDATION;
    delete process.env.WAIA_AI_PROVIDER;
    delete process.env.WAIA_AI_OPENAI_API_KEY;
    delete process.env.WAIA_AI_OPENAI_BASE_URL;
    delete process.env.WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS;
    delete process.env.WAIA_READINESS_WRITER;
    vi.mocked(sessionUser.getOptionalSessionUserId).mockReset();
    const db = getDb();
    db.delete(twinDialogueTurns).run();
    const profile = db
      .select({ id: twinProfiles.id })
      .from(twinProfiles)
      .where(eq(twinProfiles.userId, ROUTE_USER_ID))
      .get();
    if (profile) {
      db.update(twinReadinessState)
        .set({
          indicatorsJson: JSON.stringify(DEFAULT_READINESS_INPUT.indicators),
          socializationCompleted: DEFAULT_READINESS_INPUT.socializationCompleted,
          finalStateMessageShown: DEFAULT_READINESS_INPUT.finalStateMessageShown,
        })
        .where(eq(twinReadinessState.twinProfileId, profile.id))
        .run();
    }
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

  it("emits ai_gateway_foundation off when foundation env unset", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const res = await POST(postJson({ message: "telemetry path off" }));
      expect(res.status).toBe(200);
      const payloads = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const routePayload = payloads.find(
        (p: { event?: string }) => p.event === "waia_runtime_route",
      );
      expect(routePayload?.ai_gateway_foundation).toBe("off");
      expect(routePayload?.ai_gateway_provider).toBeUndefined();
      expect(routePayload?.ai_gateway_provider_outcome).toBeUndefined();
      expect(routePayload?.ai_gateway_provider_phase_ms).toBeUndefined();
      expect(routePayload?.ai_gateway_provider_prompt_tokens).toBeUndefined();
      expect(routePayload?.ai_gateway_provider_completion_tokens).toBeUndefined();
      expect(routePayload?.ai_gateway_provider_total_tokens).toBeUndefined();
      expect(routePayload?.ai_gateway_provider_request_id).toBeUndefined();
      expect(routePayload?.readiness_writer_invoked).toBe(false);
      expect(routePayload?.readiness_writer_outcome).toBe("disabled");
    } finally {
      spy.mockRestore();
    }
  });

  const SUBSTANTIVE_SELF_REF_MESSAGE =
    "I think this describes my stance well enough for the twin readiness demo.";

  it("with WAIA_READINESS_WRITER bumps lowest indicator on substantive self-ref turn", async () => {
    process.env.WAIA_READINESS_WRITER = "1";
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const res = await POST(postJson({ message: SUBSTANTIVE_SELF_REF_MESSAGE }));
      expect(res.status).toBe(200);
      const payload = await loadDashboardReadinessPayloadFromDb(getDb(), ROUTE_USER_ID);
      expect(payload.readinessInput.indicators[0]).toBe(33);
      expect(payload.readinessInput.indicators.slice(1)).toEqual([0, 0, 0, 0, 0]);

      const payloads = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const routePayload = payloads.find(
        (p: { event?: string }) => p.event === "waia_runtime_route",
      );
      expect(routePayload?.readiness_writer_invoked).toBe(true);
      expect(routePayload?.readiness_writer_outcome).toBe("applied");
    } finally {
      spy.mockRestore();
      delete process.env.WAIA_READINESS_WRITER;
    }
  });

  it("skips replayed idempotent Twin turns without double-bump telemetry", async () => {
    process.env.WAIA_READINESS_WRITER = "1";
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const key = "readiness-demo-idem";
    try {
      const first = await POST(
        postJson({ message: SUBSTANTIVE_SELF_REF_MESSAGE, idempotencyKey: key }),
      );
      expect(first.status).toBe(200);

      const second = await POST(
        postJson({
          message: "Ignore this different substantive text without replay bump.",
          idempotencyKey: key,
        }),
      );
      expect(second.status).toBe(200);

      const snapshot = await loadDashboardReadinessPayloadFromDb(getDb(), ROUTE_USER_ID);
      expect(snapshot.readinessInput.indicators[0]).toBe(33);

      const routePayloads = spy.mock.calls
        .map((c) => JSON.parse(String(c[0])))
        .filter((p: { event?: string }) => p.event === "waia_runtime_route");
      expect(routePayloads[0]?.readiness_writer_outcome).toBe("applied");
      expect(routePayloads[1]?.readiness_writer_invoked).toBe(false);
      expect(routePayloads[1]?.readiness_writer_outcome).toBe("replay_skipped");
    } finally {
      spy.mockRestore();
      delete process.env.WAIA_READINESS_WRITER;
    }
  });

  it("with writer enabled reports skipped when dialogue message is not writer-eligible", async () => {
    process.env.WAIA_READINESS_WRITER = "1";
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const longSansSelf =
      "This is deliberately written as a neutral note without qualifying pronouns.";
    try {
      const res = await POST(postJson({ message: longSansSelf }));
      expect(res.status).toBe(200);
      const payload = await loadDashboardReadinessPayloadFromDb(getDb(), ROUTE_USER_ID);
      expect(payload.readinessInput.indicators).toEqual([0, 0, 0, 0, 0, 0]);

      const payloads = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const routePayload = payloads.find(
        (p: { event?: string }) => p.event === "waia_runtime_route",
      );
      expect(routePayload?.readiness_writer_invoked).toBe(true);
      expect(routePayload?.readiness_writer_outcome).toBe("skipped");
    } finally {
      spy.mockRestore();
      delete process.env.WAIA_READINESS_WRITER;
    }
  });

  it("emits ai_gateway_foundation fake_stub when WAIA_AI_GATEWAY_FOUNDATION=1", async () => {
    process.env.WAIA_AI_GATEWAY_FOUNDATION = "1";
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const res = await POST(postJson({ message: "telemetry path fake" }));
      expect(res.status).toBe(200);
      const payloads = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const routePayload = payloads.find(
        (p: { event?: string }) => p.event === "waia_runtime_route",
      );
      expect(routePayload?.ai_gateway_foundation).toBe("fake_stub");
      expect(routePayload?.ai_gateway_provider).toBe("fake");
      expect(routePayload?.ai_gateway_provider_outcome).toBe("ok");
      expect(routePayload?.ai_gateway_provider_phase_ms).toBeGreaterThanOrEqual(0);
      expect(routePayload?.ai_gateway_provider_prompt_tokens).toBe(0);
      expect(routePayload?.ai_gateway_provider_completion_tokens).toBe(0);
      expect(routePayload?.ai_gateway_provider_total_tokens).toBe(0);
      expect(routePayload?.ai_gateway_provider_request_id).toBeUndefined();
    } finally {
      spy.mockRestore();
      delete process.env.WAIA_AI_GATEWAY_FOUNDATION;
    }
  });

  it("emits openai-compatible CONFIG degraded telemetry when key missing", async () => {
    process.env.WAIA_AI_GATEWAY_FOUNDATION = "1";
    process.env.WAIA_AI_PROVIDER = "openai-compatible";
    delete process.env.WAIA_AI_OPENAI_API_KEY;

    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const res = await POST(postJson({ message: "telemetry path openai config" }));
      expect(res.status).toBe(200);
      const payloads = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const routePayload = payloads.find(
        (p: { event?: string }) => p.event === "waia_runtime_route",
      );
      expect(routePayload?.ai_gateway_foundation).toBe("fake_stub");
      expect(routePayload?.ai_gateway_provider).toBe("openai-compatible");
      expect(routePayload?.ai_gateway_provider_outcome).toBe("config");
      expect(routePayload?.ai_gateway_degraded).toBe(true);
      expect(routePayload?.ai_gateway_provider_prompt_tokens).toBeUndefined();
      expect(routePayload?.ai_gateway_provider_completion_tokens).toBeUndefined();
      expect(routePayload?.ai_gateway_provider_total_tokens).toBeUndefined();
      expect(routePayload?.ai_gateway_provider_request_id).toBeUndefined();
    } finally {
      spy.mockRestore();
      delete process.env.WAIA_AI_GATEWAY_FOUNDATION;
      delete process.env.WAIA_AI_PROVIDER;
    }
  });

  it("emits provider token + request id telemetry when openai-compatible succeeds", async () => {
    process.env.WAIA_AI_GATEWAY_FOUNDATION = "1";
    process.env.WAIA_AI_PROVIDER = "openai-compatible";
    process.env.WAIA_AI_OPENAI_API_KEY = "test-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-route",
          choices: [{ message: { role: "assistant", content: " Route reply " } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status: 200 },
      ),
    );

    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const res = await POST(postJson({ message: "openai telemetry smoke" }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as TwinDialogueTurnSubmitApiResponse;
      expect(body.assistantTurn?.content).toBe("Route reply");

      const payloads = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
      const routePayload = payloads.find(
        (p: { event?: string }) => p.event === "waia_runtime_route",
      );
      expect(routePayload?.ai_gateway_foundation).toBe("live");
      expect(routePayload?.ai_gateway_provider).toBe("openai-compatible");
      expect(routePayload?.ai_gateway_provider_outcome).toBe("ok");
      expect(routePayload?.ai_gateway_provider_prompt_tokens).toBe(10);
      expect(routePayload?.ai_gateway_provider_completion_tokens).toBe(20);
      expect(routePayload?.ai_gateway_provider_total_tokens).toBe(30);
      expect(routePayload?.ai_gateway_provider_request_id).toBe("chatcmpl-route");
    } finally {
      spy.mockRestore();
      fetchSpy.mockRestore();
      delete process.env.WAIA_AI_GATEWAY_FOUNDATION;
      delete process.env.WAIA_AI_PROVIDER;
      delete process.env.WAIA_AI_OPENAI_API_KEY;
    }
  });
});