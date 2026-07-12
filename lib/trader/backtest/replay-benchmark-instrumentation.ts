export type ReplayBenchmarkStageId =
  | "bar-source-next"
  | "fused-context-build"
  | "clock-advance"
  | "paper-cycle"
  | "account-state-refresh"
  | "evidence-export";

export const REPLAY_BENCHMARK_PER_CYCLE_STAGES: readonly ReplayBenchmarkStageId[] = [
  "bar-source-next",
  "fused-context-build",
  "clock-advance",
  "paper-cycle",
  "account-state-refresh",
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
};

export type ReplayBenchmarkStageTelemetry = {
  schemaVersion: typeof REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION;
  perStage: Record<ReplayBenchmarkStageId, ReplayBenchmarkStageAggregate>;
  memoryHighWater: MemoryHighWater;
};

export type ReplayBenchmarkRunResult = {
  schemaVersion: typeof REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION;
  telemetry: ReplayBenchmarkStageTelemetry;
  terminalState: "BENCHMARK_OK" | "BENCHMARK_FAILED";
};

type StageAccumulator = {
  sampleCount: number;
  totalNs: bigint;
  maxNs: bigint;
};

function createEmptyStageAccumulators(): Record<ReplayBenchmarkStageId, StageAccumulator> {
  return Object.fromEntries(
    REPLAY_BENCHMARK_ALL_STAGES.map((stage) => [stage, { sampleCount: 0, totalNs: 0n, maxNs: 0n }]),
  ) as Record<ReplayBenchmarkStageId, StageAccumulator>;
}

function emptyMemoryHighWater(): MemoryHighWater {
  return { rssBytes: 0, heapUsedBytes: 0 };
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
        },
      ];
    }),
  ) as Record<ReplayBenchmarkStageId, ReplayBenchmarkStageAggregate>;

  return {
    schemaVersion: REPLAY_BENCHMARK_EVIDENCE_SCHEMA_VERSION,
    perStage,
    memoryHighWater,
  };
}

export function createReplayBenchmarkObserver(): {
  observer: ReplayBenchmarkObserver;
  collect(): ReplayBenchmarkRunResult;
} {
  const accumulators = createEmptyStageAccumulators();
  let memoryHighWater = emptyMemoryHighWater();
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
        telemetry: toStageTelemetry(accumulators, memoryHighWater),
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
