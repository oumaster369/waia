import { describe, expect, it, vi } from "vitest";

import { bindHistoricalRunnerLoginGuardedPoolV2 } from
  "../../scripts/trader/historical-simulation-v2-launch-approved";

describe("Historical approved launch service", () => {
  it("guards every reserved finalize/bootstrap backend before exposing it", async () => {
    const reserved = Object.assign(vi.fn(), { release: vi.fn() });
    const reserve = vi.fn(async () => reserved);
    const pool = Object.assign(vi.fn(), { reserve }) as never;
    const requireLogin = vi.fn(async () => undefined);
    const guarded = bindHistoricalRunnerLoginGuardedPoolV2(pool, requireLogin);

    await expect(guarded.reserve()).resolves.toBe(reserved);
    await expect(guarded.reserve()).resolves.toBe(reserved);
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(requireLogin).toHaveBeenCalledTimes(2);
    expect(requireLogin).toHaveBeenNthCalledWith(1, reserved);
    expect(requireLogin.mock.invocationCallOrder[0]).toBeLessThan(
      reserve.mock.invocationCallOrder[1]!,
    );
  });

  it("releases and refuses a reserved backend when the dedicated LOGIN guard fails", async () => {
    const reserved = Object.assign(vi.fn(), { release: vi.fn() });
    const pool = Object.assign(vi.fn(), {
      reserve: vi.fn(async () => reserved),
    }) as never;
    const refusal = new Error("HISTORICAL_SIMULATION_LAUNCH_CONSUMER_REFUSED:DATABASE_LOGIN_ROLE");
    const guarded = bindHistoricalRunnerLoginGuardedPoolV2(pool, async () => { throw refusal; });

    await expect(guarded.reserve()).rejects.toBe(refusal);
    expect(reserved.release).toHaveBeenCalledOnce();
  });
});
