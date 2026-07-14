/**
 * HTR-WP11 — PIT provider context evidence CLI.
 *
 * Usage:
 *   pnpm trader:replay:pit-context
 */

import {
  runPitContextEvidenceHarness,
  writePitContextEvidence,
} from "@/lib/trader/market-data/replay/pit-context-evidence-harness";

async function main(): Promise<void> {
  const harness = runPitContextEvidenceHarness();
  const paths = writePitContextEvidence(harness);

  console.log("[htr-wp11-pit] evaluatedAt:", harness.evaluatedAt);
  console.log("[htr-wp11-pit] fusedContextDigest:", harness.fusedContextDigest);
  console.log("[htr-wp11-pit] gitSha:", harness.gitSha);
  console.log("[htr-wp11-pit] output:", paths.outputDir);
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp11-pit] failed:", error);
    process.exitCode = 1;
  });
}
