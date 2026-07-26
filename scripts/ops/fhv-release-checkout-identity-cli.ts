/**
 * DEE-436 — CLI for fhv-release-checkout-identity.sh
 */

import {
  FhvT4CheckoutIdentityError,
  verifyFhvReleaseCheckoutIdentity,
  writeFhvT4CheckoutIdentityProofAtomic,
} from "@/lib/trader/observability/fhv-t4-release-checkout-identity";

function parseFlag(argv: readonly string[], flag: string): string | undefined {
  const indexes = argv.reduce<number[]>((acc, arg, index) => {
    if (arg === flag) {
      acc.push(index);
    }
    return acc;
  }, []);
  if (indexes.length > 1) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_FLAG_DUPLICATE",
      `Duplicate flag: ${flag}`,
    );
  }
  if (indexes.length === 0) {
    return undefined;
  }
  const index = indexes[0]!;
  if (index + 1 >= argv.length || argv[index + 1]!.startsWith("-")) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_FLAG_VALUE_MISSING",
      `Flag requires value: ${flag}`,
    );
  }
  return argv[index + 1]!.trim();
}

const ALLOWED_FLAGS = new Set([
  "--repo-path",
  "--target-sha",
  "--release-tag",
  "--output",
  "--run-root",
  "--run-id",
  "--organization-id",
]);

function main(): void {
  const argv = process.argv.slice(2);
  for (const arg of argv) {
    if (arg.startsWith("-") && !ALLOWED_FLAGS.has(arg)) {
      throw new FhvT4CheckoutIdentityError("FHV_T4_CHECKOUT_FLAG_UNKNOWN", `Unknown flag: ${arg}`);
    }
  }
  const repoPath = parseFlag(argv, "--repo-path");
  const targetSha = parseFlag(argv, "--target-sha");
  const releaseTag = parseFlag(argv, "--release-tag");
  const output = parseFlag(argv, "--output");
  const runRoot = parseFlag(argv, "--run-root") ?? output;
  const runId = parseFlag(argv, "--run-id") ?? "";
  const organizationId = parseFlag(argv, "--organization-id") ?? "";
  if (!repoPath || !targetSha || !releaseTag) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_CONFIG_INCOMPLETE",
      "--repo-path, --target-sha, and --release-tag are required",
    );
  }
  if (output || runRoot) {
    if (!runRoot || !runId || !organizationId) {
      throw new FhvT4CheckoutIdentityError(
        "FHV_T4_CHECKOUT_OUTPUT_CONFIG_INCOMPLETE",
        "--run-root/--output with --run-id and --organization-id required for proof write",
      );
    }
    const proof = writeFhvT4CheckoutIdentityProofAtomic({
      runRoot,
      repoPath,
      targetSha,
      releaseTag,
      runId,
      organizationId,
    });
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    process.stdout.write("classification=FHV_T4_CHECKOUT_IDENTITY_PROOF_OK\n");
    return;
  }
  const verified = verifyFhvReleaseCheckoutIdentity({ repoPath, targetSha, releaseTag });
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "fhv-t4-checkout-identity-sample/v1",
        ...verified,
        releaseSha: targetSha.toLowerCase(),
        releaseTag,
        repoPath,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write("classification=FHV_T4_CHECKOUT_IDENTITY_OK\n");
}

try {
  main();
} catch (error) {
  const code = error instanceof FhvT4CheckoutIdentityError ? error.code : "FHV_T4_CHECKOUT_FAILED";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}
