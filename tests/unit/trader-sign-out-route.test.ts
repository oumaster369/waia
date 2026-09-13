import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/sign-out/route";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(), provider: vi.fn(), signOut: vi.fn(), cookieGet: vi.fn(),
  deleteSession: vi.fn(), clearCookie: vi.fn(), applyCookies: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet }) }));
vi.mock("@/db/client", () => ({ getDb: () => "test-db" }));
vi.mock("@/lib/auth/session-service", () => ({ deleteSessionById: mocks.deleteSession }));
vi.mock("@/lib/auth/cookie-response", () => ({ clearSessionCookie: mocks.clearCookie }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseAuthConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseRouteHandlerClient: mocks.provider }));
vi.mock("@/lib/supabase/apply-response-cookies", () => ({ applySupabaseCookiePatches: mocks.applyCookies }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.provider.mockResolvedValue({ auth: { signOut: mocks.signOut } });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.cookieGet.mockReturnValue({ value: "isolated-test-session" });
});

describe("sign-out acknowledgement route", () => {
  it.each(["returned error", "thrown error", "missing configured client"])("does not acknowledge %s or deliberately clear local state", async (failure) => {
    if (failure === "returned error") mocks.signOut.mockResolvedValue({ error: { message: "sensitive provider detail" } });
    if (failure === "thrown error") mocks.signOut.mockRejectedValue(new Error("sensitive provider detail"));
    if (failure === "missing configured client") mocks.provider.mockResolvedValue(null);
    const result = await POST();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false, error: "SIGN_OUT_NOT_CONFIRMED" });
    expect(mocks.deleteSession).not.toHaveBeenCalled();
    expect(mocks.clearCookie).not.toHaveBeenCalled();
    expect(mocks.applyCookies).not.toHaveBeenCalled();
  });

  it("preserves the default provider scope and clears local state only after acknowledgement", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.signOut).toHaveBeenCalledWith();
    expect(mocks.deleteSession).toHaveBeenCalledWith("test-db", "isolated-test-session");
    expect(mocks.clearCookie).toHaveBeenCalledOnce();
    expect(mocks.applyCookies).toHaveBeenCalledOnce();
  });

  it("keeps local-only logout independent of an unconfigured provider", async () => {
    mocks.configured.mockReturnValue(false);
    const response = await POST();
    expect(response.status).toBe(200);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.deleteSession).toHaveBeenCalledOnce();
  });
});
