import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { ReportingPeriodBasisError, type ReportingPeriodBasisCode } from "@/lib/trader/billing/v2/reporting-period-basis-v1";
const read = vi.hoisted(() => vi.fn());
const productionDeps = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trader/billing/v2/reporting-period-basis-postgres-v1", async (original) => ({
  ...await original<typeof import("@/lib/trader/billing/v2/reporting-period-basis-postgres-v1")>(), readReportingPeriodBasisV1Postgres: read,
}));
vi.mock("@/lib/trader/admin-route-deps", () => ({ createProductionAdminRouteDeps: productionDeps }));
import { handleAdminReportingPeriodBasisGet } from "@/lib/trader/billing/reporting-period-basis-read";
import { GET } from "@/app/api/trader/admin/reporting-periods/[periodId]/basis/route";

const org = "00000000-0000-4000-8000-000000001125", period = "00000000-0000-4000-8000-000000001126";
function fixture(role: "admin" | "user" = "admin", userId: string | null = "test-user") {
  const db = { select() {
    let table: unknown;
    const query = { from(t: unknown) { table = t; return query; }, where() { return query; }, async limit() {
      if (table === schema.userPlatformRoles) return [{ role }];
      if (table === schema.organizationMembers) return [{ id: "test-member" }];
      throw new Error("UNEXPECTED_QUERY");
    } }; return query;
  } };
  const runtime = { kind: "postgres", db } as unknown as WaiaRuntimeDb;
  const deps: AdminRouteHandlerDeps = { getUserId: vi.fn(async () => userId), getRuntimeDb: vi.fn(async () => runtime), disposeRuntimeDb: vi.fn(async () => {}) };
  const request = new Request(`https://offline.invalid/api/trader/admin/reporting-periods/${period}/basis?organization_id=${org}&exchange_account_id=${encodeURIComponent(" exact account ")}`);
  return { deps, runtime, request };
}
beforeEach(() => { vi.clearAllMocks(); read.mockResolvedValue({ status: "BASIS_MISSING", basis: null }); });
describe("DEE1125 actual admin GET boundary (inert replay port, real permission resolver)", () => {
  it("passes exact account and authenticated actor; disposes once", async () => {
    const f = fixture();
    expect(await handleAdminReportingPeriodBasisGet(f.request, period, f.deps)).toMatchObject({ status: 200, body: { status: "BASIS_MISSING", basis: null } });
    expect(read.mock.calls[0][1]).toEqual({ organizationId: org, userId: "test-user" });
    expect(read.mock.calls[0][2]).toEqual({ periodId: period, exchangeAccountId: " exact account " });
    expect(f.deps.disposeRuntimeDb).toHaveBeenCalledTimes(1);
    expect(f.deps.disposeRuntimeDb).toHaveBeenCalledWith(f.runtime);
  });
  it.each([null, "user"] as const)("does not read evidence for denied actor %s", async (role) => {
    const f = role === null ? fixture("admin", null) : fixture("user");
    expect((await handleAdminReportingPeriodBasisGet(f.request, period, f.deps)).status).toBe(role === null ? 401 : 403);
    expect(read).not.toHaveBeenCalled();
    expect(f.deps.disposeRuntimeDb).toHaveBeenCalledTimes(role === null ? 0 : 1);
  });
  it.each(["", "BAD", period.toUpperCase()])("invalid period %s refuses before acquisition", async (id) => {
    const f = fixture();
    // The fixture UUID contains digits only, so use a real uppercase hex alias.
    const invalid = id === period.toUpperCase() ? "00000000-0000-4000-8000-00000000112A" : id;
    expect((await handleAdminReportingPeriodBasisGet(f.request, invalid, f.deps)).status).toBe(400);
    expect(f.deps.getRuntimeDb).not.toHaveBeenCalled();
  });
  it.each([
    ["BASIS_PERIOD_NOT_FOUND", 404], ["PERIOD_NOT_CLOSED", 409], ["BASIS_SCHEMA_UNAVAILABLE", 503],
    ["BASIS_VERSION_UNSUPPORTED", 422], ["BASIS_CONTENT_INVALID", 409], ["BASIS_PERIOD_MISMATCH", 409],
    ["BASIS_SOURCE_REPLAY_MISMATCH", 409], ["BASIS_CAPACITY_EXCEEDED", 413],
  ] as const)("maps known %s without a success body", async (code: ReportingPeriodBasisCode, status) => {
    const f = fixture(); read.mockRejectedValueOnce(new ReportingPeriodBasisError(code));
    expect(await handleAdminReportingPeriodBasisGet(f.request, period, f.deps)).toMatchObject({ status, body: { error: { code } } });
    expect(f.deps.disposeRuntimeDb).toHaveBeenCalledTimes(1);
    expect(f.deps.disposeRuntimeDb).toHaveBeenCalledWith(f.runtime);
  });
  it("actual route maps unexpected storage error500 and cleans once", async () => {
    const f = fixture(); productionDeps.mockReturnValue(f.deps); read.mockRejectedValueOnce(new Error("STORAGE_FAULT"));
    const response = await GET(f.request, { params: Promise.resolve({ periodId: period }) });
    expect(response.status).toBe(500); expect(await response.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(f.deps.disposeRuntimeDb).toHaveBeenCalledTimes(1);
    expect(f.deps.disposeRuntimeDb).toHaveBeenCalledWith(f.runtime);
  });
  it("does not retry rejected disposal", async () => {
    const f = fixture(); vi.mocked(f.deps.disposeRuntimeDb).mockRejectedValueOnce(new Error("CLEANUP_FAULT"));
    await expect(handleAdminReportingPeriodBasisGet(f.request, period, f.deps)).rejects.toThrow("CLEANUP_FAULT");
    expect(f.deps.disposeRuntimeDb).toHaveBeenCalledTimes(1);
  });
  it("rejects SQLite after authorized ownership with cleanup", async () => {
    const f = fixture();
    const query = { from() { return query; }, where() { return query; }, limit() { return query; }, all() { return [{ role: "admin", id: "member" }]; } };
    const sqlite = { kind: "sqlite", db: { select: () => query } } as unknown as WaiaRuntimeDb;
    vi.mocked(f.deps.getRuntimeDb).mockResolvedValueOnce(sqlite);
    expect(await handleAdminReportingPeriodBasisGet(f.request, period, f.deps)).toMatchObject({ status: 503, body: { error: { code: "BASIS_SCHEMA_UNAVAILABLE" } } });
    expect(read).not.toHaveBeenCalled();
    expect(f.deps.disposeRuntimeDb).toHaveBeenCalledTimes(1);
    expect(f.deps.disposeRuntimeDb).toHaveBeenCalledWith(sqlite);
  });
});
