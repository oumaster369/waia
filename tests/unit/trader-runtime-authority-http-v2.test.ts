import { describe, expect, it, vi } from "vitest";
import { handleTenantRuntimeAuthorityGet, type TenantRuntimeAuthorityHttpDeps } from "@/lib/trader/runtime-authority/v2";

function deps(userId: string | null, access = true): TenantRuntimeAuthorityHttpDeps {
  return { getUserId: vi.fn(async () => userId), hasTraderAccess: vi.fn(async () => access),
    getRuntimeDb: vi.fn(async () => { throw new Error("DB_MUST_NOT_BE_REACHED"); }),
    disposeRuntimeDb: vi.fn(async () => undefined) };
}

describe("tenant Runtime Authority HTTP authorization", () => {
  it("rejects browser-supplied organization authority before authentication or DB access", async () => {
    const dependencies = deps("user-a");
    const result = await handleTenantRuntimeAuthorityGet(
      new Request("http://waia.test/api/trader/runtime-authority?organization_id=org-b"), dependencies);
    expect(result).toMatchObject({ status: 400, body: { error: { code: "ORG_SCOPE_FORBIDDEN" } } });
    expect(dependencies.getRuntimeDb).not.toHaveBeenCalled();
  });

  it("fails closed without session or Trader entitlement", async () => {
    expect((await handleTenantRuntimeAuthorityGet(new Request("http://waia.test/api/trader/runtime-authority"), deps(null))).status).toBe(401);
    const forbidden = deps("user-a", false);
    expect((await handleTenantRuntimeAuthorityGet(new Request("http://waia.test/api/trader/runtime-authority"), forbidden)).status).toBe(403);
    expect(forbidden.getRuntimeDb).not.toHaveBeenCalled();
  });
});
