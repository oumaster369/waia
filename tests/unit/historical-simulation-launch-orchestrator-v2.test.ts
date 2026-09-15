import { beforeEach, describe, expect, it, vi } from "vitest";

const { runner } = vi.hoisted(() => ({ runner: vi.fn() }));
vi.mock("@/lib/trader/historical-simulation-v2/production-runner-v2", () => ({
  runHistoricalSimulationProductionLoopV2: runner,
}));

import {
  executeQueuedHistoricalSimulationLaunchV2,
  queueAuthenticatedHistoricalSimulationLaunchV2,
  type HistoricalSimulationRunLifecyclePortV2,
} from "@/lib/trader/historical-simulation-v2/launch-orchestrator-v2";
import {
  buildHistoricalSimulationRunLifecycleEventV2,
  type HistoricalSimulationRunLifecycleEventV2,
} from "@/lib/trader/historical-simulation-v2/run-lifecycle-v2";

const identity = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  accountId: "historical-account",
  runId: "historical-main-run",
  partition: "WALK_FORWARD" as const,
  symbol: "BTCUSDT" as const,
};
const releaseSha = "a".repeat(40);

function event(overrides: Partial<HistoricalSimulationRunLifecycleEventV2> = {}) {
  return buildHistoricalSimulationRunLifecycleEventV2({
    ...identity,
    eventSequence: 0,
    phase: "QUEUED",
    initialRecordIndex: 240,
    terminalRecordIndexExclusive: 243,
    qualifiedTotalCycles: 3,
    committedCycles: 0,
    nextCycleSequence: 0,
    latestCommittedCycleId: null,
    requestedByOperatorId: "operator-a",
    observedAt: "2026-09-03T09:00:00.000Z",
    errorCode: null,
    previousContentDigestHex: null,
    ...overrides,
  } as never);
}

function lifecycle() {
  let current = event();
  const port: HistoricalSimulationRunLifecyclePortV2 = {
    queue: vi.fn(async () => current),
    claim: vi.fn(async (input) => {
      if (input.releaseSha !== releaseSha) {
        throw new Error("HISTORICAL_SIMULATION_LAUNCH_REFUSED:RELEASE_AUTHORITY");
      }
      current = event({ eventSequence: current.eventSequence + 1, phase: "RUNNING",
        previousContentDigestHex: current.contentDigestHex });
      return current;
    }),
    append: vi.fn(async (input) => {
      current = event({
        eventSequence: input.previous.eventSequence + 1,
        phase: input.phase,
        committedCycles: input.committedCycles,
        nextCycleSequence: input.committedCycles,
        latestCommittedCycleId: input.latestCommittedCycleId,
        errorCode: input.errorCode,
        previousContentDigestHex: input.previous.contentDigestHex,
      });
      return current;
    }),
  };
  return port;
}

