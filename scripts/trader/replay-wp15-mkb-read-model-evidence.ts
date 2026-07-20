/**
 * HTR-WP15 — MKB read-model evidence CLI.
 *
 * Usage:
 *   pnpm trader:wp15:evidence
 */

import {
  runWp15MkbReadModelEvidenceHarness,
  writeWp15MkbReadModelEvidence,
} from "@/lib/trader/knowledge/mkb-read-model-evidence-harness";

async function main(): Promise<void> {
  const report = await runWp15MkbReadModelEvidenceHarness();
  const paths = writeWp15MkbReadModelEvidence(report);

  console.log("[htr-wp15-mkb-read-model] semanticDigest:", report.semanticDigest);
  console.log(
    "[htr-wp15-mkb-read-model] deterministicSemanticDigest:",
    report.deterministicSemanticDigest,
  );
  console.log("[htr-wp15-mkb-read-model] entryCount:", report.entryCount);
  console.log("[htr-wp15-mkb-read-model] verifiedKnowledgeCount:", report.verifiedKnowledgeCount);
  console.log("[htr-wp15-mkb-read-model] output:", paths.outputDir);
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp15-mkb-read-model] failed:", error);
    process.exitCode = 1;
  });
}
