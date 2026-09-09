import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: "admin" as string | null,
  runtime: { sentinel: "auth-runtime" }, authorize: vi.fn(), dispose: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/components/trader/admin/admin-shell", () => ({ AdminShell: () => null }));
vi.mock("@/lib/trader/admin-route-deps", () => ({ createProductionAdminRouteDeps: () => ({
  getUserId: async () => mocks.user, disposeRuntimeDb: mocks.dispose,
}) }));
vi.mock("@/lib/trader/admin-route-shared", () => ({ authorizeAdminRoute: mocks.authorize }));
import TraderAdminLayout from "@/app/(trader)/admin/layout";

describe("trader admin page admission", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.user = "admin";
    mocks.authorize.mockResolvedValue({ ok: true, runtime: mocks.runtime });
  });
  it("redirects an anonymous visitor before opening an authorization database", async () => {
    mocks.user = null;
    await expect(TraderAdminLayout({ children: "protected" })).rejects.toThrow("REDIRECT:/");
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("does not render the shell to an authenticated non-admin and disposes runtime", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, runtime: mocks.runtime });
    await expect(TraderAdminLayout({ children: "protected" })).rejects.toThrow("NOT_FOUND");
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledWith(mocks.runtime);
  });
  it("renders only after canonical audit permission and disposes runtime", async () => {
    const result = await TraderAdminLayout({ children: "protected" });
    expect(result.props.children).toBe("protected");
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), expect.any(String), "admin.audit.read");
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledWith(mocks.runtime);
  });
  it("does not fail open when authorization throws", async () => {
    mocks.authorize.mockRejectedValue(new Error("authorization unavailable"));
    await expect(TraderAdminLayout({ children: "protected" })).rejects.toThrow("authorization unavailable");
  });
});
