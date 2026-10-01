export const requiredSuites = [
  "tests/integration/postgres-research-experiment-registry-v1.test.ts",
  "tests/integration/postgres-research-attempt-registry-v1.test.ts",
  "tests/integration/postgres-research-training-payload-v1.test.ts",
  "tests/integration/postgres-research-mock-ledger-scope.test.ts",
  "tests/integration/postgres-dee540-blind-tail-max-pool.test.ts",
  "tests/integration/postgres-research-intelligence-parity.test.ts",
  "tests/integration/postgres-research-blind-ingress-v1.test.ts",
  "tests/integration/postgres-research-training-diagnostic-v1.test.ts",
];

export const draftSql = [
  "docs/plans/dee-1159-research-experiment-registration.sql",
  "docs/plans/dee-1159-research-attempt-registration.sql",
  "docs/plans/research-training-diagnostic-registration.sql",
];

export const sourcePaths = [
  "docs/plans/dee-1159-research-executable-identity.md",
  "db/schema.postgres.ts",
  "lib/trader/research/research-experiment-contract-v1.ts",
  "lib/trader/research/research-experiment-registry-postgres-v1.ts",
  "lib/trader/research/research-attempt-registry-postgres-v1.ts",
  "lib/trader/research/research-training-payload-postgres-v1.ts",
  "lib/trader/research/research-training-policy-v1.ts",
  "lib/trader/research/research-training-diagnostic-postgres-v1.ts",
  "lib/trader/research/research-modeled-stage-kernel-v1.ts",
  "lib/trader/research/research-lookback-evaluator-v1.ts",
  "lib/trader/research/dee-540-blind-tail-commit.ts",
  "lib/trader/research/research-orchestrator.ts",
  "lib/trader/research/research-root-postgres-db-v1.ts",
  "lib/trader/execution/historical-mock-ledger-scope.ts",
  "lib/trader/execution/historical-mock-order-repository-postgres.ts",
  "lib/trader/execution/repository-postgres.ts",
  "db/postgres-client.ts",
  "db/postgres-session-transaction.ts",
  "db/postgres-reserved-close-guard.ts",
  "lib/trader/historical-simulation-v2/production-next-cycle-authority-v2.ts",
  "lib/trader/intelligence/evaluation-cycle.ts",
  "lib/trader/intelligence/strategies/registry.ts",
  "lib/trader/paper/paper-cycle-runner.ts",
  "lib/trader/paper/paper-cycle.types.ts",
  "lib/trader/portfolio/default-stop-distance-provider.ts",
  "lib/trader/portfolio/stop-based-sizing.ts",
  "tests/helpers/research-experiment-fixture.ts",
  "tests/unit/trader-research-experiment-contract-v1.test.ts",
  "tests/unit/trader-research-lookback-evaluator-v1.test.ts",
  "tests/unit/trader-research-strategy-selection-v1.test.ts",
  "tests/unit/trader-paper-strategy-selection-forwarding.test.ts",
  "tests/unit/trader-research-stop-based-sizing.test.ts",
  "tests/unit/trader-research-training-policy-v1.test.ts",
  "tests/integration/postgres-research-experiment-registry-v1.test.ts",
  "tests/integration/postgres-research-attempt-registry-v1.test.ts",
  "tests/integration/postgres-research-training-payload-v1.test.ts",
  "tests/integration/postgres-research-training-diagnostic-v1.test.ts",
  "tests/integration/postgres-research-mock-ledger-scope.test.ts",
  "tests/integration/postgres-dee540-blind-tail-max-pool.test.ts",
  "tests/integration/postgres-research-intelligence-parity.test.ts",
  "tests/integration/postgres-research-blind-ingress-v1.test.ts",
  ...draftSql,
  "docs/plans/dee-1200-registered-training-diagnostic.md",
  ".github/workflows/postgres-integration.yml",
  "scripts/postgres-validation/dee1200-postgres-proof-contract.mjs",
  "scripts/postgres-validation/prepare-dee1200-research-proof.mjs",
  "scripts/postgres-validation/assert-dee1200-postgres-results.mjs",
  "scripts/postgres-validation/dee1200-postgres-proof-contract.mjs",
  "tests/fixtures/dee1200-seven-suite-vitest-base.json",
  "tests/unit/postgres-dee1200-proof-guard.test.ts",
];

export function assertVitestProofReport(report) {
  const refuse = (reason) => { throw new Error(`DEE1200_POSTGRES_RESULTS_REFUSED:${reason}`); };
  if (!report || !Array.isArray(report.testResults) || report.testResults.length !== requiredSuites.length ||
      !Number.isInteger(report.numTotalTestSuites) || report.numTotalTestSuites <= 0 ||
      report.numPassedTestSuites !== report.numTotalTestSuites || report.numFailedTestSuites !== 0 ||
      report.numPendingTestSuites !== 0 || report.numFailedTests !== 0 || report.numPendingTests !== 0 ||
      report.numTodoTests !== 0 || !Number.isInteger(report.numTotalTests) || report.numTotalTests < requiredSuites.length ||
      report.numPassedTests !== report.numTotalTests) {
    refuse("SUITE_OR_ASSERTION_COUNTS");
  }
  let assertionCount = 0;
  for (const path of requiredSuites) {
    const matches = report.testResults.filter((result) => result.name.endsWith(`/${path}`));
    if (matches.length !== 1 || matches[0].status !== "passed" ||
        !Array.isArray(matches[0].assertionResults) || matches[0].assertionResults.length === 0 ||
        matches[0].assertionResults.some((assertion) => assertion.status !== "passed")) {
      refuse(`SUITE_MISSING_FAILED_SKIPPED_OR_EMPTY:${path}`);
    }
    assertionCount += matches[0].assertionResults.length;
  }
  if (assertionCount !== report.numTotalTests) refuse("ASSERTION_TOTAL_MISMATCH");
}

export function assertSourceHashes(paths, sha256ByPath, readBytes, hashBytes) {
  const refuse = (reason) => { throw new Error(`DEE1200_POSTGRES_SOURCE_REFUSED:${reason}`); };
  for (const path of paths) {
    let bytes;
    try { bytes = readBytes(path); } catch { return refuse(`SOURCE_FILE_MISSING:${path}`); }
    if (hashBytes(bytes) !== sha256ByPath?.[path]) refuse(`SOURCE_FILE_CHANGED:${path}`);
  }
}
