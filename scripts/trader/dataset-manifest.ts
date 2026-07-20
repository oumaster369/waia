/**
 * HTR-WP12 — FHV ingress dataset manifest evidence CLI.
 *
 * Usage:
 *   pnpm trader:dataset:manifest
 */

import {
  runIngressManifestEvidenceHarness,
  writeIngressManifestEvidence,
} from "@/lib/trader/market-data/dataset/ingress-manifest-evidence-harness";

async function main(): Promise<void> {
  const harness = runIngressManifestEvidenceHarness();
  const paths = writeIngressManifestEvidence(harness);

  console.log("[htr-wp12-manifest] manifestDigest:", harness.manifest.manifestSemanticDigest);
  console.log("[htr-wp12-manifest] gapPolicyResult:", harness.gapPolicyResult);
  console.log("[htr-wp12-manifest] gitSha:", harness.gitSha);
  console.log("[htr-wp12-manifest] output:", paths.outputDir);
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp12-manifest] failed:", error);
    process.exitCode = 1;
  });
}
