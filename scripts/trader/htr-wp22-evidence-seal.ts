/**
 * HTR-WP22 — staging evidence seal CLI (v2 sidecar model).
 *
 * Usage:
 *   pnpm trader:htr:wp22:evidence-seal -- \
 *     --staging-only \
 *     --source-git-sha <EVIDENCE_ASSEMBLY_SHA> \
 *     --qualification-source-git-sha <D11B_QUALIFICATION_SHA>
 */

import { execSync } from "node:child_process";

import {
  assembleHtrWp22EvidenceBundleSequential,
  sealHtrWp22EvidenceStaging,
  verifyHtrWp22EvidenceStaging,
} from "@/lib/trader/backtest/htr-wp22-evidence-harness";

function parseArgs(argv: string[]): {
  stagingOnly?: boolean;
  sourceGitSha?: string;
  qualificationSourceGitSha?: string;
} {
  const shaIndex = argv.indexOf("--source-git-sha");
  const qualificationIndex = argv.indexOf("--qualification-source-git-sha");
  return {
    stagingOnly: argv.includes("--staging-only"),
    sourceGitSha: shaIndex >= 0 ? argv[shaIndex + 1] : undefined,
    qualificationSourceGitSha: qualificationIndex >= 0 ? argv[qualificationIndex + 1] : undefined,
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

  const { stagingOnly, sourceGitSha, qualificationSourceGitSha } = parseArgs(process.argv.slice(2));
  if (!stagingOnly) {
    throw new Error("HTR_WP22_EVIDENCE_SEAL:STAGING_ONLY_REQUIRED");
  }
  if (!sourceGitSha) {
    throw new Error("HTR_WP22_EVIDENCE_SEAL:SOURCE_GIT_SHA_REQUIRED");
  }
  if (!qualificationSourceGitSha) {
    throw new Error("HTR_WP22_EVIDENCE_SEAL:QUALIFICATION_SOURCE_GIT_SHA_REQUIRED");
  }

  assertGitTreeClean();

  const bundle = await assembleHtrWp22EvidenceBundleSequential({
    sourceGitSha,
    qualificationSourceGitSha,
  });

  const sealed = sealHtrWp22EvidenceStaging({
    sourceGitSha,
    bundle: {
      ...bundle,
      sourceGitSha,
      qualificationSourceGitSha,
      sourceDirtyTree: false,
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
        evidenceAssemblyGitSha: sourceGitSha,
        qualificationSourceGitSha,
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
