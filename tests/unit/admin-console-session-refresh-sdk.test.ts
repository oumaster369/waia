// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { refreshAdminSession } from "@/lib/supabase/admin-session-refresh";
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "fixture@example.test",
};
const jwt = (exp: number) =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({ sub: user.id, exp, aud: "authenticated", role: "authenticated" }),
    ).toString("base64url"),
    "fixture-signature",
  ].join(".");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("actual SSR client rotates an expired session and persists the verified replacement for the browser and server render", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-public-key");
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const access = jwt(expires);
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/v1/token")) {
      expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: "old-refresh" });
      return new Response(
        JSON.stringify({
          access_token: access,
          refresh_token: "fresh-refresh",
          expires_in: 3600,
          expires_at: expires,
          token_type: "bearer",
          user,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.endsWith("/auth/v1/user")) {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${access}`);
      return new Response(JSON.stringify(user), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("UNEXPECTED_AUTH_DESTINATION");
  });
  vi.stubGlobal("fetch", fetcher);
  const old =
    "base64-" +
    Buffer.from(
      JSON.stringify({
        access_token: jwt(1),
        refresh_token: "old-refresh",
        expires_at: 1,
        expires_in: 3600,
        token_type: "bearer",
        user,
      }),
    ).toString("base64url");
  const request = new NextRequest("https://trader.waia.life/admin", {
    headers: { cookie: `sb-fixture-auth-token=${old}` },
  });
  const response = await refreshAdminSession(request);
  expect(response.status).toBe(200);
  const renewed = response.cookies.get("sb-fixture-auth-token")?.value;
  expect(renewed).toBeDefined();
  expect(renewed).not.toBe(old);
  const stored = JSON.parse(
    Buffer.from(renewed!.replace(/^base64-/, ""), "base64url").toString("utf8"),
  );
  expect(stored.access_token).toBe(access);
  expect(stored.refresh_token).toBe("fresh-refresh");
  expect(response.headers.get("x-middleware-request-cookie")).toContain(renewed!);
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/auth/v1/user"))).toBe(true);
  expect(response.headers.has("x-user-id")).toBe(false);
});
