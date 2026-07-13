/**
 * HTR-WP09 integrated D-11B qualification orchestrator (Stage C).
 *
 * Usage: pnpm trader:replay:qualify -- --n1 --n2 --out <staging-dir>
 */
import {
  D11B_APPROVED_HOST_FINGERPRINT_SHA256,
  HTR_WP09_AMENDED_STAGING_DIR,
  runWp09AmendedQualificationAttempt,
  runWp09QualificationAttempt,
  verifyReferenceHostFingerprint,
} from "@/lib/trader/backtest/replay-qualification-harness";

function parseArgs(argv: string[]): { stagingDir?: string; amendedV1?: boolean } {
  const outIndex = argv.indexOf("--out");
  const stagingDir = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const amendedV1 = argv.includes("--amended-v1");
  return { stagingDir, amendedV1 };
}

async function main(): Promise<void> {
  verifyReferenceHostFingerprint(D11B_APPROVED_HOST_FINGERPRINT_SHA256);
  const { stagingDir, amendedV1 } = parseArgs(process.argv.slice(2));
  const result = amendedV1
    ? await runWp09AmendedQualificationAttempt({
        stagingDir: stagingDir ?? HTR_WP09_AMENDED_STAGING_DIR,
      })
    : await runWp09QualificationAttempt({ stagingDir });
  console.log(
    JSON.stringify({ terminalState: result.terminalState, gitSha: result.gitSha }, null, 2),
  );
  const passStates = new Set([
    "HTR_WP09_D11B_QUALIFICATION_PASS",
    "HTR_WP09_D11B_MEMORY_AMENDMENT_V1_PASS",
  ]);
  if (!passStates.has(result.terminalState)) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("[htr-wp09-qualify] failed:", error);
  process.exitCode = 1;
});
