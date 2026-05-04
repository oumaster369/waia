import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { count, eq } from "drizzle-orm";

import { GET as GET_LIST } from "@/app/api/dashboard/twin/prediction/verifications/route";
import { POST } from "@/app/api/dashboard/twin/prediction/verification/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { twinPredictionVerifications, twinRepeatabilityRecords } from "@/db/schema";
import * as sessionUser from "@/lib/auth/session-user";
import {
  MAX_VERIFICATION_CORRECTION_CHARS,
  MAX_VERIFICATION_SCENARIO_CHARS,
  TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION,
} from "@/lib/dashboard/twin-prediction-verification-api.types";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const ROUTE_USER = "tpv-route-user";

function reqPost(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/twin/prediction/verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function reqGet(limit?: string): Request {
  const q = limit != null ? `?limit=${encodeURIComponent(limit)}` : "";
  return new Request(`http://localhost/api/dashboard/twin/prediction/verifications${q}`);
}

describe("twin prediction verification API routes (DEE-34)", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-tpv-route-"));
    const dbPath = path.join(tmpRoot, "walita.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    insertEmailPasswordUser(getDb(), {
      id: ROUTE_USER,
      email: "tpv-route@example.com",
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
    getDb().delete(twinPredictionVerifications).run();
  });

  it("POST returns 401 without session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await POST(reqPost({ scenario: "x", verification: "accurate" }));
    expect(res.status).toBe(401);
  });

  it("POST rejects missing or empty scenario", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);

    let res = await POST(reqPost({ verification: "accurate" }));
    expect(res.status).toBe(400);

    res = await POST(reqPost({ scenario: " \n ", verification: "accurate" }));
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: { code: string } };
    expect(j.error.code).toBe("EMPTY_SCENARIO");
  });

  it("POST rejects invalid verification", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const res = await POST(reqPost({ scenario: "ok", verification: "maybe_later" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_VERIFICATION");
  });

  it("POST enforces scenario and correction length", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);

    let res = await POST(
      reqPost({
        scenario: "x".repeat(MAX_VERIFICATION_SCENARIO_CHARS + 1),
        verification: "accurate",
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SCENARIO_TOO_LONG");

    res = await POST(
      reqPost({
        scenario: "ok",
        verification: "accurate",
        correction: "c".repeat(MAX_VERIFICATION_CORRECTION_CHARS + 1),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CORRECTION_TOO_LONG");
  });

  it("POST 200 accurate and sets cache + schema", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const res = await POST(
      reqPost({ scenario: " ship tomorrow calmly ", predictionId: null, verification: "accurate" }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as {
      schemaVersion: string;
      verification: { id: string; scenario: string; verification: string; correction: unknown; createdAt: string };
    };
    expect(body.schemaVersion).toBe(TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION);
    expect(body.verification.scenario).toBe("ship tomorrow calmly");
    expect(body.verification.verification).toBe("accurate");
    expect(body.verification.correction).toBeNull();
    expect(body.verification.id.length).toBeGreaterThan(10);
    expect(() => new Date(body.verification.createdAt).toISOString()).not.toThrow();

    const repCount =
      getDb()
        .select({ n: count() })
        .from(twinRepeatabilityRecords)
        .where(eq(twinRepeatabilityRecords.userId, ROUTE_USER))
        .get()?.n ?? 0;
    expect(repCount).toBe(1);
  });

  it("POST dedupes repeatability rows for same scenario+verification within the window", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const body = { scenario: "repeat dedup scenario text", verification: "accurate" as const };
    await POST(reqPost(body));
    await POST(reqPost(body));

    const repCount =
      getDb()
        .select({ n: count() })
        .from(twinRepeatabilityRecords)
        .where(eq(twinRepeatabilityRecords.userId, ROUTE_USER))
        .get()?.n ?? 0;
    expect(repCount).toBe(1);
  });

  it("POST 200 partially_accurate with correction", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const res = await POST(
      reqPost({
        scenario: "deadline sprint",
        verification: "partially_accurate",
        correction: "missed burnout angle",
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      verification: { verification: string; correction: string | null };
    };
    expect(body.verification.verification).toBe("partially_accurate");
    expect(body.verification.correction).toBe("missed burnout angle");
  });

  it("POST 200 inaccurate with correction", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);
    const res = await POST(
      reqPost({
        scenario: "solo trip",
        verification: "inaccurate",
        correction: "would not cancel flights",
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      verification: { verification: string; correction: string | null };
    };
    expect(body.verification.verification).toBe("inaccurate");
    expect(body.verification.correction).toBe("would not cancel flights");
  });

  it("GET lists only signed-in user verifications newest-first", async () => {
    const OTHER = "tpv-route-other-user";
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: OTHER,
      email: "tpv-route-other@example.com",
      password: "password123",
    });

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);

    await POST(reqPost({ scenario: "older", verification: "accurate" }));
    await POST(reqPost({ scenario: "newer", verification: "inaccurate", correction: "x" }));

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(OTHER);
    await POST(reqPost({ scenario: "their row", verification: "accurate" }));

    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(ROUTE_USER);

    const res = await GET_LIST(reqGet());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");

    const body = (await res.json()) as {
      schemaVersion: string;
      verifications: { scenario: string; createdAt: string }[];
    };
    expect(body.schemaVersion).toBe(TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION);
    expect(body.verifications).toHaveLength(2);
    expect(new Set(body.verifications.map((x) => x.scenario))).toEqual(new Set(["older", "newer"]));
    expect(
      Date.parse(body.verifications[0]!.createdAt) >= Date.parse(body.verifications[1]!.createdAt),
    ).toBe(true);
    expect(body.verifications.some((x) => x.scenario === "their row")).toBe(false);
  });

  it("GET returns 401 without session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await GET_LIST(reqGet());
    expect(res.status).toBe(401);
  });
});
