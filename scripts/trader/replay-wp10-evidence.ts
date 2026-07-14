/**
 * HTR-WP10 — operator-gated determinism evidence writer.
 *
 * Usage:
 *   pnpm trader:replay:wp10-evidence -- --output-dir <explicit-output-dir>
 */

import path from "node:path";

import {
  buildWp10DeterminismManifest,
  buildWp10DeterminismProvenance,
  HTR_WP10_DETERMINISM_COMMAND,
  parseWp10EvidenceOutputDir,
  sha256File,
  writeWp10DeterminismEvidence,
} from "@/lib/trader/research/wp10-determinism-evidence-harness";
import { computeWp10DeterminismEvidence } from "@/tests/unit/helpers/wp10-replay-fixture";

const HARNESS_SOURCE_PATH = "lib/trader/research/wp10-determinism-evidence-harness.ts";

async function main(): Promise<void> {
  const outputDir = parseWp10EvidenceOutputDir(process.argv.slice(2));
  if (!outputDir) {
    throw new Error(`${HTR_WP10_DETERMINISM_COMMAND} requires --output-dir <explicit-output-dir>`);
  }

  const { replay, manifest } = await computeWp10DeterminismEvidence();
  const harnessSourceSha256 = await sha256File(path.join(process.cwd(), HARNESS_SOURCE_PATH));
  const provenance = buildWp10DeterminismProvenance({
    manifest,
    harnessSourcePath: HARNESS_SOURCE_PATH,
    harnessSourceSha256,
  });

  const paths = writeWp10DeterminismEvidence({
    outputDir,
    manifest: buildWp10DeterminismManifest(replay),
    provenance,
  });

  console.log("[htr-wp10-evidence] gitSha:", provenance.gitSha);
  console.log("[htr-wp10-evidence] dirtyTree:", provenance.dirtyTree);
  console.log("[htr-wp10-evidence] artifactDigest:", manifest.artifactDigest);
  console.log(
    "[htr-wp10-evidence] historicalAcceptedArtifactDigest:",
    provenance.historicalAcceptedArtifactDigest,
  );
  console.log("[htr-wp10-evidence] candidateStatus:", provenance.candidateStatus);
  console.log("[htr-wp10-evidence] output:", paths.outputDir);
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error("[htr-wp10-evidence] failed:", error);
    process.exitCode = 1;
  });
}
