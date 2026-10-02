/** Executed, source-bound PostgreSQL proof for the closed scheduled NO_TRADE owner. */
export const requiredSuites = [
  "tests/integration/postgres-scheduled-paper-owner-v1.test.ts",
];

export const sourcePaths = [
  "custom-worker.ts",
  "docs/ai-trader/reality-v2-source-consumer-inventory.json",
  "docs/plans/dee-1205-scheduled-noncapital-owner.md",
  "docs/plans/dee-1205-scheduled-noncapital-owner.sql",
  "lib/trader/execution/ordinary-paper-order-repository-postgres.ts",
  "lib/trader/execution/v2/org-order-path.ts",
  "lib/trader/paper/run-paper-loop-cycle.ts",
  "lib/trader/paper/scheduled-noncapital-owner-postgres-v1.ts",
  "lib/trader/paper/paper-cycle-runner.ts",
  "lib/trader/paper/build-worker-deps.ts",
  "lib/trader/market-data/htx-bar-poll-source.ts",
  "lib/trader/market-data/market-data-gateway.ts",
  "tests/helpers/postgres-commit-ack-loss-proxy.ts",
  "tests/helpers/recorded-paper-public-transport.ts",
  "tests/unit/trader-scheduled-noncapital-owner.test.ts",
  "tests/integration/postgres-scheduled-paper-owner-v1.test.ts",
  "scripts/postgres-validation/dee1205-postgres-proof-contract.mjs",
  "scripts/postgres-validation/prepare-dee1205-postgres-proof.mjs",
  "scripts/postgres-validation/assert-dee1205-postgres-results.mjs",
  "tests/unit/postgres-dee1205-proof-guard.test.ts",
  ".github/workflows/postgres-integration.yml",
];

export const exactCiDatabaseUrl = "postgresql://waia_it:waia_it@127.0.0.1:5432/waia_dee1205";

export function assertExactCiDatabaseTarget(env) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" ||
      env.DATABASE_URL_POSTGRES !== exactCiDatabaseUrl ||
      env.DATABASE_URL_POSTGRES_SESSION !== exactCiDatabaseUrl) {
    throw new Error("DEE1205_POSTGRES_PROOF_REFUSED:EXACT_CI_DATABASE_REQUIRED");
  }
  return exactCiDatabaseUrl;
}

export function assertVitestProofReport(report) {
  const refuse = (reason) => { throw new Error(`DEE1205_POSTGRES_RESULTS_REFUSED:${reason}`); };
  if (!report || !Array.isArray(report.testResults) || report.testResults.length !== requiredSuites.length ||
      !Number.isInteger(report.numTotalTestSuites) || report.numTotalTestSuites <= 0 ||
      report.numPassedTestSuites !== report.numTotalTestSuites || report.numFailedTestSuites !== 0 ||
      report.numPendingTestSuites !== 0 || report.numFailedTests !== 0 || report.numPendingTests !== 0 ||
      report.numTodoTests !== 0 || !Number.isInteger(report.numTotalTests) || report.numTotalTests < 1 ||
      report.numPassedTests !== report.numTotalTests) {
    refuse("SUITE_OR_ASSERTION_COUNTS");
  }
  let assertions = 0;
  for (const path of requiredSuites) {
    const matches = report.testResults.filter((result) => result.name.endsWith(`/${path}`));
    if (matches.length !== 1 || matches[0].status !== "passed" ||
        !Array.isArray(matches[0].assertionResults) || matches[0].assertionResults.length === 0 ||
        matches[0].assertionResults.some((assertion) => assertion.status !== "passed")) {
      refuse(`SUITE_MISSING_FAILED_SKIPPED_OR_EMPTY:${path}`);
    }
    assertions += matches[0].assertionResults.length;
  }
  if (assertions !== report.numTotalTests) refuse("ASSERTION_TOTAL_MISMATCH");
}

export function assertSourceHashes(paths, sha256ByPath, readBytes, hashBytes) {
  for (const path of paths) {
    let bytes;
    try { bytes = readBytes(path); } catch {
      throw new Error(`DEE1205_POSTGRES_SOURCE_REFUSED:SOURCE_FILE_MISSING:${path}`);
    }
    if (hashBytes(bytes) !== sha256ByPath?.[path]) {
      throw new Error(`DEE1205_POSTGRES_SOURCE_REFUSED:SOURCE_FILE_CHANGED:${path}`);
    }
  }
}
