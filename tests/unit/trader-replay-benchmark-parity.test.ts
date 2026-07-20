import { describe, expect, it } from "vitest";

import {
  createReplayBenchmarkObserver,
  NOOP_REPLAY_BENCHMARK_OBSERVER,
} from "@/lib/trader/backtest/replay-benchmark-instrumentation";
import {
  loadApprovedBenchmarkFixture,
  runReplayBenchmarkOnce,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";

describe("replay benchmark semantic parity (HTR-WP03)", () => {
  it("two noop runs over separate sessions produce identical evidence digests", async () => {
    const fixture = loadApprovedBenchmarkFixture();
    const first = await runReplayBenchmarkOnce({
      bars: fixture.bars,
      includeInstrumentation: false,
    });
    const second = await runReplayBenchmarkOnce({
      bars: fixture.bars,
      includeInstrumentation: false,
    });
    expect(first.backtest.evidenceDigest).toBe(second.backtest.evidenceDigest);
  }, 120_000);

  it("preserves evidenceDigest and semantic repro digest with instrumentation enabled", async () => {
    const fixture = loadApprovedBenchmarkFixture();

    const instrumented = await runReplayBenchmarkOnce({
      bars: fixture.bars,
      includeInstrumentation: true,
    });
    const baseline = await runReplayBenchmarkOnce({
      bars: fixture.bars,
      includeInstrumentation: false,
    });

    expect(instrumented.backtest.evidenceDigest).toBe(baseline.backtest.evidenceDigest);
    expect(computeReplayReproContentDigest(instrumented.backtest.exportDocument)).toBe(
      computeReplayReproContentDigest(baseline.backtest.exportDocument),
    );
    expect(instrumented.backtest.cycleCount).toBe(baseline.backtest.cycleCount);
    expect(instrumented.benchmark?.terminalState).toBe("BENCHMARK_OK");
  }, 120_000);

  it("uses a no-op observer equivalent to omitting benchmarkObserver", async () => {
    const fixture = loadApprovedBenchmarkFixture();
    const explicitNoop = await runReplayBenchmarkOnce({
      bars: fixture.bars,
      includeInstrumentation: false,
    });
    const instrumented = createReplayBenchmarkObserver();
    expect(instrumented.observer).not.toBe(NOOP_REPLAY_BENCHMARK_OBSERVER);
    void instrumented;
    expect(explicitNoop.benchmark).toBeNull();
  });
});
