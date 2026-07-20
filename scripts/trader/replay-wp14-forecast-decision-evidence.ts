/**
 * HTR-WP14 — forecast-decision evidence CLI.
 *
 * Usage:
 *   pnpm trader:wp14:evidence
 */

import {
  runWp14ForecastDecisionEvidenceHarness,
  writeWp14ForecastDecisionEvidence,
} from "@/lib/trader/intelligence/forecast-decision/wp14-forecast-decision-evidence-harness";

async function main(): Promise<void> {
  const report = runWp14ForecastDecisionEvidenceHarness();
  const paths = writeWp14ForecastDecisionEvidence(report);

  console.log("[htr-wp14-forecast-decision] profileDigest:", report.profileDigest);
  console.log("[htr-wp14-forecast-decision] matrixDigest:", report.matrixDigest);
  console.log("[htr-wp14-forecast-decision] semanticDigest:", report.semanticDigest);
  console.log(
    "[htr-wp14-forecast-decision] twoGenerationSemanticParity:",
    report.twoGenerationSemanticParity,
  );
  console.log("[htr-wp14-forecast-decision] output:", paths.outputDir);
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp14-forecast-decision] failed:", error);
    process.exitCode = 1;
  });
}
