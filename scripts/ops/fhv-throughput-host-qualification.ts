/**
 * Execution Server throughput host qualification (ADR-0025 AD-6b).
 *
 * Usage:
 *   node --import tsx scripts/ops/fhv-throughput-host-qualification.ts --run-dir <fhv run dir> [--repo-path <checkout>]
 */
import { qualifyFhvThroughputHost } from "@/lib/trader/observability/fhv-throughput-qualification";
import { FhvGrowthLawReportError } from "@/lib/trader/observability/fhv-growth-law-report";
import { FhvT4CheckoutIdentityError } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import { FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION } from "@/lib/trader/observability/fhv-throughput-receipt";

function parseArgs(argv: readonly string[]): {
  runDir: string;
  repoPath: string;
  expectedReleaseSha: string | null;
  outPath: string | null;
} {
  let runDir = "";
  let repoPath = process.cwd();
  let expectedReleaseSha: string | null = null;
  let outPath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--run-dir") {
      runDir = argv[++i] ?? "";
    } else if (arg === "--repo-path") {
      repoPath = argv[++i] ?? process.cwd();
    } else if (arg === "--expected-release-sha") {
      expectedReleaseSha = argv[++i] ?? null;
    } else if (arg === "--out") {
      outPath = argv[++i] ?? null;
    }
  }
  if (!runDir) {
    throw new Error("BLOCKED_BY_FHV_THROUGHPUT_ARGS: --run-dir is required");
  }
  return { runDir, repoPath, expectedReleaseSha, outPath };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const receipt = qualifyFhvThroughputHost({
    runDir: args.runDir,
    repoPath: args.repoPath,
    ...(args.expectedReleaseSha ? { expectedReleaseSha: args.expectedReleaseSha } : {}),
    outPath: args.outPath,
  });
  console.log(
    `[throughput-hostqual] boundedness=${receipt.evidence.boundednessClassification} ` +
      `checkpoint_samples=${receipt.evidence.checkpointSamples} ` +
      `progress_samples=${receipt.evidence.progressSamples} ` +
      `decay=${receipt.evidence.hotPathDecayVerdict} ` +
      `projected_runtime_s=${receipt.evidence.growthAwareProjectedRuntimeS}`,
  );
  console.log(`[throughput-hostqual] receipt_digest=${receipt.receiptDigest}`);
  console.log(`[throughput-hostqual] RESULT=${receipt.classification}`);
  if (receipt.classification !== FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION) {
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1]?.includes("fhv-throughput-host-qualification.ts") ?? false;

if (invokedDirectly) {
  try {
    main();
  } catch (error: unknown) {
    const code =
      error instanceof FhvGrowthLawReportError || error instanceof FhvT4CheckoutIdentityError
        ? error.code
        : error instanceof Error && "code" in error
          ? String((error as { code?: string }).code)
          : "FAILED";
    process.stderr.write(`[throughput-hostqual] ${code}: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

export { main };
