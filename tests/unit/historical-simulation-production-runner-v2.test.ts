import { beforeEach, describe, expect, it, vi } from "vitest";
const { next } = vi.hoisted(() => ({ next: vi.fn() }));
vi.mock("@/lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2", () => ({
  runHistoricalSimulationNextCyclePostgresV2: next,
}));
import { runHistoricalSimulationProductionLoopV2 } from
  "@/lib/trader/historical-simulation-v2/production-runner-v2";
const config = { sql: Object.assign(() => undefined, { reserve: () => undefined }) as never,
  organizationId: "org", accountId: "acct", runId: "run", partition: "DEVELOPMENT" as const,
  symbol: "BTCUSDT" as const, terminalCycleSequenceExclusive: 2 };
describe("Historical Simulation V2 production runner", () => {
  beforeEach(() => { next.mockReset(); });
  it("rejects an unsafe runtime scope before touching the cycle entry", async () => {
    await expect(runHistoricalSimulationProductionLoopV2({ ...config, partition: "BLIND_HOLDOUT" as never }))
      .rejects.toThrow("RUNNER_REFUSED:CONFIG");
    expect(next).not.toHaveBeenCalled();
  });
  it("commits sequentially and terminates only at the explicit exclusive boundary", async () => {
    next.mockResolvedValueOnce({ committedCycleId: "c0", nextCycleSequence: 1 })
      .mockResolvedValueOnce({ committedCycleId: "c1", nextCycleSequence: 2 });
    await expect(runHistoricalSimulationProductionLoopV2(config)).resolves.toEqual({
      status: "TERMINAL", committedCycles: 2, nextCycleSequence: 2 });
    expect(next.mock.calls.map(([value]) => value.expectedCycleSequence)).toEqual([0, 1]);
  });
  it("retries the identical sequence for a bounded transient failure", async () => {
    next.mockRejectedValueOnce(Object.assign(new Error("restart"), { code: "08006" }))
      .mockResolvedValueOnce({ committedCycleId: "c0", nextCycleSequence: 1 });
    const controller = new AbortController(); const progress: string[] = [];
    const result = await runHistoricalSimulationProductionLoopV2({ ...config, terminalCycleSequenceExclusive: 3 }, { signal: controller.signal,
      wait: async () => undefined, onProgress: (value) => { progress.push(value.event);
        if (value.event === "CYCLE_COMMITTED") controller.abort(); } });
    expect(result).toEqual({ status: "STOPPED", committedCycles: 1, nextCycleSequence: 1 });
    expect(next.mock.calls.map(([value]) => value.expectedCycleSequence)).toEqual([0, 0]);
    expect(progress).toContain("TRANSIENT_RETRY");
  });
  it("does not misclassify missing or ambiguous provisioning as terminal", async () => {
    next.mockRejectedValueOnce(new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:EXACT_CYCLE_NOT_FOUND"));
    await expect(runHistoricalSimulationProductionLoopV2({ ...config, terminalCycleSequenceExclusive: 3 }))
      .rejects.toThrow("EXACT_CYCLE_NOT_FOUND");
    expect(next).toHaveBeenCalledTimes(1);
  });
  it.each([0, 2, 3])("rejects a same, skipped, or over-terminal cursor (%s)", async (nextSequence) => {
    next.mockResolvedValueOnce({ committedCycleId: "c0", nextCycleSequence: nextSequence });
    await expect(runHistoricalSimulationProductionLoopV2(config)).rejects.toThrow("CURSOR_SEQUENCE");
  });
  it("stops before the first cycle when already aborted", async () => {
    const controller = new AbortController(); controller.abort(); const progress: string[] = [];
    await expect(runHistoricalSimulationProductionLoopV2({ ...config, terminalCycleSequenceExclusive: 3 }, { signal: controller.signal,
      onProgress: (value) => progress.push(value.event) })).resolves.toEqual({
      status: "STOPPED", committedCycles: 0, nextCycleSequence: 0,
    });
    expect(next).not.toHaveBeenCalled();
    expect(progress).toEqual(["START", "STOPPED"]);
  });
  it("does not begin another cycle when stopped between committed cycles", async () => {
    next.mockResolvedValueOnce({ committedCycleId: "c0", nextCycleSequence: 1 });
    const controller = new AbortController();
    await expect(runHistoricalSimulationProductionLoopV2({ ...config, terminalCycleSequenceExclusive: 3 }, { signal: controller.signal,
      onProgress: (value) => { if (value.event === "CYCLE_COMMITTED") controller.abort(); } }))
      .resolves.toEqual({ status: "STOPPED", committedCycles: 1, nextCycleSequence: 1 });
    expect(next.mock.calls.map(([value]) => value.expectedCycleSequence)).toEqual([0]);
  });
  it("does not retry after aborting during transient backoff", async () => {
    next.mockRejectedValueOnce(Object.assign(new Error("restart"), { code: "40001" }));
    const controller = new AbortController();
    await expect(runHistoricalSimulationProductionLoopV2({ ...config, terminalCycleSequenceExclusive: 3 }, { signal: controller.signal,
      wait: async () => { controller.abort(); } })).resolves.toEqual({
      status: "STOPPED", committedCycles: 0, nextCycleSequence: 0,
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
