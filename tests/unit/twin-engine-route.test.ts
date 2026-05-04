import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/dashboard/twin/engine/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { twinPredictionVerifications } from "@/db/schema";
import { MAX_SCENARIO_CHARS } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import { TWIN_ENGINE_SCHEMA_VERSION } from "@/lib/dashboard/twin-engine-api.types";
import * as sessionUser from "@/lib/auth/session-user";
import * as twinEngine from "@/lib/reasoning/twin-engine";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const ROUTE_USER = "twin-engine-route-user";

function reqPost(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/twin/engine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dashboard/twin/engine (DEE-36)", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-engine-route-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    insertEmailPasswordUser(getDb(), {
      id: ROUTE_USER,
      email: "engine-route@example.com",
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
    getDb().delete(twinPredictionVerifications).run();
  });

  it("returns 401 without session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await POST(reqPost({}));
    expect(res.status).toBe(401);
  });

  it("accepts empty body and returns stable engine schema", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const res = await POST(reqPost({}));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const body = (await res.json()) as { schemaVersion: string; engineMeta: { generatedAt: null } };
    expect(body.schemaVersion).toBe(TWIN_ENGINE_SCHEMA_VERSION);
    expect(body.engineMeta.generatedAt).toBeNull();
  });

  it("accepts scenario and includePrediction", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const res = await POST(
      reqPost({ scenario: "weekly planning review", includePrediction: true }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prediction: unknown; engineMeta: { scenarioUsed: boolean } };
    expect(body.engineMeta.scenarioUsed).toBe(true);
    expect(body.prediction).not.toBeNull();
  });

  it("rejects scenario over max length", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const res = await POST(reqPost({ scenario: "x".repeat(MAX_SCENARIO_CHARS + 1) }));
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: { code: string } };
    expect(j.error.code).toBe("SCENARIO_TOO_LONG");
  });

  it("returns 500 INTERNAL_ERROR without echoing internal exception text", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const spy = vi.spyOn(twinEngine, "runTwinEngine").mockImplementation(() => {
      throw new Error("SECRET_INTERNAL_DETAIL");
    });
    try {
      const res = await POST(reqPost({}));
      expect(res.status).toBe(500);
      const raw = await res.text();
      expect(raw).not.toContain("SECRET_INTERNAL");
      const j = JSON.parse(raw) as { error: { code: string } };
      expect(j.error.code).toBe("INTERNAL_ERROR");
    } finally {
      spy.mockRestore();
    }
  });
});
