/**
 * HTR-WP04 — streaming replay evidence recovery verification CLI.
 *
 * Usage:
 *   pnpm trader:replay:evidence-recovery
 */

import {
  runStreamingEvidenceRecoveryHarness,
  writeStreamingEvidenceBaseline,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-recovery-harness";

async function main(): Promise<void> {
  const harness = await runStreamingEvidenceRecoveryHarness();

  const paths = writeStreamingEvidenceBaseline(
    harness,
    harness.evidenceDirs.completeRunDir,
    harness.evidenceDirs.sigtermRunDir,
    harness.evidenceDirs.corruptRunDir,
  );

  console.log("[htr-wp04-evidence] terminal state:", harness.terminalState);
  console.log("[htr-wp04-evidence] baseline:", paths.baselineDir);
  console.log(
    `[htr-wp04-evidence] cycles=${harness.streamOnlyRun.cycleCount} retainedPaperCycleResults=${harness.memoryBoundedness.retainedPaperCycleResults} peakBufferedProjections=${harness.memoryBoundedness.peakBufferedProjections}`,
  );

  if (harness.terminalState !== "STREAMING_EVIDENCE_OK") {
    process.exitCode = 1;
  }
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp04-evidence] failed:", error);
    process.exitCode = 1;
  });
}
