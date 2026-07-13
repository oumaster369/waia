/**
 * HTR-WP09 integrated D-11B qualification orchestrator (Stage C).
 *
 * Usage: pnpm trader:replay:qualify -- --n1 --n2 --out <staging-dir>
 */
import {
  D11B_APPROVED_HOST_FINGERPRINT_SHA256,
  runWp09QualificationAttempt,
  verifyReferenceHostFingerprint,
} from "@/lib/trader/backtest/replay-qualification-harness";

function parseArgs(argv: string[]): { stagingDir?: string } {
  const outIndex = argv.indexOf("--out");
  const stagingDir = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  return { stagingDir };
}

async function main(): Promise<void> {
  verifyReferenceHostFingerprint(D11B_APPROVED_HOST_FINGERPRINT_SHA256);
  const { stagingDir } = parseArgs(process.argv.slice(2));
  const result = await runWp09QualificationAttempt({ stagingDir });
  console.log(
    JSON.stringify({ terminalState: result.terminalState, gitSha: result.gitSha }, null, 2),
  );
  if (result.terminalState !== "HTR_WP09_D11B_QUALIFICATION_PASS") {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("[htr-wp09-qualify] failed:", error);
  process.exitCode = 1;
});
