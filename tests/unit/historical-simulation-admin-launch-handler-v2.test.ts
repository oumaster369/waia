import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  csrf: vi.fn(),
  disposeAuth: vi.fn(),
}));
vi.mock("@/lib/trader/admin-route-shared", async (original) => {
  const actual = await original<typeof import("@/lib/trader/admin-route-shared")>();
  return { ...actual,
    parseOrganizationId: (url: URL) => url.searchParams.get("organization_id") ?? {
      status: 400, body: { error: { code: "ORGANIZATION_ID_REQUIRED" } }, outcome: "client_error",
    },
    authorizeAdminRoute: mocks.authorize,
  };
});
vi.mock("@/lib/trader/fhv-admin-csrf", () => ({ validateFhvAdminCsrf: mocks.csrf }));
vi.mock("@/lib/trader/observability/fhv-runtime-secrets", () => ({
  requireFhvCsrfSecret: () => "csrf-secret",
}));

import { handleHistoricalSimulationAdminLaunchPostV2 } from
  "@/lib/trader/historical-simulation-v2/admin-launch-handler-v2";
import { buildHistoricalSimulationRunLifecycleEventV2 } from
  "@/lib/trader/historical-simulation-v2/run-lifecycle-v2";

const body = { account_id: "account-a", run_id: "run-a",
  partition: "WALK_FORWARD", symbol: "BTCUSDT" };

describe("Historical Simulation V2 authenticated admin launch route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ ok: true, userId: "operator-a",
      runtime: { kind: "postgres" } });
    mocks.csrf.mockReturnValue(true);
  });

  it("queues the exact identity after mutate permission and CSRF, without caller totals", async () => {
    const queue = vi.fn(async (input) => buildHistoricalSimulationRunLifecycleEventV2({
      organizationId: input.organizationId, accountId: input.accountId, runId: input.runId,
      partition: input.partition, symbol: input.symbol, eventSequence: 0, phase: "QUEUED",
      initialRecordIndex: 240, terminalRecordIndexExclusive: 340, qualifiedTotalCycles: 100,
      committedCycles: 0, nextCycleSequence: 0, latestCommittedCycleId: null,
      requestedByOperatorId: input.requestedByOperatorId,
      observedAt: "2026-09-03T09:00:00.000Z", errorCode: null,
      previousContentDigestHex: null,
    }));
    const dispose = vi.fn(async () => undefined);
    const response = await handleHistoricalSimulationAdminLaunchPostV2(new Request(
      "https://waia.test/api?organization_id=11111111-1111-4111-8111-111111111111",
      { method: "POST", body: JSON.stringify(body) },
    ), { getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth,
      openLifecycle: () => ({ lifecycle: { queue, claim: vi.fn(), append: vi.fn() }, dispose }) });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(),
      "11111111-1111-4111-8111-111111111111", "admin.trader.operations.mutate");
    expect(queue).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-a", requestedByOperatorId: "operator-a",
    }));
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ lifecycle: { phase: "QUEUED", qualifiedTotalCycles: 100 } });
    expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.disposeAuth).toHaveBeenCalledOnce();
  });

  it("refuses permission or CSRF failure before opening the lifecycle database", async () => {
    const openLifecycle = vi.fn();
    mocks.authorize.mockResolvedValueOnce({ ok: false,
      result: { status: 403, body: { error: { code: "FORBIDDEN" } }, outcome: "client_error" } });
    const denied = await handleHistoricalSimulationAdminLaunchPostV2(new Request(
      "https://waia.test/api?organization_id=org-a", { method: "POST", body: JSON.stringify(body) }),
    { getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth, openLifecycle });
    expect(denied.status).toBe(403);
    mocks.authorize.mockResolvedValueOnce({ ok: true, userId: "operator-a", runtime: { kind: "postgres" } });
    mocks.csrf.mockReturnValueOnce(false);
    const csrf = await handleHistoricalSimulationAdminLaunchPostV2(new Request(
      "https://waia.test/api?organization_id=org-a", { method: "POST", body: JSON.stringify(body) }),
    { getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth, openLifecycle });
    expect(csrf.status).toBe(403);
    expect(openLifecycle).not.toHaveBeenCalled();
  });

  it("rejects extra authority fields such as caller-selected qualified totals", async () => {
    const openLifecycle = vi.fn();
    const response = await handleHistoricalSimulationAdminLaunchPostV2(new Request(
      "https://waia.test/api?organization_id=org-a",
      { method: "POST", body: JSON.stringify({ ...body, qualified_total_cycles: 1 }) }),
    { getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth, openLifecycle });
    expect(response.status).toBe(400);
    expect(openLifecycle).not.toHaveBeenCalled();
  });

  it("rejects DEVELOPMENT because the production dynamic producer supports WALK_FORWARD only", async () => {
    const openLifecycle = vi.fn();
    const response = await handleHistoricalSimulationAdminLaunchPostV2(new Request(
      "https://waia.test/api?organization_id=org-a",
      { method: "POST", body: JSON.stringify({ ...body, partition: "DEVELOPMENT" }) }),
    { getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth, openLifecycle });
    expect(response.status).toBe(400);
    expect(openLifecycle).not.toHaveBeenCalled();
  });

  it("does not expose internal database or authority errors to the admin client", async () => {
    const response = await handleHistoricalSimulationAdminLaunchPostV2(new Request(
      "https://waia.test/api?organization_id=11111111-1111-4111-8111-111111111111",
      { method: "POST", body: JSON.stringify(body) },
    ), { getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth,
      openLifecycle: () => ({ lifecycle: {
        queue: vi.fn(async () => {
          throw new Error("postgresql://runner:secret@private-db.internal/waia");
        }), claim: vi.fn(), append: vi.fn(),
      }, dispose: vi.fn(async () => undefined) }) });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain("secret");
    expect(response.body).toMatchObject({ error: {
      code: "HISTORICAL_SIMULATION_LAUNCH_REFUSED",
      message: "Historical launch refused by the qualified runtime authority.",
    } });
  });
});
