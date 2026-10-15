export const requiredSuites = [
  "tests/integration/postgres-research-development-source-v1.test.ts",
];

export const requiredAssertionTitles = [
  "issues from loaded bytes, commits exact rows and returns the same result on retry",
  "refuses generic owner login, wrong Org0 and a pool masquerading as a pinned transaction before issuance",
  "rejects a poisoned writer capability: table grant",
  "rejects a poisoned writer capability: table owner",
  "rejects a poisoned writer capability: schema grant option",
  "rejects a poisoned writer capability: role admin option",
  "rejects a poisoned writer capability: disabled RLS",
  "rejects a poisoned writer capability: public definer",
  "serializes two real connections to one committed source and one replay",
  "rolls back nested dataset writes when issuance insertion fails",
  "confirms a real committed source after its COMMIT response is lost",
  "returns uncertain without claiming success when post-COMMIT confirmation cannot reconnect",
  "refuses changed selection, deployment and raw source bytes without adding a source",
  "rejects a mutated volume qualification receipt before creating dataset or issuance rows",
  "captures the original command before the first await when the caller mutates immediately",
  "registers only an exact source-bound experiment and rereads its issued training snapshot",
  "refuses an experiment whose observation cutoff does not match the issued source before attempt insertion",
  "detects a self-consistent resealed source row against the immutable issuance rowset",
  "does not reuse an attempt command across two independently valid source bindings",
];

export const draftSql = [
  "docs/plans/dee-1159-research-experiment-registration.sql",
  "docs/plans/dee-1159-research-attempt-registration.sql",
  "docs/plans/research-training-diagnostic-registration.sql",
  "docs/plans/dee-1211-research-source-owner.sql",
];

export const databaseName = "waia_hsv2_it_dee1211_source_owner_v1";

export const sourcePaths = [
  "db/schema.postgres.ts",
  "db/postgres-client.ts",
  "db/postgres-session-transaction.ts",
  "lib/trader/research/research-development-source-contract-v1.ts",
  "lib/trader/research/research-development-evaluation-ranges-v1.ts",
  "lib/trader/research/research-development-source-role-v1.ts",
  "lib/trader/research/research-development-source-read-v1.ts",
  "lib/trader/research/research-development-source-owner-postgres-v1.ts",
  "lib/trader/research/research-owned-postgres-pool-v1.ts",
  "package.json",
  "pnpm-lock.yaml",
  "lib/trader/research/research-issued-attempt-postgres-v2.ts",
  "lib/trader/research/research-experiment-contract-v1.ts",
  "lib/trader/research/research-experiment-registry-postgres-v1.ts",
  "lib/trader/research/research-executable-runtime-identity-v1.ts",
  "lib/trader/research/digest.ts",
  "lib/trader/historical-simulation-v2/canonical-verification-receipt-postgres-v2.ts",
  "lib/trader/historical-simulation-v2/production-next-cycle-authority-v2.ts",
  "lib/trader/historical-simulation-v2/postgres-session-transaction-v2.ts",
  "lib/trader/historical-simulation-v2/bootstrap-source-loader-v2.ts",
  "lib/trader/historical-simulation-v2/development-source-corpus-v2.ts",
  "lib/trader/historical-simulation-v2/dataset-membership-v2.ts",
  "lib/trader/historical-simulation-v2/modeled-execution-advance-v2.ts",
  "lib/trader/market-data/bounded-json-file.ts",
  "lib/trader/market-data/fhv-acquisition-evidence-class.ts",
  "lib/trader/market-data/fhv-bars-v2-ndjson.ts",
  "lib/trader/market-data/fhv-canonical-coverage.ts",
  "lib/trader/market-data/fhv-dataset-manifest-v2.ts",
  "lib/trader/market-data/fhv-dataset-seal.ts",
  "lib/trader/market-data/fhv-ndjson-bounded-io.ts",
  "lib/trader/market-data/fhv-official-dataset-reader.ts",
  "lib/trader/market-data/fhv-pre-holdout-qualification.ts",
  "lib/trader/market-data/fhv-pre-holdout-runtime-requalification.ts",
  "lib/trader/market-data/fhv-real-htx-acquisition.ts",
  "lib/trader/market-data/fhv-revision-risk-evidence.ts",
  "lib/trader/market-data/fhv-streaming-bar-digest.ts",
  "lib/trader/market-data/fhv-streaming-bar-set-digest.ts",
  "lib/trader/market-data/bar-content-digest.ts",
  "lib/trader/market-data/dataset/fhv-dataset-manifest.ts",
  "lib/trader/market-data/research-dataset.ts",
  "lib/trader/market-data/research-dataset-repository-postgres.ts",
  "lib/trader/market-data/fhv-blind-holdout-firewall.ts",
  "lib/trader/market-data/fhv-partition-boundaries.ts",
  "lib/trader/market-data/ingress/bar-integrity-gate.ts",
  "lib/trader/market-data/volume-qualification/htx-volume-qualification.ts",
  "lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service.ts",
  "lib/trader/observability/fhv-partition-receipt.ts",
  "lib/trader/backtest/historical-execution-profile.ts",
  "lib/trader/backtest/streaming-evidence/atomic-file-write.ts",
  "lib/trader/backtest/streaming-evidence/streaming-evidence-manifest.ts",
  "lib/trader/intelligence/htr-semantic-canonical-json.ts",
  "lib/trader/intelligence/types.ts",
  "lib/trader/intelligence/information-inquiry/contracts-v1.ts",
  "tests/helpers/research-development-source-fixture-v1.ts",
  "tests/helpers/research-experiment-fixture.ts",
  "tests/helpers/postgres-commit-ack-loss-proxy.ts",
  "tests/integration/postgres-research-development-source-v1.test.ts",
  "tests/unit/research-development-source-contract-v1.test.ts",
  "tests/unit/research-development-evaluation-ranges-v1.test.ts",
  "tests/unit/trader-research-owned-postgres-pool-v1.test.ts",
  "tests/unit/fhv-bounded-json-file.test.ts",
  "tests/unit/historical-simulation-bootstrap-source-loader-v2.test.ts",
  "tests/unit/trader-discovery-source-preparation-cli.test.ts",
  "tests/unit/trader-research-executable-runtime-identity-v1.test.ts",
  "docs/plans/dee-1211-research-source-owner.md",
  "docs/plans/dee-1203-research-executable-runtime-binding.md",
  "scripts/trader/discovery-run.ts",
  "scripts/postgres-validation/dee1211-postgres-proof-contract.mjs",
  "scripts/postgres-validation/prepare-dee1211-development-source-proof.mjs",
  "scripts/postgres-validation/assert-dee1211-postgres-results.mjs",
  "tests/unit/postgres-dee1211-proof-guard.test.ts",
  ".github/workflows/postgres-integration.yml",
  ...requiredSuites,
  ...draftSql,
];

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
  const refuse = (reason) => { throw new Error(`DEE1211_POSTGRES_SOURCE_REFUSED:${reason}`); };
  if (!Array.isArray(paths) || !sha256ByPath || typeof sha256ByPath !== "object") refuse("MANIFEST_SHAPE");
  for (const path of paths) {
    let bytes;
    try { bytes = readBytes(path); } catch { return refuse(`SOURCE_FILE_MISSING:${path}`); }
    if (hashBytes(bytes) !== sha256ByPath[path]) refuse(`SOURCE_FILE_CHANGED:${path}`);
  }
}

export function assertVitestProofReport(report) {
  const refuse = (reason) => { throw new Error(`DEE1211_POSTGRES_RESULTS_REFUSED:${reason}`); };
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
