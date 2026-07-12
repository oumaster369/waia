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
    `[htr-wp05-checkpoint] parity evidenceDigest=${harness.parity.evidenceDigestMatch} semanticRepro=${harness.parity.semanticReproDigestMatch} semanticParity=${harness.parity.semanticParityDigestMatch}`,
  );
  console.log(
    `[htr-wp05-checkpoint] uninterrupted evidenceDigest=${harness.uninterrupted.evidenceDigest}`,
  );
  console.log(`[htr-wp05-checkpoint] resumed evidenceDigest=${harness.resumed.evidenceDigest}`);
  console.log(
    `[htr-wp05-checkpoint] uninterrupted semanticParityDigest=${harness.uninterruptedSemanticParityDigest}`,
  );
  console.log(
    `[htr-wp05-checkpoint] resumed semanticParityDigest=${harness.resumedSemanticParityDigest}`,
  );
  console.log(
    `[htr-wp05-checkpoint] authoritative cycles=${harness.authoritativeStream.cycleCount} dup=${harness.authoritativeStream.duplicateCount} gap=${harness.authoritativeStream.gapCount} superseded=${harness.authoritativeStream.supersededSegmentCount}`,
  );

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
