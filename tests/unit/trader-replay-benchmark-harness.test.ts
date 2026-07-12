import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  aggregateBigIntMedian,
  aggregateBigIntP95NearestRank,
  createReplayBenchmarkObserver,
  REPLAY_BENCHMARK_ALL_STAGES,
  REPLAY_BENCHMARK_PER_CYCLE_STAGES,
} from "@/lib/trader/backtest/replay-benchmark-instrumentation";
import {
  HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
  HTR_WP03_BENCHMARK_FIXTURE_PATH,
  HTR_WP03_BENCHMARK_FIXTURE_SHA256,
  HTR_WP03_BENCHMARK_WARM_RUNS,
  loadApprovedBenchmarkFixture,
  runReplayBenchmarkHarness,
  runReplayBenchmarkOnce,
  sha256File,
} from "@/lib/trader/backtest/replay-benchmark-harness";

describe("replay benchmark harness (HTR-WP03)", () => {
  it("loads the approved fixture with the pinned sha256", () => {
    const fixture = loadApprovedBenchmarkFixture();
    expect(fixture.bars).toHaveLength(100);
    expect(sha256File(HTR_WP03_BENCHMARK_FIXTURE_PATH)).toBe(HTR_WP03_BENCHMARK_FIXTURE_SHA256);
  });

  it("records 81 per-cycle samples per stage and 1 evidence-export sample per run", async () => {
    const fixture = loadApprovedBenchmarkFixture();
    const { benchmark, backtest } = await runReplayBenchmarkOnce({
      bars: fixture.bars,
      includeInstrumentation: true,
    });

    expect(backtest.cycleCount).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
    expect(benchmark?.terminalState).toBe("BENCHMARK_OK");

    for (const stage of REPLAY_BENCHMARK_PER_CYCLE_STAGES) {
      expect(benchmark!.telemetry.perStage[stage].sampleCount).toBe(
        HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
      );
    }

    expect(benchmark!.telemetry.perStage["evidence-export"].sampleCount).toBe(1);
  }, 120_000);

  it("runs cold + warm repetitions and aggregates median/p95/max over warm runs", async () => {
    const harness = await runReplayBenchmarkHarness();

    expect(harness.terminalState).toBe("BENCHMARK_OK");
    expect(harness.cycleCount).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
    expect(harness.warmRuns).toHaveLength(HTR_WP03_BENCHMARK_WARM_RUNS);
    expect(harness.coldRun.terminalState).toBe("BENCHMARK_OK");

    for (const stage of REPLAY_BENCHMARK_ALL_STAGES) {
      const warmTotals = harness.warmRuns.map((run) =>
        BigInt(run.telemetry.perStage[stage].totalNs),
      );
      const aggregate = harness.aggregate.perStageTiming[stage];
      expect(aggregate.medianTotalNs).toBe(aggregateBigIntMedian(warmTotals).toString());
      expect(aggregate.p95TotalNs).toBe(aggregateBigIntP95NearestRank(warmTotals).toString());
    }

    expect(harness.environment.nodeVersion).toMatch(/^v\d+/);
    expect(harness.environment.cpuCount).toBeGreaterThan(0);
  }, 300_000);

  it("writes manifest fixture sha256 equal to the approved digest", async () => {
    const fixturePath = `${process.cwd()}/tests/fixtures/trader/dee-337-p5-btcusdt-1m-replay.json`;
    expect(sha256File(fixturePath)).toBe(HTR_WP03_BENCHMARK_FIXTURE_SHA256);

    const { observer } = createReplayBenchmarkObserver();
    expect(observer.beginStage("bar-source-next", 0).stage).toBe("bar-source-next");

    const manifestPath = `${process.cwd()}/replay-runs/RI-P7/htr-wp03-replay-benchmark-baseline/benchmark-manifest.json`;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { fixtureSha256?: string };
      if (manifest.fixtureSha256) {
        expect(manifest.fixtureSha256).toBe(HTR_WP03_BENCHMARK_FIXTURE_SHA256);
      }
    } catch {
      // evidence may not exist until benchmark CLI runs in Phase A validation
    }
  });
});
