/**
 * HTR-WP03 — bounded replay benchmark baseline (D-11A approved fixture only).
 *
 * Usage:
 *   pnpm trader:replay:benchmark
 */

import {
  runReplayBenchmarkHarness,
  writeReplayBenchmarkEvidence,
} from "@/lib/trader/backtest/replay-benchmark-harness";

async function main(): Promise<void> {
  const harness = await runReplayBenchmarkHarness();
  if (harness.terminalState !== "BENCHMARK_OK") {
    console.error("[htr-wp03-benchmark] terminal state:", harness.terminalState);
    process.exitCode = 1;
    return;
  }

  const paths = writeReplayBenchmarkEvidence(harness);
  console.log("[htr-wp03-benchmark] wrote evidence:");
  console.log(`  ${paths.resultPath}`);
  console.log(`  ${paths.manifestPath}`);
  console.log(`  ${paths.readmePath}`);
  console.log(
    `[htr-wp03-benchmark] cycles=${harness.cycleCount} evidenceDigest=${harness.evidenceDigest}`,
  );
}

main().catch((error: unknown) => {
  console.error("[htr-wp03-benchmark] failed:", error);
  process.exitCode = 1;
});
