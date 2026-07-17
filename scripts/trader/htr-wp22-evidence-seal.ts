/**
 * HTR-WP22 — staging evidence seal CLI (v2 sidecar model).
 *
 * Usage:
 *   pnpm trader:htr:wp22:evidence-seal -- --staging-only --source-git-sha <SHA>
 */

import { execSync } from "node:child_process";

import { buildHtrWp22FixtureManifest } from "@/lib/trader/backtest/htr-wp22-fixture-manifest";
import { runHtrWp22BoundedMemorySoak } from "@/lib/trader/backtest/htr-wp22-bounded-memory-soak";
import { runHtrWp22CheckpointResumeParity } from "@/lib/trader/backtest/htr-wp22-checkpoint-resume-parity";
import { runHtrWp22CrashRecoveryMatrix } from "@/lib/trader/backtest/htr-wp22-crash-recovery-matrix";
import {
  sealHtrWp22EvidenceStaging,
  verifyHtrWp22EvidenceStaging,
} from "@/lib/trader/backtest/htr-wp22-evidence-harness";
import { runHtrWp22CompletedRuntimeD11bQualification } from "@/lib/trader/backtest/htr-completed-runtime-qualification-harness";

function parseArgs(argv: string[]): { stagingOnly?: boolean; sourceGitSha?: string } {
  const shaIndex = argv.indexOf("--source-git-sha");
  return {
    stagingOnly: argv.includes("--staging-only"),
    sourceGitSha: shaIndex >= 0 ? argv[shaIndex + 1] : undefined,
  };
}

function assertGitTreeClean(): void {
  const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  if (status.length > 0) {
    throw new Error("HTR_WP22_EVIDENCE_SEAL:DIRTY_SOURCE_TREE");
  }
}

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error("WAIA_TRADER_CLI=1 required");
  }

  const { stagingOnly, sourceGitSha } = parseArgs(process.argv.slice(2));
  if (!stagingOnly) {
    throw new Error("HTR_WP22_EVIDENCE_SEAL:STAGING_ONLY_REQUIRED");
  }
  if (!sourceGitSha) {
    throw new Error("HTR_WP22_EVIDENCE_SEAL:SOURCE_GIT_SHA_REQUIRED");
  }

  assertGitTreeClean();

  const [completedRuntime, crashRecoveryMatrix, checkpointResumeParity, boundedMemorySoak] =
    await Promise.all([
      runHtrWp22CompletedRuntimeD11bQualification({ sourceGitSha }),
      runHtrWp22CrashRecoveryMatrix(),
      runHtrWp22CheckpointResumeParity(),
      runHtrWp22BoundedMemorySoak(),
    ]);

  const fixtureManifest = buildHtrWp22FixtureManifest();

  const sealed = sealHtrWp22EvidenceStaging({
    sourceGitSha,
    bundle: {
      sourceGitSha,
      sourceDirtyTree: false,
      completedRuntime,
      crashRecoveryMatrix,
      checkpointResumeParity,
      boundedMemorySoak,
      fixtureManifest,
    },
  });

  if (!verifyHtrWp22EvidenceStaging(sealed.stagingDir)) {
    throw new Error("HTR_WP22_EVIDENCE_SEAL:INTERNAL_VERIFICATION_FAILED");
  }

  console.log(
    JSON.stringify(
      {
        stagingDir: sealed.stagingDir,
        manifestDigest: sealed.manifestDigest,
        semanticDigest: sealed.semanticDigest,
        artifactCount: sealed.manifest.artifactIndex.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error("[htr-wp22-evidence-seal] failed:", error);
  process.exitCode = 1;
});
