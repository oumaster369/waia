import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/dashboard/twin/repeatability/route";
import { POST as POST_VERIFY } from "@/app/api/dashboard/twin/prediction/verification/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { twinRepeatabilityRecords } from "@/db/schema";
import { TWIN_REPEATABILITY_SCHEMA_VERSION } from "@/lib/dashboard/twin-repeatability-api.types";
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

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
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
});
