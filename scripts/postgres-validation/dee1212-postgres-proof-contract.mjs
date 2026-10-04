import { draftSql as dee1200DraftSql, sourcePaths as dee1200SourcePaths } from "./dee1200-postgres-proof-contract.mjs";
import {
  draftSql as dee1211DraftSql,
  githubPathPatternMatches,
  sourcePaths as dee1211SourcePaths,
  uncoveredSourcePathsForPullRequestWorkflow,
} from "./dee1211-postgres-proof-contract.mjs";

export const databaseName = "waia_hsv2_it_dee1212_issued_training_v2";

export const requiredSuites = [
  "tests/integration/postgres-research-issued-training-v2.test.ts",
];

export const requiredAssertionTitles = [
  "preserves the pre-existing default fixture bytes when no close override is supplied",
  "registers experiment and issued attempt through explicit CLI branches with durable retry and no scoring",
  "runs an actual issued DEVELOPMENT attempt and exact retry commits one nonqualifying ledger",
  "refuses unknown and V1-shadow attempts without stage effects",
  "refuses runtime, trial, and policy before revoked market payload access",
  "enforces the byte budget for observation, gap, and training before materialization",
  "refuses cross-org, wrong-trial, changed-runtime, and unsupported-policy requests before effects",
  "captures the strict request synchronously before caller mutation",
  "serializes simultaneous requests into one result and one actual execution ledger",
  "refuses a corrupted source row before any diagnostic result or execution effect",
  "revalidates and refuses same-count order, fill, economics, or frontier changes",
  "refuses self-resealed top-level source, spec, or train identity changes",
  "rolls back all stage rows when the V2 result insert fails",
  "reports committed execution after a real COMMIT acknowledgment is withheld",
  "returns no trace when commit confirmation is unavailable, then explicit retry replays persisted rows",
  "refuses an exact frontier primary-key 23505 when no committed V2 result exists",
  "preserves exact ledgers after bounded cross-attempt serialization refusals",
];

export const draftSql = [...new Set([
  ...dee1200DraftSql,
  ...dee1211DraftSql,
  "docs/plans/dee-1212-issued-training-diagnostic.sql",
])];

const dee1212Paths = [
  "docs/plans/dee-1212-issued-training-diagnostic.md",
  "docs/plans/dee-1212-issued-training-diagnostic.sql",
  "lib/enforce-server-only.ts",
  "lib/trader/execution/deterministic-execution-id.ts",
  "lib/trader/execution/historical-execution-model.ts",
  "lib/trader/research/research-issued-training-contract-v2.ts",
  "lib/trader/research/research-issued-training-diagnostic-postgres-v2.ts",
  "lib/trader/research/research-modeled-stage-source-v1.ts",
  "lib/trader/research/research-training-trace-internal-v1.ts",
  "scripts/trader/discovery-run.ts",
  "scripts/trader/discovery-registration.ts",
  "tests/unit/trader-discovery-registration-cli.test.ts",
  "scripts/postgres-validation/dee1212-postgres-proof-contract.mjs",
  "scripts/postgres-validation/prepare-dee1212-issued-training-proof.mjs",
  "scripts/postgres-validation/assert-dee1212-postgres-results.mjs",
  "tests/helpers/research-development-source-fixture-v1.ts",
  "tests/integration/postgres-research-issued-training-v2.test.ts",
  "tests/unit/trader-discovery-issued-training-cli.test.ts",
  "tests/unit/trader-research-issued-training-contract-v2.test.ts",
  "tests/unit/postgres-dee1212-proof-guard.test.ts",
];

export const sourcePaths = [...new Set([
  ...dee1200SourcePaths,
  ...dee1211SourcePaths,
  ...dee1212Paths,
])];

export { githubPathPatternMatches, uncoveredSourcePathsForPullRequestWorkflow };

export function assertSourceHashes(paths, sha256ByPath, readBytes, hashBytes) {
  const refuse = (reason) => { throw new Error(`DEE1212_POSTGRES_SOURCE_REFUSED:${reason}`); };
  if (!Array.isArray(paths) || !sha256ByPath || typeof sha256ByPath !== "object") refuse("MANIFEST_SHAPE");
  for (const path of paths) {
    let bytes;
    try { bytes = readBytes(path); } catch { return refuse(`SOURCE_FILE_MISSING:${path}`); }
    if (hashBytes(bytes) !== sha256ByPath[path]) refuse(`SOURCE_FILE_CHANGED:${path}`);
  }
}

export function assertVitestProofReport(report) {
  const refuse = (reason) => { throw new Error(`DEE1212_POSTGRES_RESULTS_REFUSED:${reason}`); };
  if (!report || !Array.isArray(report.testResults) || report.testResults.length !== requiredSuites.length ||
      !Number.isInteger(report.numTotalTestSuites) || report.numTotalTestSuites < requiredSuites.length ||
      report.numPassedTestSuites !== report.numTotalTestSuites || report.numFailedTestSuites !== 0 ||
      report.numPendingTestSuites !== 0 || report.numFailedTests !== 0 || report.numPendingTests !== 0 ||
      report.numTodoTests !== 0 || !Number.isInteger(report.numTotalTests) ||
      report.numTotalTests < requiredAssertionTitles.length || report.numPassedTests !== report.numTotalTests) {
    refuse("SUITE_OR_ASSERTION_COUNTS");
  }
  let assertionCount = 0;
  const titles = [];
  for (const path of requiredSuites) {
    const matches = report.testResults.filter(result => result.name.endsWith(`/${path}`));
    if (matches.length !== 1 || matches[0].status !== "passed" ||
        !Array.isArray(matches[0].assertionResults) || matches[0].assertionResults.length === 0 ||
        matches[0].assertionResults.some(assertion => assertion.status !== "passed")) {
      refuse(`SUITE_MISSING_FAILED_SKIPPED_OR_EMPTY:${path}`);
    }
    assertionCount += matches[0].assertionResults.length;
    titles.push(...matches[0].assertionResults.map(assertion =>
      typeof assertion.title === "string" ? assertion.title : ""));
  }
  if (assertionCount !== report.numTotalTests) refuse("ASSERTION_TOTAL_MISMATCH");
  for (const title of requiredAssertionTitles) {
    if (titles.filter(actual => actual === title).length !== 1) refuse(`REQUIRED_ASSERTION_MISSING_OR_DUPLICATE:${title}`);
  }
}
