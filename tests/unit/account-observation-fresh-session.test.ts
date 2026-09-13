import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), cached: vi.fn() }));
// Deliberately memoize forever: the fresh path must never use this wrapper.
vi.mock("react", () => ({
  cache: (fn: () => Promise<unknown>) => {
    let stored: Promise<unknown> | undefined;
    return () => {
      mocks.cached();
      return (stored ??= fn());
    };
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/db/waia-runtime-db", () => ({
  getWaiaRuntimeDb: vi.fn(),
  disposeWaiaRuntimeDb: vi.fn(),
}));
vi.mock("@/lib/persistence/postgres/twin-persistence", () => ({
  syncAppUserRowFromSupabaseAuthPostgres: vi.fn(),
}));
vi.mock("@/lib/auth/session-service", () => ({ resolveUserIdFromSessionId: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseAuthConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerReadOnly: async () => ({ auth: { getUser: mocks.getUser } }),
}));
import { getFreshOptionalAdminSessionUserId } from "@/lib/auth/session-user";

describe("stream identity checks bypass request memoization", () => {
  it("calls verified getUser again and observes identity loss in the same request", async () => {
    mocks.getUser
      .mockResolvedValueOnce({ data: { user: { id: "user-a" } }, error: null })
      .mockResolvedValueOnce({ data: { user: null }, error: new Error("revoked") });
    expect(await getFreshOptionalAdminSessionUserId()).toBe("user-a");
    expect(await getFreshOptionalAdminSessionUserId()).toBeNull();
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
    expect(mocks.cached).not.toHaveBeenCalled();
  });
});
