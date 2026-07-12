import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_BATCH_CYCLES } from "@/lib/trader/backtest/streaming-evidence";
import { createStreamingEvidenceWriter } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-writer";
import {
  HTR_WP03_BENCHMARK_EXPECTED_CYCLES,
  runReplayBenchmarkOnce,
  loadApprovedBenchmarkFixture,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import { runFixtureBacktestWithRetention } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness";

function minimalCycle(cycleIndex: number): never {
  const evaluatedAt = new Date(1_760_000_000_000 + cycleIndex * 60_000).toISOString();
  return {
    evaluation: {
      features: { evaluatedAt, featureSetId: "bound", values: {} },
      msv: {
        instrumentId: "BTC/USDT",
        evaluatedAt,
        derived: {
          regime: "RANGE",
          tradingPermission: "ALLOW_TRADING",
          riskMultiplier: "1",
          reasonCodes: [],
          allowedStrategyIds: [],
          dataQualityScore: 1,
          conviction: 0,
          opportunityAuthorized: false,
          activeHypothesisType: null,
          eligibleStrategyFamilies: [],
        },
        crowd: { newsSentiment: null, fearGreedIndex: null },
      },
      signal: {
        strategyId: "mean_reversion_v0",
        strategySignalId: `sig-${cycleIndex}`,
        strategyVersion: "0.1.0",
        organizationId: "org",
        symbol: "BTC/USDT",
        outcome: "no_trade",
        side: undefined,
        confidence: "0.5",
        evaluatedAt,
      },
      signals: [],
    },
    strategyExecutions: [],
    submitBlocked: false,
    execution: null,
    reconciliation: null,
  } as never;
}

describe("streaming evidence retention (HTR-WP04)", () => {
  it("keeps FULL mode cycle results unchanged", async () => {
    const fixture = loadApprovedBenchmarkFixture();
    const full = await runReplayBenchmarkOnce({
      bars: fixture.bars,
      includeInstrumentation: false,
    });
    expect(full.backtest.cycleResults.length).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
  }, 120_000);

  it("returns empty cycleResults in STREAM_ONLY with bounded projection buffer", async () => {
    const stream = await runFixtureBacktestWithRetention({ retentionMode: "STREAM_ONLY" });
    expect(stream.cycleResultsLength).toBe(0);
    expect(stream.cycleCount).toBe(HTR_WP03_BENCHMARK_EXPECTED_CYCLES);
    expect(stream.peakBufferedProjections).toBeLessThanOrEqual(MAX_BATCH_CYCLES);
    expect(stream.streamingManifestRef?.manifest.chunkCount).toBeGreaterThan(0);
  }, 120_000);

  it("holds the projection buffer at a fixed high-water across cycle counts", () => {
    // Two runs with different N (both > MAX_BATCH_CYCLES) must peak at the SAME fixed bound,
    // proving buffered-projection memory is O(1) in cycle count, not O(N).
    const peaks: Array<{ n: number; peak: number }> = [];
    for (const n of [MAX_BATCH_CYCLES + 8, MAX_BATCH_CYCLES * 3 + 4]) {
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), `waia-wp04-bound-${n}-`));
      const writer = createStreamingEvidenceWriter({ runDir, runId: `bound-${n}` });
      for (let i = 0; i < n; i += 1) {
        writer.onCycle(i, minimalCycle(i));
      }
      writer.sealComplete(n);
      peaks.push({ n, peak: writer.peakBufferedProjections() });
    }
    expect(peaks[0]!.peak).toBe(MAX_BATCH_CYCLES);
    expect(peaks[1]!.peak).toBe(MAX_BATCH_CYCLES);
    expect(peaks[0]!.peak).toBe(peaks[1]!.peak);
  });
});
