/**
 * HTR-WP13 — intelligence records evidence CLI.
 *
 * Usage:
 *   pnpm trader:wp13:evidence
 */

import {
  runWp13IntelligenceEvidenceHarness,
  writeWp13IntelligenceEvidence,
} from "@/lib/trader/intelligence/records/wp13-intelligence-evidence-harness";

async function main(): Promise<void> {
  const report = runWp13IntelligenceEvidenceHarness();
  const paths = writeWp13IntelligenceEvidence(report);

  console.log("[htr-wp13-intelligence] profileDigest:", report.profileDigest);
  console.log("[htr-wp13-intelligence] matrixDigest:", report.matrixDigest);
  console.log("[htr-wp13-intelligence] semanticDigest:", report.semanticDigest);
  console.log(
    "[htr-wp13-intelligence] twoGenerationSemanticParity:",
    report.twoGenerationSemanticParity,
  );
  console.log("[htr-wp13-intelligence] output:", paths.outputDir);
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp13-intelligence] failed:", error);
    process.exitCode = 1;
  });
}
