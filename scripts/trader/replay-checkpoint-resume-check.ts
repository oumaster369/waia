/**
 * HTR-WP05 — replay checkpoint/resume verification CLI.
 *
 * Usage:
 *   pnpm trader:replay:checkpoint-resume
 */

import {
  assertCheckpointResumeHarness,
  runCheckpointResumeHarness,
  writeCheckpointResumeBaseline,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";

async function main(): Promise<void> {
  const harness = await runCheckpointResumeHarness();
  assertCheckpointResumeHarness(harness);
  const paths = writeCheckpointResumeBaseline(harness);

  console.log("[htr-wp05-checkpoint] terminal state:", harness.terminalState);
  console.log("[htr-wp05-checkpoint] baseline:", paths.baselineDir);
  console.log(
    `[htr-wp05-checkpoint] parity evidenceDigest=${harness.parity.evidenceDigestMatch} semanticRepro=${harness.parity.semanticReproDigestMatch}`,
  );
  console.log(`[htr-wp05-checkpoint] uninterrupted digest=${harness.uninterrupted.evidenceDigest}`);
  console.log(`[htr-wp05-checkpoint] resumed digest=${harness.resumed.evidenceDigest}`);

  if (harness.terminalState !== "REPLAY_RUN_OK") {
    process.exitCode = 1;
  }
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp05-checkpoint] failed:", error);
    process.exitCode = 1;
  });
}
