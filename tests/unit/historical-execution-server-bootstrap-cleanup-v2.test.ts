import type postgres from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), assume: vi.fn(), reset: vi.fn(), queue: vi.fn(),
}));
vi.mock("@/lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2", () => ({
  INTERNAL_prepareHistoricalProductionFirstCycleOnExecutionServerV2: mocks.prepare,
}));
vi.mock("@/lib/trader/historical-simulation-v2/historical-runner-role-v2", () => ({
  assumeHistoricalSimulationRunnerRoleV2: mocks.assume,
  resetHistoricalSimulationRunnerRoleV2: mocks.reset,
}));
vi.mock("@/lib/trader/historical-simulation-v2/run-lifecycle-postgres-v2", () => ({
  createHistoricalSimulationRunLifecyclePostgresV2: () => ({ queue: mocks.queue }),
}));

import { bootstrapAndQueueHistoricalSimulationOnExecutionServerV2 } from
  "@/lib/trader/historical-simulation-v2/execution-server-bootstrap-v2";

describe("Execution bootstrap queue cleanup on the actual composition", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prepare.mockResolvedValue({ bootstrap: {
      organizationId: "org-a", accountId: "account-a", runId: "run-a",
      partition: "WALK_FORWARD", symbol: "BTCUSDT",
    }, ratifiedOperatorUserId: "operator-a" });
    mocks.assume.mockResolvedValue(undefined);
    mocks.reset.mockResolvedValue(undefined);
  });

  it("preserves queue failure when RESET ROLE and session release both fail", async () => {
    const primary = new Error("QUEUE_PRIMARY");
    const resetError = new Error("RESET_FAILURE");
    const releaseError = new Error("RELEASE_FAILURE");
    mocks.queue.mockRejectedValue(primary);
    mocks.reset.mockRejectedValue(resetError);
    const release = vi.fn(() => { throw releaseError; });
    const reserved = { release };
    const pool = { reserve: vi.fn(async () => reserved) } as unknown as postgres.Sql;
    const failure = await bootstrapAndQueueHistoricalSimulationOnExecutionServerV2(
      pool, {} as never,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).cause).toBe(primary);
    expect((failure as AggregateError).errors).toEqual([primary, resetError, releaseError]);
    expect(mocks.reset).toHaveBeenCalledWith(reserved);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not queue or reset an unassumed role, but always releases the reserved session", async () => {
    const primary = new Error("ROLE_REFUSED");
    mocks.assume.mockRejectedValue(primary);
    const release = vi.fn();
    const pool = { reserve: vi.fn(async () => ({ release })) } as unknown as postgres.Sql;
    await expect(bootstrapAndQueueHistoricalSimulationOnExecutionServerV2(pool, {} as never))
      .rejects.toBe(primary);
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
