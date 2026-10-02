import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSourceHashes,
  assertVitestProofReport,
  assertFreshResearchDraftSchema,
  databaseName,
  draftSql,
  requiredAssertionTitles,
  requiredSuites,
  sourcePaths,
  uncoveredSourcePathsForPullRequestWorkflow,
} from "@/scripts/postgres-validation/dee1222-postgres-proof-contract.mjs";

function report() {
  const assertions = requiredAssertionTitles.map(title => ({ title, status: "passed" }));
  return {
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: assertions.length,
    numPassedTests: assertions.length,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [{ name: `/workspace/${requiredSuites[0]}`, status: "passed", assertionResults: assertions }],
  };
}

describe("DEE-1222 executed PostgreSQL proof guard", () => {
  it("binds the exact fresh database, draft set, single suite, and complete named assertion roster", () => {
    expect(databaseName).toBe("waia_hsv2_it_dee1222_complete_training_family_v1");
    expect(requiredSuites).toEqual(["tests/integration/postgres-research-family-selection-v1.test.ts"]);
    expect(requiredAssertionTitles).toHaveLength(13);
    expect(new Set(requiredAssertionTitles).size).toBe(requiredAssertionTitles.length);
    expect(draftSql).toEqual([
      "docs/plans/dee-1159-research-experiment-registration.sql",
      "docs/plans/dee-1159-research-attempt-registration.sql",
      "docs/plans/research-training-diagnostic-registration.sql",
      "docs/plans/dee-1211-research-source-owner.sql",
      "docs/plans/dee-1212-issued-training-diagnostic.sql",
      "docs/plans/dee-1222-complete-training-family.sql",
    ]);
    expect(() => assertVitestProofReport(report())).not.toThrow();
  });

  it("accepts only a wholly fresh upstream draft schema before applying the ordered drafts", () => {
    const fresh = {
      experiments: null,
      attempts: null,
      diagnostics_v1: null,
      source_runs: null,
      issued_attempts: null,
      issued_diagnostics: null,
      selections: null,
      append_function: null,
      mutation_guard: "public.trader_discovery_loop_reject_mutation()",
      issued_tuple_constraint: 0,
    };
    expect(() => assertFreshResearchDraftSchema(fresh)).not.toThrow();
    for (const key of [
      "experiments", "attempts", "diagnostics_v1", "source_runs", "issued_attempts",
      "issued_diagnostics", "selections", "append_function",
    ] as const) {
      expect(() => assertFreshResearchDraftSchema({ ...fresh, [key]: `public.${key}` })).toThrow(/FRESH_RESEARCH_DRAFT_SCHEMA_REQUIRED/);
    }
    expect(() => assertFreshResearchDraftSchema({ ...fresh, mutation_guard: null }))
      .toThrow(/FRESH_RESEARCH_DRAFT_SCHEMA_REQUIRED/);
    expect(() => assertFreshResearchDraftSchema({ ...fresh, issued_tuple_constraint: 1 }))
      .toThrow(/FRESH_RESEARCH_DRAFT_SCHEMA_REQUIRED/);
    const incomplete = { ...fresh } as Partial<typeof fresh>;
    delete incomplete.source_runs;
    expect(() => assertFreshResearchDraftSchema(incomplete)).toThrow(/FRESH_RESEARCH_DRAFT_SCHEMA_REQUIRED/);
  });

  it("requires every unique source dependency to trigger this PostgreSQL workflow", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/postgres-integration.yml"), "utf8");
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
    expect(sourcePaths).toContain("lib/trader/research/research-training-family-contract-v1.ts");
    expect(sourcePaths).toContain("tests/integration/postgres-research-family-selection-v1.test.ts");
    expect(sourcePaths).toContain("tests/unit/trader-discovery-family-selection-cli.test.ts");
    expect(sourcePaths).toContain("lib/trader/accounting/accounting-frontier-serialization.ts");
    expect(sourcePaths).toContain("lib/trader/accounting/accounting-frontier.types.ts");
    expect(sourcePaths).toContain("lib/trader/risk/drawdown-policy-evaluator.ts");
    expect(sourcePaths).toContain("lib/trader/risk/strategy-attribution.ts");
    expect(sourcePaths).toContain("lib/trader/execution/types.ts");
    expect(uncoveredSourcePathsForPullRequestWorkflow(workflow, sourcePaths)).toEqual([]);

    const withoutNativeTrigger = workflow.replace('      - "tests/integration/postgres-research-family-selection-v1.test.ts"\n', "");
    expect(uncoveredSourcePathsForPullRequestWorkflow(withoutNativeTrigger, sourcePaths))
      .toContain("tests/integration/postgres-research-family-selection-v1.test.ts");
    for (const path of [
      "tests/unit/trader-discovery-family-selection-cli.test.ts",
      "lib/trader/accounting/accounting-frontier-repository-postgres.ts",
      "lib/trader/accounting/accounting-frontier-serialization.ts",
      "lib/trader/accounting/accounting-frontier.types.ts",
      "lib/trader/accounting/canonical-cross-backend-accounting-engine.ts",
      "lib/trader/risk/drawdown-policy-evaluator.ts",
      "lib/trader/risk/strategy-attribution.ts",
      "lib/trader/execution/order-state-machine.ts",
      "lib/trader/execution/types.ts",
    ]) {
      const pathTrigger = `      - "${path}"\n`;
      expect(workflow).toContain(pathTrigger);
      expect(uncoveredSourcePathsForPullRequestWorkflow(workflow.replace(pathTrigger, ""), sourcePaths))
        .toContain(path);
    }
  });

  const invalidReports: Array<[string, (value: ReturnType<typeof report>) => void]> = [
    ["missing suite", value => { value.testResults = []; }],
    ["duplicate file", value => { value.testResults.push(structuredClone(value.testResults[0]!)); }],
    ["skipped case", value => { value.testResults[0]!.assertionResults[0]!.status = "skipped"; }],
    ["failed case", value => { value.testResults[0]!.assertionResults[0]!.status = "failed"; }],
    ["missing required case", value => { value.testResults[0]!.assertionResults[0]!.title = "other"; }],
    ["extra unregistered case", value => {
      value.testResults[0]!.assertionResults[0]!.title = "extra";
      value.testResults[0]!.assertionResults.push({ title: requiredAssertionTitles[0]!, status: "passed" });
      value.numTotalTests += 1; value.numPassedTests += 1;
    }],
    ["duplicate required case", value => {
      value.testResults[0]!.assertionResults[1]!.title = value.testResults[0]!.assertionResults[0]!.title;
    }],
    ["todo count", value => { value.numTodoTests = 1; }],
    ["assertion total mismatch", value => { value.numTotalTests += 1; value.numPassedTests += 1; }],
    ["failed suite rollup", value => { value.numPassedTestSuites = 0; }],
    ["wrong file path", value => { value.testResults[0]!.name = "/workspace/other.test.ts"; }],
  ];

  it.each(invalidReports)("refuses %s", (_label, mutate) => {
    const value = report();
    mutate(value);
    expect(() => assertVitestProofReport(value)).toThrow();
  });

  it("refuses missing or changed source bytes", () => {
    const bytes = Buffer.from("synthetic source");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const hashBytes = (input: Uint8Array) => createHash("sha256").update(input).digest("hex");
    expect(() => assertSourceHashes(["source.ts"], { "source.ts": digest }, () => bytes, hashBytes)).not.toThrow();
    expect(() => assertSourceHashes(["source.ts"], { "source.ts": "0".repeat(64) }, () => bytes, hashBytes))
      .toThrow(/SOURCE_FILE_CHANGED/);
    expect(() => assertSourceHashes(["missing.ts"], {}, () => { throw new Error("missing"); }, hashBytes))
      .toThrow(/SOURCE_FILE_MISSING/);
  });
});
