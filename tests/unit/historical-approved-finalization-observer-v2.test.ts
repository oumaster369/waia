import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), end: vi.fn(), finalize: vi.fn(), run: vi.fn() }));
vi.mock("postgres", () => ({ default: mocks.connect }));
vi.mock("@/lib/trader/historical-simulation-v2/ratification-split-v2", async original => ({
  ...await original<typeof import("@/lib/trader/historical-simulation-v2/ratification-split-v2")>(),
  finalizeApprovedHistoricalProposalOnExecutionServerV2: mocks.finalize,
}));
vi.mock("@/lib/trader/historical-simulation-v2/ratification-execution-cli-v2", () => ({
  runApprovedHistoricalLaunchCliV2: mocks.run,
}));
import { runHistoricalSimulationApprovedLaunchMainV2 } from
  "../../scripts/trader/historical-simulation-v2-launch-approved";

const scope = { organizationId: "11111111-1111-4111-8111-111111111111",
  runId: "synthetic-finalization-observer", releaseSha: "a".repeat(40) };

beforeEach(() => {
  vi.resetAllMocks(); mocks.end.mockResolvedValue(undefined);
  mocks.connect.mockReturnValue(Object.assign(vi.fn(), { end: mocks.end }));
  // No DB call, ratification, bootstrap or consumer: execute only the actual CLI callback.
  mocks.run.mockImplementation(async (_env, dependencies) =>
    dependencies.finalize("postgresql://synthetic@example.test/test", scope));
});
afterEach(() => vi.restoreAllMocks());

describe("approved launch forwards finalization diagnostics and shutdown", () => {
  it.each(["SIGTERM", "SIGINT"] as const)("forwards %s to finalization and cleans up without a success", async signal => {
    const before = process.listenerCount(signal);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const stopped = new Error("TECHNICAL_PREPARATION_CANCELLED");
    mocks.finalize.mockImplementation(async (_pool, actualScope, observer) => {
      expect(actualScope).toEqual(scope);
      expect(observer.signal.aborted).toBe(false);
      observer.onProgress({ ...scope, phase: "FINALIZATION_REPLAY", authorityGranted: false });
      // Invoke only the handler installed by this call, not unrelated process listeners.
      const handler = process.listeners(signal).at(-1)!; handler(signal);
      expect(observer.signal.aborted).toBe(true);
      throw stopped;
    });
    await expect(runHistoricalSimulationApprovedLaunchMainV2({ NODE_ENV: "test" })).rejects.toBe(stopped);
    expect(mocks.finalize).toHaveBeenCalledOnce(); expect(mocks.end).toHaveBeenCalledWith({ timeout: 5 });
    expect(out).not.toHaveBeenCalled(); expect(err).toHaveBeenCalledOnce();
    expect(process.listenerCount(signal)).toBe(before);
  });

  it("does not swallow diagnostic write failures or print completion", async () => {
    const failure = new Error("DIAGNOSTIC_WRITE_FAILED");
    vi.spyOn(process.stderr, "write").mockImplementation(() => { throw failure; });
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const before = process.listenerCount("SIGTERM");
    mocks.finalize.mockImplementation(async (_pool, _scope, observer) =>
      observer.onProgress({ ...scope, phase: "FINALIZATION_REPLAY", authorityGranted: false }));
    await expect(runHistoricalSimulationApprovedLaunchMainV2({ NODE_ENV: "test" })).rejects.toBe(failure);
    expect(mocks.end).toHaveBeenCalledOnce(); expect(out).not.toHaveBeenCalled();
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});
