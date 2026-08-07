export type ReplayBenchmarkStageId =
  | "bar-source-next"
  | "canvas-advance"
  | "canvas-serialize"
  | "fused-context-build"
  | "clock-advance"
  | "wp17-historical-advance"
  | "paper-cycle"
  | "intelligence-bundle"
  | "account-state-refresh"
  | "evidence-on-cycle"
  | "cycle-boundary"
  | "evidence-export";

export const REPLAY_BENCHMARK_PER_CYCLE_STAGES: readonly ReplayBenchmarkStageId[] = [
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
] as const;

export const REPLAY_BENCHMARK_PER_RUN_STAGES: readonly ReplayBenchmarkStageId[] = [
  "evidence-export",
] as const;

export const REPLAY_BENCHMARK_ALL_STAGES: readonly ReplayBenchmarkStageId[] = [
  ...REPLAY_BENCHMARK_PER_CYCLE_STAGES,
  ...REPLAY_BENCHMARK_PER_RUN_STAGES,
] as const;

export const REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION = "htr-wp03-benchmark/v1";

export type StageTimingSample = {
  stage: ReplayBenchmarkStageId;
  cycleIndex: number | null;
  durationNs: bigint;
};

export type MemorySample = {
  atStage: ReplayBenchmarkStageId;
  cycleIndex: number | null;
  rssBytes: number;
  heapUsedBytes: number;
};

export type MemoryHighWater = {
  rssBytes: number;
  heapUsedBytes: number;
};

export type ReplayStageTimer = {
  readonly stage: ReplayBenchmarkStageId;
  end(options?: { discard?: boolean }): void;
};

export interface ReplayBenchmarkObserver {
  beginStage(stage: ReplayBenchmarkStageId, cycleIndex: number | null): ReplayStageTimer;
  sampleMemory(atStage: ReplayBenchmarkStageId, cycleIndex: number | null): void;
}

const noopTimer: ReplayStageTimer = {
  stage: "bar-source-next",
  end() {
    // no-op
  },
};

export const NOOP_REPLAY_BENCHMARK_OBSERVER: ReplayBenchmarkObserver = {
  beginStage() {
    return noopTimer;
  },
  sampleMemory() {
    // no-op
  },
};

export type ReplayBenchmarkStageAggregate = {
  sampleCount: number;
  totalNs: string;
  maxNs: string;
  /**
   * HTR-WP09 post-fail correction: real nearest-rank p95 of per-sample durations,
   * derived from a bounded fixed-resolution histogram (O(1) memory, independent of
   * cycle count). Prior instrumentation exposed only `maxNs`; the qualification
   * harness mislabelled `maxNs` as p95 (see ATTEMPT_INVALIDATED_BY_INSTRUMENTATION_FAILURE).
   */
  p95Ns: string;
};

export type ReplayBenchmarkStageTelemetry = {
  schemaVersion: typeof REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION;
  perStage: Record<ReplayBenchmarkStageId, ReplayBenchmarkStageAggregate>;
  memoryHighWater: MemoryHighWater;
  /**
   * HTR-WP09 post-fail correction: RSS/heap captured before the measured run begins,
   * so a true delta (peak − baseline) can be computed. Prior instrumentation exposed
   * only the absolute high-water, which the harness mislabelled as a delta.
   */
  memoryBaseline: MemoryHighWater;
};

/**
 * Bounded latency histogram — fixed bucket count independent of sample count.
 * 10µs resolution across [0, 200ms); a real nearest-rank p95 for sub-200ms
 * per-cycle latencies (the D-11B paper-cycle domain) with O(1) memory.
 */
export const REPLAY_LATENCY_HISTOGRAM_BUCKET_WIDTH_NS = 10_000n;
export const REPLAY_LATENCY_HISTOGRAM_BUCKET_COUNT = 20_000;

export function computeP95NsFromHistogram(
  buckets: Int32Array,
  overflowCount: number,
  bucketWidthNs: bigint,
): bigint {
  let total = overflowCount;
  for (let i = 0; i < buckets.length; i += 1) {
    total += buckets[i]!;
  }
  if (total === 0) {
    return 0n;
  }
  const targetRank = Math.ceil(0.95 * total);
  let cumulative = 0;
  for (let i = 0; i < buckets.length; i += 1) {
    cumulative += buckets[i]!;
    if (cumulative >= targetRank) {
      // Upper edge of the containing bucket (conservative / fail-closed).
      return BigInt(i + 1) * bucketWidthNs;
    }
  }
  // p95 rank lands in the overflow region (>= cap): report the cap (fail-closed).
  return BigInt(buckets.length) * bucketWidthNs;
}

export type ReplayBenchmarkRunResult = {
  schemaVersion: typeof REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION;
  telemetry: ReplayBenchmarkStageTelemetry;
  terminalState: "BENCHMARK_OK" | "BENCHMARK_FAILED";
};

type StageAccumulator = {
  sampleCount: number;
  totalNs: bigint;
  maxNs: bigint;
  histogram: Int32Array;
  histogramOverflow: number;
};

function createEmptyStageAccumulators(): Record<ReplayBenchmarkStageId, StageAccumulator> {
  return Object.fromEntries(
    REPLAY_BENCHMARK_ALL_STAGES.map((stage) => [
      stage,
      {
        sampleCount: 0,
        totalNs: 0n,
        maxNs: 0n,
        histogram: new Int32Array(REPLAY_LATENCY_HISTOGRAM_BUCKET_COUNT),
        histogramOverflow: 0,
      },
    ]),
  ) as Record<ReplayBenchmarkStageId, StageAccumulator>;
}

