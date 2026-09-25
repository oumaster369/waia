import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  configured: true,
  cookies: null as null | {
    getAll(): { name: string; value: string }[];
    setAll(patches: { name: string; value: string; options: object }[]): void;
  },
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: typeof mocks.cookies }) => {
    mocks.cookies = options.cookies;
    return { auth: { getUser: mocks.getUser } };
  },
}));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseAuthConfigured: () => mocks.configured }));
vi.mock("@/lib/hosts/resolve", () => ({
  isTraderHostRoutingEnabled: () => true,
  resolveModuleHost: () => ({ module: "trader" }),
}));
import { middleware } from "@/middleware";
const request = (path = "/admin/system", cookie = "sb-fixture-auth-token=old") =>
  new NextRequest(`https://trader.waia.life${path}`, { headers: { cookie } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured = true;
  mocks.cookies = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture-public-key";
  mocks.getUser.mockResolvedValue({ data: { user: { id: "existing-admin" } }, error: null });
});
describe("verified admin session refresh", () => {
  it("persists rotated cookies and forwards the fresh session to the same server render", async () => {
    mocks.getUser.mockImplementation(async () => {
      expect(mocks.cookies?.getAll()).toEqual([{ name: "sb-fixture-auth-token", value: "old" }]);
      mocks.cookies!.setAll([
        {
          name: "sb-fixture-auth-token",
          value: "fresh",
          options: { path: "/", sameSite: "lax", secure: true },
        },
      ]);
      return { data: { user: { id: "existing-admin" } }, error: null };
    });
    const result = await middleware(request());
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(result.cookies.get("sb-fixture-auth-token")?.value).toBe("fresh");
    expect(result.headers.get("x-middleware-request-cookie")).toContain(
      "sb-fixture-auth-token=fresh",
    );
    expect(result.headers.get("x-waia-module")).toBe("trader");
  });
  it.each(["/", "/api/trader/orders", "/admin-other"])(
    "leaves unrelated route %s unchanged",
    async (path) => {
      await middleware(request(path));
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );
  it("does not change legacy local authentication or create a session without a cookie", async () => {
    await middleware(request("/admin", "waia_session=legacy"));
    expect(mocks.getUser).not.toHaveBeenCalled();
    mocks.configured = false;
    await middleware(request());
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("returns unavailable for provider outage, without treating it as revoked or deleting cookies", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 504 } });
    const result = await middleware(request("/api/trader/admin/console/accounts"));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({
      error: {
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
        message: "Сервис авторизации временно недоступен. Повторите загрузку.",
      },
    });
    expect(result.headers.get("set-cookie")).toBeNull();
  });
  it("keeps invalid sessions subject to the existing protected-route check", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    const result = await middleware(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("x-middleware-next")).toBe("1");
    expect(result.headers.has("x-user-id")).toBe(false);
  });
});
