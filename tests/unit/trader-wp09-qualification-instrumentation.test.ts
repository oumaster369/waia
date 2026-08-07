import { describe, expect, it } from "vitest";

import {
  computeP95NsFromHistogram,
  createReplayBenchmarkObserver,
  REPLAY_LATENCY_HISTOGRAM_BUCKET_COUNT,
  REPLAY_LATENCY_HISTOGRAM_BUCKET_WIDTH_NS,
  type ReplayBenchmarkRunResult,
} from "@/lib/trader/backtest/replay-benchmark-instrumentation";
import {
  assertCycleStatsSelfConsistent,
  extractPaperCycleStats,
} from "@/lib/trader/backtest/replay-qualification-harness";

/** Independent nearest-rank p95 over a non-negative observation vector (ms). */
function nearestRankP95Ms(samplesNs: readonly number[]): number {
  const sorted = [...samplesNs].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[index]! / 1_000_000;
}

function buildHistogram(samplesNs: readonly number[]): {
  histogram: Int32Array;
  overflow: number;
} {
  const histogram = new Int32Array(REPLAY_LATENCY_HISTOGRAM_BUCKET_COUNT);
  let overflow = 0;
  for (const ns of samplesNs) {
    const idx = Math.floor(ns / Number(REPLAY_LATENCY_HISTOGRAM_BUCKET_WIDTH_NS));
    if (idx >= 0 && idx < histogram.length) {
      histogram[idx] += 1;
    } else {
      overflow += 1;
    }
  }
  return { histogram, overflow };
}

