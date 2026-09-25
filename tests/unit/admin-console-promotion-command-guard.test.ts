import { describe, it, expect, vi, beforeEach } from "vitest";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/waia-core/permissions/resolve", () => ({
  resolvePermissionSqlite: resolve,
  resolvePermissionPostgres: resolve,
}));
import { handleAdminStrategyPromotionCommandPost } from "@/lib/trader/validation-gate/admin-route-handler";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
const org = "00000000-0000-4000-8000-000000000001",
  user = "00000000-0000-4000-8000-000000000002";
describe("promotion command console authorization", () => {
  beforeEach(() => {
    resolve.mockReset();
  });
  const deps = () =>
    ({
      getUserId: async () => user,
      getRuntimeDb: vi.fn(async () => ({ kind: "sqlite", db: {} })),
      disposeRuntimeDb: vi.fn(async () => undefined),
    }) as unknown as AdminRouteHandlerDeps;
  it("rejects absent/foreign Origin and non-JSON before opening database", async () => {
    for (const headers of [
      { "content-type": "application/json" },
      { "content-type": "application/json", origin: "https://foreign.invalid" },
      { "content-type": "text/plain", origin: "http://localhost" },
    ] as Record<string, string>[]) {
      const d = deps(),
        result = await handleAdminStrategyPromotionCommandPost(
          new Request("http://localhost/api/trader/admin/strategy-promotions/commands", {
            method: "POST",
            headers,
            body: "{}",
          }),
          d,
        );
      expect(result.status).toBe(403);
      expect(d.getRuntimeDb).not.toHaveBeenCalled();
    }
  });
  it("read permission cannot authorize a mutation and denied runtime is disposed", async () => {
    resolve.mockImplementation(async (_db, input) => ({
      allowed: input.permission === "admin.audit.read",
    }));
    const d = deps(),
      result = await handleAdminStrategyPromotionCommandPost(
        new Request("http://localhost/api/trader/admin/strategy-promotions/commands", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost" },
          body: JSON.stringify({
            organization_id: org,
            command: "confirm",
            record_id: org,
            expected_state_version: 1,
          }),
        }),
        d,
      );
    expect(result.status).toBe(403);
    expect(resolve.mock.calls.map((call) => call[1].permission)).toEqual([
      "admin.audit.read",
      "admin.trader.operations.mutate",
    ]);
    expect(d.disposeRuntimeDb).toHaveBeenCalledTimes(1);
  });
});
