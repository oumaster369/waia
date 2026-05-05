import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OAUTH_ERROR_QUERY } from "@/lib/oauth/oauth-error-codes";
import { oauthFailureRedirect, oauthSuccessDashboardRedirect } from "@/lib/oauth/redirect-response";

describe("oauthFailureRedirect / oauthSuccessDashboardRedirect", () => {
  let prevOauth: string | undefined;
  let prevSite: string | undefined;

  beforeEach(() => {
    prevOauth = process.env.OAUTH_PUBLIC_BASE_URL;
    prevSite = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.OAUTH_PUBLIC_BASE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://waia.test.example";
  });

  afterEach(() => {
    if (prevOauth === undefined) delete process.env.OAUTH_PUBLIC_BASE_URL;
    else process.env.OAUTH_PUBLIC_BASE_URL = prevOauth;
    if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
  });

  it("failure redirect goes to site root with only oauth_error query", () => {
    const res = oauthFailureRedirect("OAUTH_TOKEN");
    expect(res.status).toBe(302);
    const loc = res.headers.get("location");
    expect(loc).toBeTruthy();
    const u = new URL(loc!);
    expect(u.origin).toBe("https://waia.test.example");
    expect(u.pathname).toBe("/");
    expect(u.searchParams.get(OAUTH_ERROR_QUERY)).toBe("OAUTH_TOKEN");
    expect([...u.searchParams.keys()]).toEqual([OAUTH_ERROR_QUERY]);
  });

  it("success redirect goes to /dashboard on same origin", () => {
    const res = oauthSuccessDashboardRedirect();
    expect(res.status).toBe(302);
    const u = new URL(res.headers.get("location")!);
    expect(u.origin).toBe("https://waia.test.example");
    expect(u.pathname).toBe("/dashboard");
    expect(u.search).toBe("");
  });

  it("prefers OAUTH_PUBLIC_BASE_URL over NEXT_PUBLIC_SITE_URL", () => {
    process.env.OAUTH_PUBLIC_BASE_URL = "https://oauth-base.test";
    const res = oauthSuccessDashboardRedirect();
    const u = new URL(res.headers.get("location")!);
    expect(u.origin).toBe("https://oauth-base.test");
    expect(u.pathname).toBe("/dashboard");
  });
});
