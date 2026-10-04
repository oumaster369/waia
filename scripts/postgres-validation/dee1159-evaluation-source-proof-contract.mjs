import { draftSql as trainingDrafts, sourcePaths as trainingSources } from "./dee1211-postgres-proof-contract.mjs";
export const databaseName = "waia_hsv2_it_dee1159_eval_source_v1";
export const requiredSuites = ["tests/integration/postgres-research-evaluation-source-v1.test.ts"];
export const requiredAssertionTitles = [
  "commits exact indexed rows and metadata, then returns the immutable retry without payload",
  "refuses missing and forged training issuance bindings without partial writes",
  "refuses changed selection under the same command and corrupt source without partial rows",
  "refuses a saved evaluation row moved out of its committed run on retry",
  "serializes concurrent callers into one committed evaluation and one replay",
  "enforces fixed-org RLS against DB-shaped foreign rows and prevents training-source inserts",
  "protects committed evaluation receipts against update, delete and truncate",
  "rolls back all evaluation rows when issuance insertion fails",
  "refuses generic sessions and a training login for evaluation-source writes",
  "confirms a committed issuance after its COMMIT response is lost",
  "returns no issuance when commit recovery cannot reconnect and does not leak sessions",
  "rejects a poisoned evaluation writer capability: table grant",
  "rejects a poisoned evaluation writer capability: table owner",
  "rejects a poisoned evaluation writer capability: role admin option",
  "rejects a poisoned evaluation writer capability: disabled RLS",
  "rejects a poisoned evaluation writer capability: public definer"
];
export const draftSql = [...trainingDrafts, "docs/plans/dee-1159-evaluation-source-owner.sql"];
export const sourcePaths = [...new Set([
  ...trainingSources,
  "lib/trader/research/research-development-evaluation-source-contract-v1.ts",
  "lib/trader/research/research-development-evaluation-source-snapshot-v1.ts",
  "lib/trader/research/research-development-evaluation-source-issuance-v1.ts",
  "lib/trader/research/research-development-evaluation-source-owner-postgres-v1.ts",
  "lib/trader/research/research-development-evaluation-source-read-v1.ts",
  "lib/trader/research/research-development-evaluation-source-role-v1.ts",
  "lib/trader/historical-simulation-v2/dataset-registration-identity-v2.ts",
  "tests/unit/research-development-evaluation-source-v1.test.ts",
  "tests/unit/postgres-dee1159-evaluation-source-proof-guard.test.ts",
  "scripts/postgres-validation/dee1159-evaluation-source-proof-contract.mjs",
  "scripts/postgres-validation/prepare-dee1159-evaluation-source-proof.mjs",
  "scripts/postgres-validation/assert-dee1159-evaluation-source-results.mjs",
  ...requiredSuites, ...draftSql,
])];

function pullRequestPathFilters(workflowText) {
  const pullRequestStart = workflowText.indexOf("\n  pull_request:");
  const envStart = workflowText.indexOf("\nenv:", pullRequestStart);
  if (pullRequestStart < 0 || envStart < 0) return [];

  const trigger = workflowText.slice(pullRequestStart, envStart);
  const pathsStart = trigger.indexOf("\n    paths:");
  if (pathsStart < 0) return [];
  const pathLines = trigger.slice(pathsStart).match(/^      -\s+(?:"[^"]+"|'[^']+'|[^\s#]+)\s*$/gm) ?? [];
  return pathLines.map((line) => {
    const scalar = line.replace(/^      -\s+/, "").trim();
    return scalar.startsWith('"') || scalar.startsWith("'") ? scalar.slice(1, -1) : scalar;
  });
}

export function githubPathPatternMatches(pattern, path) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`).test(path);
}

export function uncoveredSourcePathsForPullRequestWorkflow(workflowText, paths = sourcePaths) {
  const patterns = pullRequestPathFilters(workflowText);
  return [...new Set(paths)].filter((path) => !patterns.some((pattern) => githubPathPatternMatches(pattern, path)));
}

export function assertSourceHashes(paths, sha256ByPath, readBytes, hashBytes) {
  const refuse = (reason) => { throw new Error(`DEE1159_EVALUATION_SOURCE_POSTGRES_SOURCE_REFUSED:${reason}`); };
  if (!Array.isArray(paths) || !sha256ByPath || typeof sha256ByPath !== "object") refuse("MANIFEST_SHAPE");
  for (const path of paths) {
    let bytes;
    try { bytes = readBytes(path); } catch { return refuse(`SOURCE_FILE_MISSING:${path}`); }
    if (hashBytes(bytes) !== sha256ByPath[path]) refuse(`SOURCE_FILE_CHANGED:${path}`);
  }
}

export function assertVitestProofReport(report) {
  const refuse = (reason) => { throw new Error(`DEE1159_EVALUATION_SOURCE_POSTGRES_RESULTS_REFUSED:${reason}`); };
  if (!report || !Array.isArray(report.testResults) || report.testResults.length !== requiredSuites.length ||
      !Number.isInteger(report.numTotalTestSuites) || report.numTotalTestSuites < requiredSuites.length ||
      report.numPassedTestSuites !== report.numTotalTestSuites ||
      report.numFailedTestSuites !== 0 || report.numPendingTestSuites !== 0 || report.numFailedTests !== 0 ||
      report.numPendingTests !== 0 || report.numTodoTests !== 0 || !Number.isInteger(report.numTotalTests) ||
      report.numTotalTests < requiredAssertionTitles.length || report.numPassedTests !== report.numTotalTests) refuse("SUITE_OR_ASSERTION_COUNTS");
  let assertions = 0;
  for (const path of requiredSuites) {
    const matches = report.testResults.filter(result => result.name.endsWith(`/${path}`));
    if (matches.length !== 1 || matches[0].status !== "passed" || !Array.isArray(matches[0].assertionResults) ||
        matches[0].assertionResults.length === 0 || matches[0].assertionResults.some(item => item.status !== "passed")) {
      refuse(`SUITE_MISSING_FAILED_SKIPPED_OR_EMPTY:${path}`);
    }
    assertions += matches[0].assertionResults.length;
  }
  if (assertions !== report.numTotalTests) refuse("ASSERTION_TOTAL_MISMATCH");
  const titles = report.testResults.flatMap(result => result.assertionResults
    .map(item => typeof item.title === "string" ? item.title : ""));
  for (const title of requiredAssertionTitles) {
    if (titles.filter(candidate => candidate === title).length !== 1) refuse(`REQUIRED_ASSERTION_MISSING_OR_DUPLICATE:${title}`);
  }
}
