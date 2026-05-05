import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as oauthCallbackGet } from "@/app/api/auth/oauth/[provider]/callback/route";
import { resetWaiaSqliteSingleton, getDb } from "@/db/client";
import { oauthAccounts, oauthStates, twinProfiles } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { OAUTH_ERROR_QUERY } from "@/lib/oauth/oauth-error-codes";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";

describe("GET /api/auth/oauth/google/callback", () => {
  let tmpRoot: string;
  let prevDatabaseUrl: string | undefined;
  let prevPublicBase: string | undefined;
  let prevGoogleId: string | undefined;
  let prevGoogleSecret: string | undefined;

  beforeAll(() => {
    prevDatabaseUrl = process.env.DATABASE_URL;
    prevPublicBase = process.env.OAUTH_PUBLIC_BASE_URL;
    prevGoogleId = process.env.GOOGLE_CLIENT_ID;
    prevGoogleSecret = process.env.GOOGLE_CLIENT_SECRET;

    tmpRoot = mkdtempSync(path.join(tmpdir(), "waia-oauth-g-"));
    const dbPath = path.join(tmpRoot, "oauth.sqlite");
    mkdirSync(tmpRoot, { recursive: true });
    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.OAUTH_PUBLIC_BASE_URL = "http://127.0.0.1";
    process.env.GOOGLE_CLIENT_ID = "test-google-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";

    resetWaiaSqliteSingleton();
    migrateDatabaseFromEnv();
  });

  afterAll(() => {
    resetWaiaSqliteSingleton();
    process.env.DATABASE_URL = prevDatabaseUrl;
    process.env.OAUTH_PUBLIC_BASE_URL = prevPublicBase;
    process.env.GOOGLE_CLIENT_ID = prevGoogleId;
    process.env.GOOGLE_CLIENT_SECRET = prevGoogleSecret;
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* cleanup best-effort */
    }
  });

  it("redirects home with OAUTH_INVALID_STATE when no oauth_states row matches", async () => {
    const req = new Request(
      "http://127.0.0.1/api/auth/oauth/google/callback?code=ignored&state=unknown-state-token",
    );
    const res = await oauthCallbackGet(req, {
      params: Promise.resolve({ provider: "google" }),
    });

    expect(res.status).toBe(302);
    const loc = res.headers.get("Location");
    expect(loc).not.toBeNull();
    expect(new URL(loc!).searchParams.get(OAUTH_ERROR_QUERY)).toBe("OAUTH_INVALID_STATE");
  });

  it("exchanges Google code mock, persists user + twin seed, consumes state, redirects with session cookie", async () => {
    const stubFetch = vi.fn(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "opaque-at" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (urlStr.includes("oauth2/v3/userinfo")) {
        return new Response(
          JSON.stringify({
            sub: "google-test-subject",
            email: "google-oauth-test@example.com",
            email_verified: true,
            name: "Google OAuth Test",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("unexpected url", { status: 500 });
    });

    vi.stubGlobal("fetch", stubFetch);

    const db = getDb() as WaiaDb;
    const state = "test-oauth-state-static";
    const verifier = "0123456789abcdef0123456789abcdef0123456789abcd";
    db.insert(oauthStates)
      .values({
        state,
        provider: "google",
        codeVerifier: verifier,
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .run();

    const req = new Request(
      `http://127.0.0.1/api/auth/oauth/google/callback?code=auth-code-abc&state=${encodeURIComponent(state)}`,
    );
    const res = await oauthCallbackGet(req, {
      params: Promise.resolve({ provider: "google" }),
    });

    vi.unstubAllGlobals();

    expect(res.status).toBe(302);
    const loc = res.headers.get("Location");
    expect(loc).not.toBeNull();
    expect(new URL(loc!).pathname).toBe("/dashboard");

    const cookieJoined =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie().join(";")
        : (res.headers.get("set-cookie") ?? "");
    expect(cookieJoined).toMatch(/waia_session=/);

    const rowConsumedRows = db
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.state, state))
      .limit(1)
      .all();
    expect(rowConsumedRows[0]).toBeUndefined();

    const linkRows = db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerUserId, "google-test-subject"))
      .limit(1)
      .all();
    const link = linkRows[0];
    expect(link).toBeDefined();

    const twinRows = db
      .select()
      .from(twinProfiles)
      .where(eq(twinProfiles.userId, link!.userId))
      .limit(1)
      .all();
    const twin = twinRows[0];
    expect(twin).toBeDefined();

    expect(stubFetch).toHaveBeenCalled();
    const urls = stubFetch.mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : c[0] instanceof URL ? c[0].href : c[0].url,
    );
    expect(urls.some((u) => u.includes("oauth2.googleapis.com/token"))).toBe(true);
    expect(urls.some((u) => u.includes("oauth2/v3/userinfo"))).toBe(true);
  });
});
