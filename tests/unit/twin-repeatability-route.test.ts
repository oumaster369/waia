import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/dashboard/twin/repeatability/route";
import { POST as POST_VERIFY } from "@/app/api/dashboard/twin/prediction/verification/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import * as waiaRuntimeDb from "@/db/waia-runtime-db";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import * as pgSchema from "@/db/schema.postgres";
import { twinRepeatabilityRecords } from "@/db/schema";
import { TWIN_REPEATABILITY_SCHEMA_VERSION } from "@/lib/dashboard/twin-repeatability-api.types";
import * as runtimePersistence from "@/lib/persistence/runtime";
import { drizzle } from "drizzle-orm/postgres-js";
import * as sessionUser from "@/lib/auth/session-user";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const R_USER = "repar-route-user";

function reqGet(scenario?: string): Request {
  const q =
    scenario != null && scenario.length > 0
      ? `?scenario=${encodeURIComponent(scenario)}`
      : "";
  return new Request(`http://localhost/api/dashboard/twin/repeatability${q}`);
}

function reqPostVerify(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/twin/prediction/verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/dashboard/twin/repeatability (DEE-28)", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;
  let prevBackend: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    prevBackend = process.env.WAIA_DB_BACKEND;
    delete process.env.WAIA_DB_BACKEND;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-rep-route-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    insertEmailPasswordUser(getDb(), {
      id: R_USER,
      email: "repar@example.com",
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
    getDb().delete(twinRepeatabilityRecords).run();
  });

  it("returns 401 without session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await GET(reqGet());
    expect(res.status).toBe(401);
  });

  it("returns schemaVersion and repeatedPatterns for signed-in user", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(R_USER);
    await POST_VERIFY(reqPostVerify({ scenario: "deadline pressure", verification: "accurate" }));

    const res = await GET(reqGet());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as {
      schemaVersion: string;
      repeatedPatterns: { patternType: string; occurrences: number; lastSeenAt: string }[];
    };
    expect(body.schemaVersion).toBe(TWIN_REPEATABILITY_SCHEMA_VERSION);
    expect(body.repeatedPatterns.length).toBe(1);
    expect(body.repeatedPatterns[0]!.patternType).toBe("delay");
    expect(body.repeatedPatterns[0]!.occurrences).toBe(1);
  });

  it("optional scenario query filters aggregates", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(R_USER);
    await POST_VERIFY(reqPostVerify({ scenario: "alpha unique", verification: "inaccurate" }));
    await POST_VERIFY(reqPostVerify({ scenario: "beta unique", verification: "accurate" }));

    const res = await GET(reqGet("alpha unique"));
    const body = (await res.json()) as {
      repeatedPatterns: { patternType: string; occurrences: number }[];
    };
    expect(body.repeatedPatterns.reduce((s, p) => s + p.occurrences, 0)).toBe(1);
  });

  it("GET repeatability dispatches through getWaiaRuntimeDb with sqlite handle by default", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(R_USER);
    await POST_VERIFY(reqPostVerify({ scenario: "deadline pressure", verification: "accurate" }));
    const spy = vi.spyOn(waiaRuntimeDb, "getWaiaRuntimeDb");
    const res = await GET(reqGet());
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    const handle = (await spy.mock.results[0]!.value) as WaiaRuntimeDb;
    expect(handle).toMatchObject({ kind: "sqlite" });
  });

  it("GET repeatability uses Postgres analyze when runtime is postgres (mocked)", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(R_USER);
    const mockPg = drizzle.mock({ schema: pgSchema });
    const pgHandle: WaiaRuntimeDb = { kind: "postgres", db: mockPg };
    const runtimeSpy = vi.spyOn(waiaRuntimeDb, "getWaiaRuntimeDb").mockResolvedValue(pgHandle);

    const stubBody = {
      schemaVersion: TWIN_REPEATABILITY_SCHEMA_VERSION,
      repeatedPatterns: [
        { patternType: "delay", occurrences: 2, lastSeenAt: "2026-03-03T10:00:00.000Z" },
      ],
    };
    const analyzeMock = vi.fn().mockResolvedValue(stubBody);
    const resolveSpy = vi.spyOn(runtimePersistence, "resolveTwinPersistence").mockReturnValue({
      analyzeRepeatabilityForUser: analyzeMock,
    } as unknown as ReturnType<typeof runtimePersistence.resolveTwinPersistence>);

    try {
      const res = await GET(reqGet("weekly planning"));
      expect(res.status).toBe(200);
      expect(resolveSpy).toHaveBeenCalledWith(pgHandle);
      expect(analyzeMock).toHaveBeenCalledWith(R_USER, { scenarioText: "weekly planning" });
      await expect(res.json()).resolves.toEqual(stubBody);
    } finally {
      runtimeSpy.mockRestore();
      resolveSpy.mockRestore();
    }
  });
});
