import { createReplayBenchmarkObserver } from "@/lib/trader/backtest/replay-benchmark-instrumentation";
import {
  clearFhvSyntheticProfilingHooks,
  setFhvSyntheticProfilingHooks,
} from "@/lib/trader/observability/fhv-synthetic-profiling-hook";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";
import { TARGET_CYCLE_COUNT } from "@/tests/fhv/official-scale/blocking/fhv-official-scale-constants";
import {
  buildFhvOfficialScaleHarnessContext,
  resolveBarsProcessed,
  setupFhvOfficialScaleLaunchPaths,
  teardownFhvOfficialScaleHarnessContext,
  toFhvOfficialScaleLaunchInput,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-harness";

async function main(): Promise<void> {
  const harness = buildFhvOfficialScaleHarnessContext();
  const paths = setupFhvOfficialScaleLaunchPaths({
    harness,
    runId: "fhv-idhps-profile-probe",
    maxCycles: TARGET_CYCLE_COUNT,
    targetCycleCount: TARGET_CYCLE_COUNT,
    checkpointEveryCycles: 3997,
  });
  const instrumentation = createReplayBenchmarkObserver();
  setFhvSyntheticProfilingHooks({ mode: "P1", observer: instrumentation.observer });
  const startedAt = Date.now();
  try {
    const result = await executeFhvFullHistoricalLaunch(
      toFhvOfficialScaleLaunchInput(paths, { maxCycles: TARGET_CYCLE_COUNT }),
    );
    const wallTimeMs = Date.now() - startedAt;
    const bars = resolveBarsProcessed({
      sourceFrontier: result.backtest?.sourceFrontier,
      cycleCount: result.backtest?.cycleCount,
    });
    const collected = instrumentation.collect();
    const stages = Object.entries(collected.telemetry.perStage).map(([stage, agg]) => ({
      stage,
      sampleCount: agg.sampleCount,
      totalMs: Number(BigInt(agg.totalNs)) / 1e6,
      maxMs: Number(BigInt(agg.maxNs)) / 1e6,
      meanMs: agg.sampleCount ? Number(BigInt(agg.totalNs)) / 1e6 / agg.sampleCount : 0,
    }));
    stages.sort((a, b) => b.totalMs - a.totalMs);
    console.log(
      JSON.stringify(
        {
          wallTimeMs,
          bars,
          cps: bars / (wallTimeMs / 1000),
          fills: result.backtest?.accountingFrontierState?.consumedFillIds?.length,
          stages,
        },
        null,
        2,
      ),
    );
  } finally {
    clearFhvSyntheticProfilingHooks();
    teardownFhvOfficialScaleHarnessContext(harness);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