describe("Historical Simulation V2 authenticated launch orchestration", () => {
  beforeEach(() => runner.mockReset());

  it("queues identity only under the authenticated operator boundary", async () => {
    const port = lifecycle();
    await queueAuthenticatedHistoricalSimulationLaunchV2({
      ...identity, authenticatedOperatorId: "operator-a",
    }, port);
    expect(port.queue).toHaveBeenCalledWith({ ...identity, requestedByOperatorId: "operator-a" });
    await expect(queueAuthenticatedHistoricalSimulationLaunchV2({
      ...identity, authenticatedOperatorId: "",
    }, port)).rejects.toThrow("AUTHENTICATED_OPERATOR");
    expect(port.queue).toHaveBeenCalledTimes(1);
  });

  it("uses only durable qualified bounds and persists every committed-cycle progress", async () => {
    const port = lifecycle();
    const onClaimed = vi.fn();
    runner.mockImplementationOnce(async (config, control) => {
      expect(onClaimed).toHaveBeenCalledOnce();
      expect(config).toMatchObject({ ...identity,
        initialCycleSequence: 0, terminalCycleSequenceExclusive: 3 });
      await control.onProgress({ event: "CYCLE_COMMITTED", expectedCycleSequence: 0,
        attempt: 0, committedCycleId: "cycle-0" });
      await control.onProgress({ event: "CYCLE_COMMITTED", expectedCycleSequence: 1,
        attempt: 0, committedCycleId: "cycle-1" });
      await control.onProgress({ event: "CYCLE_COMMITTED", expectedCycleSequence: 2,
        attempt: 0, committedCycleId: "cycle-2" });
      return { status: "TERMINAL", committedCycles: 3, nextCycleSequence: 3 };
    });
    const result = await executeQueuedHistoricalSimulationLaunchV2({
      sql: vi.fn() as never, organizationId: identity.organizationId, runId: identity.runId,
      releaseSha,
      lifecycle: port,
      onClaimed,
    });
    expect(result).toMatchObject({ phase: "COMPLETED", committedCycles: 3,
      qualifiedTotalCycles: 3, latestCommittedCycleId: "cycle-2" });
    expect(vi.mocked(port.append).mock.calls.map(([value]) =>
      [value.phase, value.committedCycles])).toEqual([
      ["RUNNING", 1], ["RUNNING", 2], ["COMPLETED", 3],
    ]);
    expect(vi.mocked(port.claim).mock.invocationCallOrder[0]).toBeLessThan(
      onClaimed.mock.invocationCallOrder[0]!,
    );
    expect(onClaimed.mock.invocationCallOrder[0]).toBeLessThan(
      runner.mock.invocationCallOrder[0]!,
    );
  });

  it("durably records bounded retry, stop, and failure without claiming completion", async () => {
    const retryPort = lifecycle();
    runner.mockImplementationOnce(async (_config, control) => {
      await control.onProgress({ event: "TRANSIENT_RETRY", expectedCycleSequence: 0,
        attempt: 1, committedCycleId: null });
      return { status: "STOPPED", committedCycles: 0, nextCycleSequence: 0 };
    });
    const stopped = await executeQueuedHistoricalSimulationLaunchV2({
      sql: vi.fn() as never, organizationId: identity.organizationId, runId: identity.runId,
      releaseSha,
      lifecycle: retryPort,
    });
    expect(stopped.phase).toBe("STOPPED");
    expect(vi.mocked(retryPort.append).mock.calls[0]![0].errorCode).toBe("TRANSIENT_RETRY_1");

    const failedPort = lifecycle();
    runner.mockRejectedValueOnce(Object.assign(new Error("database unavailable"), { code: "08006" }));
    await expect(executeQueuedHistoricalSimulationLaunchV2({
      sql: vi.fn() as never, organizationId: identity.organizationId, runId: identity.runId,
      releaseSha,
      lifecycle: failedPort,
    })).rejects.toThrow("database unavailable");
    expect(vi.mocked(failedPort.append).mock.calls.at(-1)?.[0]).toMatchObject({
      phase: "FAILED", committedCycles: 0, errorCode: "08006",
    });
  });

  it("persists the mandatory checkpoint pause after the first committed cycle", async () => {
    const port = lifecycle();
    runner.mockImplementationOnce(async (_config, control) => {
      await control.onProgress({ event: "CYCLE_COMMITTED", expectedCycleSequence: 0,
        attempt: 0, committedCycleId: "cycle-0" });
      return { status: "STOPPED", committedCycles: 1, nextCycleSequence: 1 };
    });
    const paused = await executeQueuedHistoricalSimulationLaunchV2({
      sql: vi.fn() as never, organizationId: identity.organizationId,
      runId: identity.runId, releaseSha, lifecycle: port });
    expect(paused).toMatchObject({ phase: "STOPPED", committedCycles: 1,
      nextCycleSequence: 1, errorCode: "PAUSE_AT_CHECKPOINT" });
    expect(vi.mocked(port.append).mock.calls.map(([call]) =>
      [call.phase, call.committedCycles, call.errorCode])).toEqual([
      ["RUNNING", 1, null], ["STOPPED", 1, "PAUSE_AT_CHECKPOINT"],
    ]);
  });

  it("recovers the H5 pause if its first lifecycle publication fails", async () => {
    const port = lifecycle();
    const running = event({ eventSequence: 1, phase: "RUNNING", committedCycles: 1,
      nextCycleSequence: 1, latestCommittedCycleId: "cycle-0",
      previousContentDigestHex: event().contentDigestHex });
    const paused = event({ eventSequence: 2, phase: "STOPPED", committedCycles: 1,
      nextCycleSequence: 1, latestCommittedCycleId: "cycle-0", errorCode: "PAUSE_AT_CHECKPOINT",
      previousContentDigestHex: running.contentDigestHex });
    vi.mocked(port.append).mockResolvedValueOnce(running)
      .mockRejectedValueOnce(Object.assign(new Error("serialization"), { code: "40001" }))
      .mockResolvedValueOnce(paused);
    runner.mockImplementationOnce(async (_config, control) => {
      await control.onProgress({ event: "CYCLE_COMMITTED", expectedCycleSequence: 0,
        attempt: 0, committedCycleId: "cycle-0" });
      await control.onProgress({ event: "STOPPED", expectedCycleSequence: 1,
        attempt: 0, committedCycleId: null });
    });
    await expect(executeQueuedHistoricalSimulationLaunchV2({ sql: vi.fn() as never,
      organizationId: identity.organizationId, runId: identity.runId, releaseSha, lifecycle: port,
    })).resolves.toEqual(paused);
    expect(port.append).toHaveBeenCalledTimes(3);
  });

  it("does not create a second H5 generation when an authorized resume stops after retry", async () => {
    const port = lifecycle();
    vi.mocked(port.claim).mockResolvedValueOnce(event({ eventSequence: 4, phase: "RUNNING",
      committedCycles: 1, nextCycleSequence: 1, latestCommittedCycleId: "cycle-0",
      errorCode: "RESUME_FROM_CHECKPOINT", previousContentDigestHex: "a".repeat(64) }));
    runner.mockImplementationOnce(async (_config, control) => {
      await control.onProgress({ event: "TRANSIENT_RETRY", expectedCycleSequence: 1,
        attempt: 1, committedCycleId: null });
      return { status: "STOPPED", committedCycles: 0, nextCycleSequence: 1 };
    });
    const stopped = await executeQueuedHistoricalSimulationLaunchV2({ sql: vi.fn() as never,
      organizationId: identity.organizationId, runId: identity.runId, releaseSha, lifecycle: port });
    expect(stopped).toMatchObject({ phase: "STOPPED", committedCycles: 1, errorCode: null });
    expect(vi.mocked(port.append).mock.calls.map(([call]) => call.errorCode)).toEqual([
      "RESUME_FROM_CHECKPOINT", null,
    ]);
  });

  it("returns a recovered durable H5 pause without starting another cycle", async () => {
    const port = lifecycle();
    vi.mocked(port.claim).mockResolvedValueOnce(event({ eventSequence: 3, phase: "STOPPED",
      committedCycles: 1, nextCycleSequence: 1, latestCommittedCycleId: "cycle-0",
      errorCode: "PAUSE_AT_CHECKPOINT", previousContentDigestHex: "a".repeat(64) }));
    const paused = await executeQueuedHistoricalSimulationLaunchV2({
      sql: vi.fn() as never, organizationId: identity.organizationId,
      runId: identity.runId, releaseSha, lifecycle: port });
    expect(paused).toMatchObject({ phase: "STOPPED", committedCycles: 1 });
    expect(runner).not.toHaveBeenCalled();
  });

  it("preserves recoverable RUNNING when publication repeatedly fails after an atomic commit", async () => {
    const port = lifecycle();
    vi.mocked(port.append).mockRejectedValue(Object.assign(new Error("serialization"), { code: "40001" }));
    runner.mockImplementationOnce(async (_config, control) => {
      await control.onProgress({ event: "CYCLE_COMMITTED", expectedCycleSequence: 0,
        attempt: 0, committedCycleId: "cycle-0" });
    });
    await expect(executeQueuedHistoricalSimulationLaunchV2({
      sql: vi.fn() as never, organizationId: identity.organizationId,
      runId: identity.runId, releaseSha, lifecycle: port,
    })).rejects.toThrow("serialization");
    expect(vi.mocked(port.append).mock.calls.map(([call]) =>
      [call.phase, call.committedCycles])).toEqual([["RUNNING", 1]]);
  });

  it("retries unpublished committed progress without writing an older retry event", async () => {
    const port = lifecycle();
    vi.mocked(port.append).mockRejectedValueOnce(Object.assign(new Error("serialization"), { code: "40001" }));
    runner.mockImplementationOnce(async (_config, control) => {
      await expect(control.onProgress({ event: "CYCLE_COMMITTED", expectedCycleSequence: 0,
        attempt: 0, committedCycleId: "cycle-0" })).rejects.toThrow("serialization");
      await control.onProgress({ event: "TRANSIENT_RETRY", expectedCycleSequence: 0,
        attempt: 1, committedCycleId: null });
      await control.onProgress({ event: "CYCLE_COMMITTED", expectedCycleSequence: 0,
        attempt: 1, committedCycleId: "cycle-0" });
      return { status: "STOPPED", committedCycles: 1, nextCycleSequence: 1 };
    });
    const result = await executeQueuedHistoricalSimulationLaunchV2({
      sql: vi.fn() as never, organizationId: identity.organizationId,
      runId: identity.runId, releaseSha, lifecycle: port,
    });
    expect(result).toMatchObject({ phase: "STOPPED", committedCycles: 1 });
    expect(vi.mocked(port.append).mock.calls.map(([call]) =>
      [call.phase, call.committedCycles])).toEqual([["RUNNING", 1], ["RUNNING", 1], ["STOPPED", 1]]);
  });

  it("does not publish stale STOPPED or FAILED after abort with an unpublished commit", async () => {
    const port = lifecycle();
    vi.mocked(port.append).mockRejectedValueOnce(Object.assign(new Error("serialization"), { code: "40001" }));
    runner.mockImplementationOnce(async (_config, control) => {
      await expect(control.onProgress({ event: "CYCLE_COMMITTED", expectedCycleSequence: 0,
        attempt: 0, committedCycleId: "cycle-0" })).rejects.toThrow("serialization");
      return { status: "STOPPED", committedCycles: 0, nextCycleSequence: 0 };
    });
    await expect(executeQueuedHistoricalSimulationLaunchV2({
      sql: vi.fn() as never, organizationId: identity.organizationId,
      runId: identity.runId, releaseSha, lifecycle: port,
    })).rejects.toThrow("COMMITTED_PROGRESS_NOT_PUBLISHED");
    expect(vi.mocked(port.append).mock.calls.map(([call]) =>
      [call.phase, call.committedCycles])).toEqual([["RUNNING", 1]]);
  });

  it("refuses execution when the deployed release is not the ratified run release", async () => {
    const port = lifecycle();
    const onClaimed = vi.fn();
    await expect(executeQueuedHistoricalSimulationLaunchV2({
      sql: vi.fn() as never,
      organizationId: identity.organizationId,
      runId: identity.runId,
      releaseSha: "b".repeat(40),
      lifecycle: port,
      onClaimed,
    })).rejects.toThrow("RELEASE_AUTHORITY");
    expect(onClaimed).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
    expect(port.append).not.toHaveBeenCalled();
  });

  it("keeps DEVELOPMENT, blind holdout and caller-supplied totals unrepresentable", async () => {
    const port = lifecycle();
    await expect(queueAuthenticatedHistoricalSimulationLaunchV2({
      ...identity, partition: "DEVELOPMENT", authenticatedOperatorId: "operator-a",
    } as never, port)).rejects.toThrow("LAUNCH_REFUSED:IDENTITY");
    await expect(queueAuthenticatedHistoricalSimulationLaunchV2({
      ...identity, partition: "BLIND_HOLDOUT" as never, authenticatedOperatorId: "operator-a",
      qualifiedTotalCycles: 999_999,
    } as never, port)).rejects.toThrow("LAUNCH_REFUSED:IDENTITY");
    expect(port.queue).not.toHaveBeenCalled();
  });
});
