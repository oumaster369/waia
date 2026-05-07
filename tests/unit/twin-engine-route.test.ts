import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/dashboard/twin/engine/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { drizzle } from "drizzle-orm/postgres-js";
import { twinPredictionVerifications } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import * as waiaRuntimeDb from "@/db/waia-runtime-db";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import * as sessionUser from "@/lib/auth/session-user";
import {
  MAX_SCENARIO_CHARS,
  TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION,
} from "@/lib/dashboard/twin-contradiction-detector-api.types";
import {
  TWIN_ENGINE_SCHEMA_VERSION,
  type TwinEngineApiResponse,
} from "@/lib/dashboard/twin-engine-api.types";
import { TWIN_PATTERN_SUMMARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-pattern-summary-api.types";
import { TWIN_PERSONALITY_MODEL_SCHEMA_VERSION } from "@/lib/dashboard/twin-personality-model-api.types";
import { TWIN_REPEATABILITY_SCHEMA_VERSION } from "@/lib/dashboard/twin-repeatability-api.types";
import * as twinEngineRuntime from "@/lib/reasoning/twin-engine-runtime";
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

const minimalTwinEngineResponse = (): TwinEngineApiResponse => ({
  schemaVersion: TWIN_ENGINE_SCHEMA_VERSION,
  patternSummary: {
    schemaVersion: TWIN_PATTERN_SUMMARY_SCHEMA_VERSION,
    repeatedBehaviors: [],
    emotionalPatterns: [],
    decisionTendencies: [],
    contradictions: [],
    dominantThemes: [],
    memoryItemsConsidered: 0,
    seedQueryCount: 0,
  },
  contradictions: {
    schemaVersion: TWIN_CONTRADICTION_DETECTOR_SCHEMA_VERSION,
    contradictions: [],
    memoryItemsConsidered: 0,
    verificationItemsConsidered: 0,
    seedQueryCount: 0,
    scenarioUsed: false,
  },
  personalityModel: {
    schemaVersion: TWIN_PERSONALITY_MODEL_SCHEMA_VERSION,
    model: {
      dominantTraits: [],
      behavioralPatterns: [],
      emotionalBaseline: [],
      decisionStyle: [],
      relationshipStyle: [],
      contradictionProfile: [],
      growthEdges: [],
      confidence: 0,
    },
    sourceSignals: {
      memoryItemsConsidered: 0,
      patternSummaryUsed: false,
      contradictionItemsConsidered: 0,
      verificationItemsConsidered: 0,
    },
  },
  repeatability: {
    schemaVersion: TWIN_REPEATABILITY_SCHEMA_VERSION,
    repeatedPatterns: [],
  },
  prediction: null,
  engineMeta: {
    scenarioUsed: false,
    predictionRequested: false,
    modulesRun: [],
    generatedAt: null,
  },
});

describe("POST /api/dashboard/twin/engine (DEE-36)", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;
  let prevBackend: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    prevBackend = process.env.WAIA_DB_BACKEND;
    delete process.env.WAIA_DB_BACKEND;
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
    if (prevBackend === undefined) {
      delete process.env.WAIA_DB_BACKEND;
    } else {
      process.env.WAIA_DB_BACKEND = prevBackend;
    }
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
    vi.restoreAllMocks();
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
    const spy = vi.spyOn(twinEngineRuntime, "runTwinEngineForRuntimeAsync").mockRejectedValue(
      new Error("SECRET_INTERNAL_DETAIL"),
    );
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

  it("dispatches through runTwinEngineForRuntimeAsync with sqlite runtime handle by default", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const spy = vi.spyOn(twinEngineRuntime, "runTwinEngineForRuntimeAsync");
    try {
      const res = await POST(reqPost({ scenario: "hello", includePrediction: false }));
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledOnce();
      const [handle, input] = spy.mock.calls[0] as [WaiaRuntimeDb, object];
      expect(handle).toMatchObject({ kind: "sqlite" });
      expect(input).toMatchObject({
        userId: ROUTE_USER,
        scenario: "hello",
        includePrediction: false,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("passes postgres runtime handle to the facade when mocked (no live DB)", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const mockPg = drizzle.mock({ schema: pgSchema });
    const pgHandle: WaiaRuntimeDb = { kind: "postgres", db: mockPg };
    const runtimeSpy = vi.spyOn(waiaRuntimeDb, "getWaiaRuntimeDb").mockResolvedValue(pgHandle);
    const stub = minimalTwinEngineResponse();
    const facadeSpy = vi
      .spyOn(twinEngineRuntime, "runTwinEngineForRuntimeAsync")
      .mockResolvedValue(stub);
    try {
      const res = await POST(reqPost({}));
      expect(res.status).toBe(200);
      expect(runtimeSpy).toHaveBeenCalledOnce();
      expect(facadeSpy).toHaveBeenCalledOnce();
      expect(facadeSpy.mock.calls[0][0]).toBe(pgHandle);
      await expect(res.json()).resolves.toEqual(stub);
    } finally {
      runtimeSpy.mockRestore();
      facadeSpy.mockRestore();
    }
  });
});
