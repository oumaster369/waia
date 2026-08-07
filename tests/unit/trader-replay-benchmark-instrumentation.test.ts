import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aggregateBigIntMax,
  aggregateBigIntMedian,
  aggregateBigIntP95NearestRank,
  createReplayBenchmarkObserver,
  NOOP_REPLAY_BENCHMARK_OBSERVER,
  REPLAY_BENCHMARK_ALL_STAGES,
  REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION,
  REPLAY_BENCHMARK_PER_CYCLE_STAGES,
  REPLAY_BENCHMARK_PER_RUN_STAGES,
} from "@/lib/trader/backtest/replay-benchmark-instrumentation";

describe("replay benchmark instrumentation (HTR-WP03)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defines complete per-cycle and per-run stage lists", () => {
    expect(REPLAY_BENCHMARK_PER_CYCLE_STAGES).toEqual([
      "bar-source-next",
      "canvas-advance",
      "fused-context-build",
      "clock-advance",
      "wp17-historical-advance",
      "paper-cycle",
      "intelligence-bundle",
      "account-state-refresh",
      "evidence-on-cycle",
      "cycle-boundary",
    ]);
    expect(REPLAY_BENCHMARK_PER_RUN_STAGES).toEqual(["evidence-export"]);
    expect(REPLAY_BENCHMARK_ALL_STAGES).toHaveLength(11);
  });

  it("records positive stage durations and memory high-water with O(1) aggregates", () => {
    const { observer, collect } = createReplayBenchmarkObserver();

    for (const stage of REPLAY_BENCHMARK_ALL_STAGES) {
      const timer = observer.beginStage(stage, stage === "evidence-export" ? null : 0);
      timer.end();
      observer.sampleMemory(stage, stage === "evidence-export" ? null : 0);
    }

    const result = collect();
    expect(result.schemaVersion).toBe(REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION);
    expect(result.terminalState).toBe("BENCHMARK_OK");

    for (const stage of REPLAY_BENCHMARK_ALL_STAGES) {
      const aggregate = result.telemetry.perStage[stage];
      expect(aggregate.sampleCount).toBe(1);
      expect(BigInt(aggregate.totalNs)).toBeGreaterThan(0n);
      expect(BigInt(aggregate.maxNs)).toBeGreaterThan(0n);
    }

    expect(result.telemetry.memoryHighWater.rssBytes).toBeGreaterThan(0);
    expect(result.telemetry.memoryHighWater.heapUsedBytes).toBeGreaterThan(0);
  });

  it("returns BENCHMARK_FAILED when timing is unavailable", () => {
    const bigintSpy = vi.spyOn(process.hrtime, "bigint").mockImplementation(() => {
      throw new Error("timing unavailable");
    });

    const { observer, collect } = createReplayBenchmarkObserver();
    const timer = observer.beginStage("bar-source-next", 0);
    timer.end();

    expect(collect().terminalState).toBe("BENCHMARK_FAILED");
    bigintSpy.mockRestore();
  });

  it("uses a no-op observer that does not throw", () => {
    const timer = NOOP_REPLAY_BENCHMARK_OBSERVER.beginStage("paper-cycle", 1);
    expect(() => timer.end()).not.toThrow();
    expect(() => NOOP_REPLAY_BENCHMARK_OBSERVER.sampleMemory("paper-cycle", 1)).not.toThrow();
  });

  it("aggregates median, p95 nearest-rank, and max for bigint totals", () => {
    const values = [10n, 20n, 30n, 40n, 50n];
    expect(aggregateBigIntMedian(values)).toBe(30n);
    expect(aggregateBigIntP95NearestRank(values)).toBe(50n);
    expect(aggregateBigIntMax(values)).toBe(50n);
  });
});
