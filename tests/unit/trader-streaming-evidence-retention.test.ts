import { describe, expect, it } from "vitest";

import { MAX_BATCH_CYCLES } from "@/lib/trader/backtest/streaming-evidence";
import {
  HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
  runReplayBenchmarkOnce,
  loadApprovedBenchmarkFixture,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import { runFixtureBacktestWithRetention } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness";

describe("streaming evidence retention (HTR-WP04)", () => {
  it("keeps FULL mode cycle results unchanged", async () => {
    const fixture = loadApprovedBenchmarkFixture();
    const full = await runReplayBenchmarkOnce({
      bars: fixture.bars,
      includeInstrumentation: false,
    });
    expect(full.backtest.cycleResults.length).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
  }, 120_000);

  it("returns empty cycleResults in STREAM_ONLY with bounded peak retention", async () => {
    const stream = await runFixtureBacktestWithRetention({ retentionMode: "STREAM_ONLY" });
    expect(stream.cycleResultsLength).toBe(0);
    expect(stream.cycleCount).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
    expect(stream.peakRetainedCycles).toBeLessThanOrEqual(MAX_BATCH_CYCLES);
    expect(stream.streamingManifestRef?.manifest.chunkCount).toBeGreaterThan(0);
  }, 120_000);
});
