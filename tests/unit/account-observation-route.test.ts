import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(), access: vi.fn(), dispose: vi.fn(), membership: vi.fn(), entitlement: vi.fn(), permission: vi.fn(),
  postgres: vi.fn(), end: vi.fn(), resolve: vi.fn(), latest: vi.fn(),
}));
vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("@/lib/auth/session-user", () => ({ getOptionalAdminSessionUserId: mocks.user }));
vi.mock("@/db/waia-runtime-db", () => ({ getWaiaRuntimeDb: mocks.access, disposeWaiaRuntimeDb: mocks.dispose }));
vi.mock("@/lib/waia-core/scope/org-context", () => ({ assertOrgMembershipPostgres: mocks.membership }));
vi.mock("@/lib/waia-core/entitlements/authoritative", () => ({ hasModuleEntitlementPostgres: mocks.entitlement }));
vi.mock("@/lib/waia-core/permissions/admin-http", () => ({ assertAdminPermission: mocks.permission }));
vi.mock("@/lib/trader/account-observation/postgres-reader", () => ({
  createPostgresObservationReader: () => ({ resolveActiveBinding: mocks.resolve, readLatest: mocks.latest }),
}));
import { accountObservationRoute } from "@/lib/trader/account-observation/route";
const binding = { organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "account",
  credentialRevision: "1", configurationRevision: "config-1" };
const request = () => new Request("http://localhost/api/trader/account-observation?" + new URLSearchParams(binding));
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_DATABASE_URL", "");
  mocks.user.mockResolvedValue("synthetic-user"); mocks.access.mockResolvedValue({ kind: "postgres", db: {} });
  mocks.entitlement.mockResolvedValue(true); mocks.membership.mockResolvedValue(undefined);
  mocks.permission.mockResolvedValue({ allowed: true }); mocks.resolve.mockResolvedValue(binding);
  mocks.latest.mockResolvedValue(null); mocks.end.mockResolvedValue(undefined);
  mocks.postgres.mockReturnValue({ end: mocks.end });
});
afterEach(() => vi.unstubAllEnvs());
describe("account observation route wiring, no external requests", () => {
  it("does not acquire either database for anonymous requests", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await accountObservationRoute(request(), "tenant")).status).toBe(401);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.postgres).not.toHaveBeenCalled();
  });
  it("missing dedicated connection fails closed without general DB fallback", async () => {
    vi.stubEnv("DATABASE_URL_POSTGRES", "synthetic-forbidden-fallback");
    const response = await accountObservationRoute(request(), "tenant");
    expect(response.status).toBe(503); expect(mocks.postgres).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("fallback"); expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("uses only dedicated bounded connection and disposes it after every poll", async () => {
    vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_DATABASE_URL", "synthetic-reader-url");
    expect((await accountObservationRoute(request(), "tenant")).status).toBe(204);
    expect(mocks.postgres).toHaveBeenCalledWith("synthetic-reader-url", expect.objectContaining({ max: 1, prepare: false, connect_timeout: 3 }));
    expect(mocks.end).toHaveBeenCalledOnce(); expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("does not give an unauthorized operator a projection connection", async () => {
    mocks.permission.mockResolvedValue({ allowed: false });
    expect((await accountObservationRoute(request(), "admin")).status).toBe(403);
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
  it("does not fall back to SQLite for this new storage path", async () => {
    mocks.access.mockResolvedValue({ kind: "sqlite", db: {} });
    expect((await accountObservationRoute(request(), "tenant")).status).toBe(503);
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
  it("never exposes driver details and still closes a failed reader", async () => {
    vi.stubEnv("WAIA_ACCOUNT_OBSERVATION_DATABASE_URL", "synthetic-reader-url");
    mocks.resolve.mockRejectedValue(new Error("synthetic-private-driver-detail"));
    const response = await accountObservationRoute(request(), "tenant");
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("driver-detail");
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
