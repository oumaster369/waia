/** Executed, source-bound PostgreSQL proof for the closed scheduled NO_TRADE owner. */
export const requiredSuites = [
  "tests/integration/postgres-scheduled-paper-owner-v1.test.ts",
];

export const requiredCaseTitles = [
  "keeps the disabled scheduled owner as a no-op without requiring a database or market input",
  "rejects a pool miscast as a held transaction and commits through the real closed owner",
  "serializes mixed-case UUID callers, persists one receipt, and serves an exact retry",
  "refuses changed same-bar input and does not create a second receipt or execution effect",
  "rolls back risk initialization and receipt on an actual receipt-write failure, with no completion telemetry",
  "refuses a stale polled bar before initialization or receipt persistence",
  "confirms a real commit after the loopback proxy withholds its COMMIT acknowledgment",
  "bounds post-COMMIT uncertainty when verifier startups receive repeated clean EOF (DEE-1213)",
  "bounds initial clean EOF startup without durable effects (DEE-1213)",
  "bounds initial silent startup without durable effects (DEE-1213)",
  "joins an aborted in-flight transaction and proves rollback (DEE-1213)",
  "preserves an acknowledged native COMMIT when cancellation starts before pool cleanup (DEE-1213)",
  "preserves full historical rows, rejects half-tagged writes, and refuses ordinary paper orders",
  "allows two different organizations to commit concurrently under separate fixed-domain locks",
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
  "lib/trader/paper/scheduled-owned-postgres-transport-v1.ts",
  "lib/trader/paper/scheduled-owned-postgres-pool-v1.ts",
  "docs/plans/dee-1213-scheduled-db-deadline.md",
  "tests/stubs/cloudflare-sockets.ts",
  "tests/unit/trader-scheduled-postgres-dsn-profile.test.ts",
  "tests/unit/trader-scheduled-postgres-pool-lifetime.test.ts",
  "scripts/postgres-validation/dee1205-postgres-proof-contract.mjs",
  "scripts/postgres-validation/prepare-dee1205-postgres-proof.mjs",
  "scripts/postgres-validation/assert-dee1205-postgres-results.mjs",
  "scripts/postgres-validation/probe-dee1213-worker-transport.mjs",
  "scripts/postgres-validation/probe-dee1213-worker-pool.mjs",
  "tests/unit/postgres-dee1205-proof-guard.test.ts",
  "vitest.config.ts",
  "vitest.setup.ts",
  ".github/workflows/postgres-integration.yml",
  "package.json",
  "pnpm-lock.yaml",
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
  const observedTitles = [];
  for (const path of requiredSuites) {
    const matches = report.testResults.filter((result) => result.name.endsWith(`/${path}`));
    if (matches.length !== 1 || matches[0].status !== "passed" ||
        !Array.isArray(matches[0].assertionResults) || matches[0].assertionResults.length === 0 ||
        matches[0].assertionResults.some((assertion) => assertion.status !== "passed" ||
          typeof assertion.title !== "string" || !assertion.title)) {
      refuse(`SUITE_MISSING_FAILED_SKIPPED_OR_EMPTY:${path}`);
    }
    observedTitles.push(...matches[0].assertionResults.map((assertion) => assertion.title));
    assertions += matches[0].assertionResults.length;
  }
  if (assertions !== report.numTotalTests) refuse("ASSERTION_TOTAL_MISMATCH");
  if (observedTitles.length !== requiredCaseTitles.length ||
      requiredCaseTitles.some((title) => observedTitles.filter((observed) => observed === title).length !== 1) ||
      observedTitles.some((title) => !requiredCaseTitles.includes(title))) {
    refuse("ASSERTION_TITLE_ROSTER_MISMATCH");
  }
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
