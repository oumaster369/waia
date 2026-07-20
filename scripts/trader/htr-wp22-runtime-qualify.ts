/**
 * HTR-WP22 — completed-runtime D-11B qualification CLI.
 *
 * Usage:
 *   pnpm trader:htr:wp22:qualify -- --phase completed-runtime-d11b --source-git-sha <SHA>
 */

import { execSync } from "node:child_process";

import {
  HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE,
  type HtrWp22CompletedRuntimeQualificationPhase,
} from "@/lib/trader/backtest/htr-completed-runtime-qualification.types";
import { runHtrWp22CompletedRuntimeD11bQualification } from "@/lib/trader/backtest/htr-completed-runtime-qualification-harness";
import { D11B_APPROVED_HOST_FINGERPRINT_SHA256 } from "@/lib/trader/backtest/replay-qualification-harness";
import { verifyReferenceHostFingerprint } from "@/lib/trader/backtest/replay-qualification-harness";

function parseArgs(argv: string[]): {
  phase?: HtrWp22CompletedRuntimeQualificationPhase;
  sourceGitSha?: string;
} {
  const phaseIndex = argv.indexOf("--phase");
  const shaIndex = argv.indexOf("--source-git-sha");
  const phase =
    phaseIndex >= 0
      ? (argv[phaseIndex + 1] as HtrWp22CompletedRuntimeQualificationPhase)
      : undefined;
  const sourceGitSha = shaIndex >= 0 ? argv[shaIndex + 1] : undefined;
  return { phase, sourceGitSha };
}

function assertGitTreeClean(): void {
  const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  if (status.length > 0) {
    throw new Error("HTR_WP22_QUALIFY:DIRTY_SOURCE_TREE");
  }
}

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error("WAIA_TRADER_CLI=1 required");
  }

  verifyReferenceHostFingerprint(D11B_APPROVED_HOST_FINGERPRINT_SHA256);
  assertGitTreeClean();

  const { phase, sourceGitSha } = parseArgs(process.argv.slice(2));
  if (phase !== HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE) {
    throw new Error(`HTR_WP22_QUALIFY:UNSUPPORTED_PHASE:${phase ?? "missing"}`);
  }
  if (!sourceGitSha) {
    throw new Error("HTR_WP22_QUALIFY:SOURCE_GIT_SHA_REQUIRED");
  }

  const result = await runHtrWp22CompletedRuntimeD11bQualification({ sourceGitSha });
  console.log(
    JSON.stringify(
      {
        phase: result.phase,
        terminalState: result.terminalState,
        sourceGitSha: result.sourceGitSha,
        hostFingerprintSha256: result.hostFingerprintSha256,
      },
      null,
      2,
    ),
  );

  if (result.terminalState !== "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS") {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("[htr-wp22-qualify] failed:", error);
  process.exitCode = 1;
});
