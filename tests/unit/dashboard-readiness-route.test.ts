import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/dashboard/readiness/route";
import { resetWaiaSqliteSingleton, getDb } from "@/db/client";
import type { DashboardReadinessApiResponse } from "@/lib/dashboard/dashboard-readiness-api.types";
import * as sessionUser from "@/lib/auth/session-user";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { computeReadinessResult } from "@/lib/readiness";
import {
  ALLOWED_INDICATOR_PERCENTS,
  INDICATOR_KEYS_ORDER,
  type IndicatorKey,
} from "@/lib/readiness/types";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const ROUTE_TEST_USER_ID = "readiness-route-test-user";

describe("GET /api/dashboard/readiness", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-route-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: ROUTE_TEST_USER_ID,
      email: "readiness-route@example.com",
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
      /* temp cleanup best-effort */
    }
  });

  beforeEach(() => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockReset();
  });

  it("returns 401 when there is no session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 with readinessResult aligned to computeReadinessResult(readinessInput), hints stubs, no-store cache", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_TEST_USER_ID);
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as DashboardReadinessApiResponse;

    expect(body.readinessResult).toEqual(computeReadinessResult(body.readinessInput));

    expect(Object.keys(body.hintsByIndicator).sort()).toEqual([...INDICATOR_KEYS_ORDER].sort());
    for (const key of INDICATOR_KEYS_ORDER) {
      expect(body.hintsByIndicator[key as IndicatorKey]).toBeNull();
    }

    for (let i = 0; i < 6; i++) {
      const v = body.readinessInput.indicators[i];
      expect((ALLOWED_INDICATOR_PERCENTS as readonly number[]).includes(v)).toBe(true);
    }

    expect(typeof body.identityLabel).toBe("string");
    expect(typeof body.twinSignals.hasMeaningfulExchange).toBe("boolean");
  });
});
