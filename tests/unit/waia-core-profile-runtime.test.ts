import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, PATCH } from "@/app/api/profile/route";
import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { users } from "@/db/schema";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import * as sessionUser from "@/lib/auth/session-user";
import {
  readProfileForSessionUser,
  updateProfileForSessionUser,
} from "@/lib/waia-core/profiles/runtime";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const USER_ID = "profile-runtime-user-a";
const USER_NO_PROFILE = "profile-runtime-user-b";

function patchJson(body: unknown) {
  return new Request("http://localhost/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("WAIA Core profile runtime (WC-E1 S1)", () => {
  let tmpRoot: string;
  let prevDb: string | undefined;

  beforeAll(() => {
    prevDb = process.env.DATABASE_URL;
    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-profile-runtime-"));
    const dbPath = path.join(tmpRoot, "profile.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "profile-a@example.com",
      password: "password123",
      identityLabel: "Profile User",
    });
    db.insert(users)
      .values({
        id: USER_NO_PROFILE,
        email: "profile-b@example.com",
        identityLabel: "No Profile Yet",
        passwordHash: "unused",
      })
      .run();
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
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(USER_ID);
  });

  it("readProfileForSessionUser returns seeded profile", async () => {
    const profile = await readProfileForSessionUser(USER_ID);
    expect(profile).toEqual({
      displayName: "Profile User",
      locale: "en",
      avatarRef: null,
    });
  });

  it("readProfileForSessionUser ensures profile when row was missing", async () => {
    const profile = await readProfileForSessionUser(USER_NO_PROFILE);
    expect(profile?.displayName).toBe("No Profile Yet");
    expect(profile?.locale).toBe("en");
  });

  it("updateProfileForSessionUser updates displayName and locale", async () => {
    const updated = await updateProfileForSessionUser(USER_ID, {
      displayName: "Updated Name",
      locale: "de",
    });
    expect(updated).toEqual({
      displayName: "Updated Name",
      locale: "de",
      avatarRef: null,
    });
  });

  it("GET returns 401 when unauthenticated", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("UNAUTHENTICATED");
  });

  it("GET returns profile with no-store", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const body = (await res.json()) as {
      ok: true;
      profile: { displayName: string; locale: string; avatarRef: string | null };
    };
    expect(body.ok).toBe(true);
    expect(body.profile.displayName).toBe("Updated Name");
    expect(body.profile.locale).toBe("de");
    expect(body.profile).not.toHaveProperty("settings");
  });

  it("PATCH returns 401 when unauthenticated", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const res = await PATCH(patchJson({ displayName: "X" }));
    expect(res.status).toBe(401);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("UNAUTHENTICATED");
  });

  it("PATCH rejects empty body with VALIDATION_ERROR", async () => {
    const res = await PATCH(patchJson({}));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH rejects empty displayName", async () => {
    const res = await PATCH(patchJson({ displayName: "   " }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH rejects displayName longer than 80 characters", async () => {
    const res = await PATCH(patchJson({ displayName: "a".repeat(81) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH rejects invalid locale", async () => {
    const res = await PATCH(patchJson({ locale: "english" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH ignores avatarRef in request body", async () => {
    const res = await PATCH(
      patchJson({ displayName: "Avatar Ignored", avatarRef: "https://example.com/a.png" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      profile: { displayName: string; avatarRef: string | null };
    };
    expect(body.profile.displayName).toBe("Avatar Ignored");
    expect(body.profile.avatarRef).toBeNull();
  });

  it("loadDashboardReadinessPayloadFromDb exposes displayName from profile", async () => {
    const { loadDashboardReadinessPayloadFromDb } = await import("@/lib/twin-persistence/loader");
    const db = getDb();
    const payload = await loadDashboardReadinessPayloadFromDb(db, USER_ID);
    expect(payload.displayName).toBe("Avatar Ignored");
    expect(payload.identityLabel).toBe("Profile User");
  });
});