function readMemoryUsage(): MemoryHighWater {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
  };
}

function updateMemoryHighWater(current: MemoryHighWater, sample: MemoryHighWater): MemoryHighWater {
  return {
    rssBytes: Math.max(current.rssBytes, sample.rssBytes),
    heapUsedBytes: Math.max(current.heapUsedBytes, sample.heapUsedBytes),
  };
}

function toStageTelemetry(
  accumulators: Record<ReplayBenchmarkStageId, StageAccumulator>,
  memoryHighWater: MemoryHighWater,
  memoryBaseline: MemoryHighWater,
): ReplayBenchmarkStageTelemetry {
  const perStage = Object.fromEntries(
    REPLAY_BENCHMARK_ALL_STAGES.map((stage) => {
      const aggregate = accumulators[stage];
      return [
        stage,
        {
          sampleCount: aggregate.sampleCount,
          totalNs: aggregate.totalNs.toString(),
          maxNs: aggregate.maxNs.toString(),
          p95Ns: computeP95NsFromHistogram(
            aggregate.histogram,
            aggregate.histogramOverflow,
            REPLAY_LATENCY_HISTOGRAM_BUCKET_WIDTH_NS,
          ).toString(),
        },
      ];
    }),
  ) as Record<ReplayBenchmarkStageId, ReplayBenchmarkStageAggregate>;

  return {
    schemaVersion: REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION,
    perStage,
    memoryHighWater,
    memoryBaseline,
  };
}

export function createReplayBenchmarkObserver(): {
  observer: ReplayBenchmarkObserver;
  collect(): ReplayBenchmarkRunResult;
} {
  const accumulators = createEmptyStageAccumulators();
  const memoryBaseline = readMemoryUsage();
  let memoryHighWater = memoryBaseline;
  let failed = false;

  const observer: ReplayBenchmarkObserver = {
    beginStage(stage, cycleIndex) {
      void cycleIndex;
      if (failed) {
        return { stage, end() {} };
      }

      let startNs: bigint;
      try {
        startNs = process.hrtime.bigint();
      } catch {
        failed = true;
        return { stage, end() {} };
      }

      return {
        stage,
        end(options?: { discard?: boolean }) {
          if (failed || options?.discard) {
            return;
          }
          try {
            const durationNs = process.hrtime.bigint() - startNs;
            const aggregate = accumulators[stage];
            aggregate.sampleCount += 1;
            aggregate.totalNs += durationNs;
            if (durationNs > aggregate.maxNs) {
              aggregate.maxNs = durationNs;
            }
            const bucketIndex = Number(durationNs / REPLAY_LATENCY_HISTOGRAM_BUCKET_WIDTH_NS);
            if (bucketIndex >= 0 && bucketIndex < aggregate.histogram.length) {
              aggregate.histogram[bucketIndex] += 1;
            } else {
              aggregate.histogramOverflow += 1;
            }
          } catch {
            failed = true;
          }
        },
      };
    },
    sampleMemory(atStage, cycleIndex) {
      void atStage;
      void cycleIndex;
      if (failed) {
        return;
      }
      try {
        memoryHighWater = updateMemoryHighWater(memoryHighWater, readMemoryUsage());
      } catch {
        failed = true;
      }
    },
  };

  return {
    observer,
    collect() {
      return {
        schemaVersion: REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION,
        telemetry: toStageTelemetry(accumulators, memoryHighWater, memoryBaseline),
        terminalState: failed ? "BENCHMARK_FAILED" : "BENCHMARK_OK",
      };
    },
  };
}

export function aggregateBigIntMedian(values: readonly bigint[]): bigint {
  if (values.length === 0) {
    return 0n;
  }
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2n;
  }
  return sorted[mid]!;
}

export function aggregateBigIntP95NearestRank(values: readonly bigint[]): bigint {
  if (values.length === 0) {
    return 0n;
  }
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[index]!;
}

export function aggregateBigIntMax(values: readonly bigint[]): bigint {
  if (values.length === 0) {
    return 0n;
  }
  return values.reduce((max, value) => (value > max ? value : max), values[0]!);
}

export function aggregateNumberMedian(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function aggregateNumberP95NearestRank(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[index]!;
}

export function aggregateNumberMax(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.max(...values);
}

/** Fail closed when `--expose-gc` was not provided to the qualification child process. */
export function assertGlobalGcAvailable(context = "qualification"): void {
  if (typeof (globalThis as { gc?: () => void }).gc !== "function") {
    throw new Error(
      `[htr-wp09-qualify] global.gc unavailable (${context}) — child process must use --expose-gc`,
    );
  }
}

/** Invoke V8 full GC twice (requires `--expose-gc`). Used outside wall/stage timing. */
export function invokeFullGcTwice(): void {
  assertGlobalGcAvailable();
  (globalThis as { gc: () => void }).gc();
  (globalThis as { gc: () => void }).gc();
}

export function readHeapUsedBytes(): number {
  return process.memoryUsage().heapUsed;
}

export function computePostGcLiveHeapDeltaBytes(
  preRunPostGcHeapUsedBytes: number,
  postRunPostGcHeapUsedBytes: number,
): number {
  return Math.max(0, postRunPostGcHeapUsedBytes - preRunPostGcHeapUsedBytes);
}
