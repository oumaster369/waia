import { draftSql as dee1212DraftSql, sourcePaths as dee1212SourcePaths,
  githubPathPatternMatches, uncoveredSourcePathsForPullRequestWorkflow } from "./dee1212-postgres-proof-contract.mjs";

export const databaseName = "waia_hsv2_it_dee1222_complete_training_family_v1";

const freshDraftSchemaObjects = [
  "experiments",
  "attempts",
  "diagnostics_v1",
  "source_runs",
  "issued_attempts",
  "issued_diagnostics",
  "selections",
  "append_function",
];

export function assertFreshResearchDraftSchema(snapshot) {
  const refuse = () => { throw new Error("DEE1222_POSTGRES_PROOF_REFUSED:FRESH_RESEARCH_DRAFT_SCHEMA_REQUIRED"); };
  if (!snapshot || typeof snapshot !== "object" ||
      freshDraftSchemaObjects.some(key => !Object.hasOwn(snapshot, key) || snapshot[key] !== null) ||
      !Object.hasOwn(snapshot, "mutation_guard") || snapshot.mutation_guard === null ||
      snapshot.issued_tuple_constraint !== 0) refuse();
}

export const requiredSuites = [
  "tests/integration/postgres-research-family-selection-v1.test.ts",
];

export const requiredAssertionTitles = [
  "selects a complete zero-trade family and replays the exact immutable receipt",
  "preserves exact metrics and selects the declared best complete trading trial",
  "refuses a missing declared trial without running it or selecting a partial family",
  "refuses the whole family when an actual diagnostic ends with an open position",
  "rejects a foreign-organization attempt before any modeled or selection effects",
  "refuses selection when current release identity differs from issued diagnostics",
  "refuses selection after current accounting frontier corruption",
  "refuses the whole family when an actual diagnostic leaves a pending order",
  "refuses a self-resealed trace metric that no longer matches terminal accounting",
  "commits one identical family receipt for concurrent selection calls",
  "rolls back the family receipt when its insert fails",
  "confirms a committed receipt after a real COMMIT acknowledgment is withheld",
  "returns no receipt when confirmation is unavailable, then explicit retry replays",
];

export const draftSql = [...new Set([
  ...dee1212DraftSql,
  "docs/plans/dee-1222-complete-training-family.sql",
])];

const dee1222Paths = [
  "docs/plans/dee-1222-complete-training-family.md",
  "docs/plans/dee-1222-complete-training-family.sql",
  "lib/trader/risk/numeric.ts",
  "lib/trader/research/research-training-family-contract-v1.ts",
  "scripts/postgres-validation/dee1222-postgres-proof-contract.mjs",
  "scripts/postgres-validation/prepare-dee1222-family-selection-proof.mjs",
  "scripts/postgres-validation/assert-dee1222-postgres-results.mjs",
  "tests/integration/postgres-research-family-selection-v1.test.ts",
  "tests/unit/trader-research-training-family-contract-v1.test.ts",
  "tests/unit/postgres-dee1222-proof-guard.test.ts",
  ".github/workflows/postgres-integration.yml",
  "package.json",
  "pnpm-lock.yaml",
  "tests/unit/trader-discovery-family-selection-cli.test.ts",
  "lib/trader/accounting/accounting-frontier-repository-postgres.ts",
  "lib/trader/accounting/accounting-frontier-serialization.ts",
  "lib/trader/accounting/accounting-frontier.types.ts",
  "lib/trader/accounting/canonical-cross-backend-accounting-engine.ts",
  "lib/trader/risk/drawdown-policy-evaluator.ts",
  "lib/trader/risk/strategy-attribution.ts",
  "lib/trader/execution/order-state-machine.ts",
  "lib/trader/execution/types.ts",
];

export const sourcePaths = [...new Set([...dee1212SourcePaths, ...dee1222Paths])];
export { githubPathPatternMatches, uncoveredSourcePathsForPullRequestWorkflow };

export function assertSourceHashes(paths, sha256ByPath, readBytes, hashBytes) {
  const refuse = reason => { throw new Error(`DEE1222_POSTGRES_SOURCE_REFUSED:${reason}`); };
  if (!Array.isArray(paths) || !sha256ByPath || typeof sha256ByPath !== "object") refuse("MANIFEST_SHAPE");
  for (const path of paths) {
    let bytes;
    try { bytes = readBytes(path); } catch { return refuse(`SOURCE_FILE_MISSING:${path}`); }
    if (hashBytes(bytes) !== sha256ByPath[path]) refuse(`SOURCE_FILE_CHANGED:${path}`);
  }
}

export function assertVitestProofReport(report) {
  const refuse = reason => { throw new Error(`DEE1222_POSTGRES_RESULTS_REFUSED:${reason}`); };
  if (!report || !Array.isArray(report.testResults) || report.testResults.length !== requiredSuites.length ||
      !Number.isInteger(report.numTotalTestSuites) || report.numTotalTestSuites < 1 ||
      report.numPassedTestSuites !== report.numTotalTestSuites || report.numFailedTestSuites !== 0 ||
      report.numPendingTestSuites !== 0 || report.numFailedTests !== 0 || report.numPendingTests !== 0 ||
      report.numTodoTests !== 0 || report.numTotalTests !== requiredAssertionTitles.length ||
      report.numPassedTests !== report.numTotalTests) refuse("SUITE_OR_ASSERTION_COUNTS");

  let assertionCount = 0;
  const actualTitles = [];
  for (const path of requiredSuites) {
    const matches = report.testResults.filter(result => result.name.endsWith(`/${path}`));
    if (matches.length !== 1 || matches[0].status !== "passed" ||
        !Array.isArray(matches[0].assertionResults) || matches[0].assertionResults.length === 0 ||
        matches[0].assertionResults.some(assertion => assertion.status !== "passed")) {
      refuse(`SUITE_MISSING_FAILED_SKIPPED_OR_EMPTY:${path}`);
    }
    assertionCount += matches[0].assertionResults.length;
    actualTitles.push(...matches[0].assertionResults.map(assertion =>
      typeof assertion.title === "string" ? assertion.title : ""));
  }
  if (assertionCount !== report.numTotalTests || actualTitles.length !== requiredAssertionTitles.length ||
      new Set(actualTitles).size !== requiredAssertionTitles.length ||
      requiredAssertionTitles.some(title => actualTitles.filter(actual => actual === title).length !== 1)) {
    refuse("ASSERTION_ROSTER_MISMATCH");
  }
}