describe("WP09 qualification instrumentation (HTR-WP09 post-fail correction)", () => {
  it("computes a real nearest-rank p95 from the bounded histogram", () => {
    // 100 samples: 95 fast (~300µs), 5 slow (~40ms). A real p95 is a fast value,
    // NOT the 40ms max — proving the prior max-as-p95 defect is corrected.
    const samplesNs: number[] = [];
    for (let i = 0; i < 95; i += 1) samplesNs.push(300_000 + i * 100);
    for (let i = 0; i < 5; i += 1) samplesNs.push(40_000_000);

    const { histogram, overflow } = buildHistogram(samplesNs);
    const p95Ns = computeP95NsFromHistogram(
      histogram,
      overflow,
      REPLAY_LATENCY_HISTOGRAM_BUCKET_WIDTH_NS,
    );
    const p95Ms = Number(p95Ns) / 1_000_000;

    // Bucket resolution is 10µs; the real p95 (~309µs) must be well under 1ms and
    // nowhere near the 40ms max.
    expect(p95Ms).toBeGreaterThan(0.29);
    expect(p95Ms).toBeLessThan(1);
    expect(p95Ms).toBeLessThan(nearestRankP95Ms(samplesNs) + 0.02);
    expect(p95Ms).not.toBeCloseTo(40, 0);
  });

  it("reports the cap (fail-closed) when the p95 rank lands in the overflow region", () => {
    // All samples above the 200ms histogram cap → overflow; p95 must report the cap.
    const samplesNs = new Array<number>(100).fill(500_000_000);
    const { histogram, overflow } = buildHistogram(samplesNs);
    expect(overflow).toBe(100);
    const p95Ns = computeP95NsFromHistogram(
      histogram,
      overflow,
      REPLAY_LATENCY_HISTOGRAM_BUCKET_WIDTH_NS,
    );
    const capNs =
      BigInt(REPLAY_LATENCY_HISTOGRAM_BUCKET_COUNT) * REPLAY_LATENCY_HISTOGRAM_BUCKET_WIDTH_NS;
    expect(p95Ns).toBe(capNs);
  });

  it("observer records per-cycle durations into the histogram and a memory baseline", () => {
    const { observer, collect } = createReplayBenchmarkObserver();
    for (let i = 0; i < 40; i += 1) {
      const timer = observer.beginStage("paper-cycle", i);
      observer.sampleMemory("paper-cycle", i);
      timer.end();
    }
    const result = collect();
    const stage = result.telemetry.perStage["paper-cycle"];
    expect(stage.sampleCount).toBe(40);
    expect(BigInt(stage.p95Ns)).toBeGreaterThanOrEqual(0n);
    expect(BigInt(stage.p95Ns)).toBeLessThanOrEqual(BigInt(stage.maxNs));
    expect(result.telemetry.memoryBaseline.rssBytes).toBeGreaterThan(0);
    expect(result.telemetry.memoryBaseline.heapUsedBytes).toBeGreaterThan(0);
  });

  it("extractPaperCycleStats derives p95 from p95Ns and memory as peak − baseline", () => {
    const benchmark: ReplayBenchmarkRunResult = {
      schemaVersion: "htr-wp03-benchmark/v1",
      terminalState: "BENCHMARK_OK",
      telemetry: {
        schemaVersion: "htr-wp03-benchmark/v1",
        perStage: {
          "bar-source-next": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
          "canvas-advance": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
          "canvas-serialize": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
          "fused-context-build": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
          "clock-advance": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
          "wp17-historical-advance": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
          "paper-cycle": {
            sampleCount: 100,
            // total = 100 × 300µs = 30ms → mean 0.3ms
            totalNs: "30000000",
            maxNs: "69012375",
            // real p95 = 500µs (dramatically below the 69ms max)
            p95Ns: "500000",
          },
          "intelligence-bundle": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
          "account-state-refresh": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
          "evidence-on-cycle": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
          "cycle-boundary": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
          "evidence-export": { sampleCount: 0, totalNs: "0", maxNs: "0", p95Ns: "0" },
        },
        memoryHighWater: { rssBytes: 1_500_000_000, heapUsedBytes: 1_400_000_000 },
        memoryBaseline: { rssBytes: 1_200_000_000, heapUsedBytes: 1_150_000_000 },
      },
    };

    const stats = extractPaperCycleStats(benchmark);
    expect(stats.meanPaperCycleMs).toBeCloseTo(0.3, 6);
    expect(stats.p95PaperCycleMs).toBeCloseTo(0.5, 6);
    expect(stats.maxPaperCycleMs).toBeCloseTo(69.012375, 6);
    // True delta, not absolute high-water.
    expect(stats.rssDeltaBytes).toBe(300_000_000);
    expect(stats.heapUsedDeltaBytes).toBe(250_000_000);
  });

  it("self-consistency guard accepts mean ≤ p95 ≤ max and rejects otherwise", () => {
    expect(() =>
      assertCycleStatsSelfConsistent({
        runLabel: "ok",
        cycleCount: 129581,
        meanPaperCycleMs: 0.3,
        p95PaperCycleMs: 0.5,
        maxPaperCycleMs: 69.0,
      }),
    ).not.toThrow();

    // The impossible sealed shape: a 69ms "p95" with a 0.3ms mean can only be a MAX.
    // Asserting it as a p95 with an equal max is allowed (p95==max), but a p95 that
    // exceeds max, or a mean above p95, must fail closed.
    expect(() =>
      assertCycleStatsSelfConsistent({
        runLabel: "p95-above-max",
        cycleCount: 129581,
        meanPaperCycleMs: 0.3,
        p95PaperCycleMs: 69.0,
        maxPaperCycleMs: 55.0,
      }),
    ).toThrow(/self-consistency/);

    expect(() =>
      assertCycleStatsSelfConsistent({
        runLabel: "mean-above-p95",
        cycleCount: 129581,
        meanPaperCycleMs: 1.0,
        p95PaperCycleMs: 0.5,
        maxPaperCycleMs: 69.0,
      }),
    ).toThrow(/self-consistency/);

    expect(() =>
      assertCycleStatsSelfConsistent({
        runLabel: "empty",
        cycleCount: 0,
        meanPaperCycleMs: 0,
        p95PaperCycleMs: 0,
        maxPaperCycleMs: 0,
      }),
    ).toThrow(/self-consistency/);
  });
});
