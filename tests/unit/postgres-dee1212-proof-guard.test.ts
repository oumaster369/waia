import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSourceHashes,
  assertVitestProofReport,
  databaseName,
  draftSql,
  githubPathPatternMatches,
  requiredAssertionTitles,
  requiredSuites,
  sourcePaths,
  uncoveredSourcePathsForPullRequestWorkflow,
} from "@/scripts/postgres-validation/dee1212-postgres-proof-contract.mjs";

function report() {
  const assertions = requiredAssertionTitles.map(title => ({ title, status: "passed" }));
  return {
    numTotalTestSuites: 2, numPassedTestSuites: 2, numFailedTestSuites: 0, numPendingTestSuites: 0,
    numTotalTests: assertions.length, numPassedTests: assertions.length, numFailedTests: 0,
    numPendingTests: 0, numTodoTests: 0,
    testResults: [{ name: `/workspace/${requiredSuites[0]}`, status: "passed", assertionResults: assertions }],
  };
}

describe("DEE-1212 executed PostgreSQL proof guard", () => {
  it("binds the exact isolated database, single suite, and complete assertion roster", () => {
    expect(databaseName).toBe("waia_hsv2_it_dee1212_issued_training_v2");
    expect(requiredSuites).toEqual(["tests/integration/postgres-research-issued-training-v2.test.ts"]);
    expect(requiredAssertionTitles).toHaveLength(16);
    expect(draftSql).toEqual([
      "docs/plans/dee-1159-research-experiment-registration.sql",
      "docs/plans/dee-1159-research-attempt-registration.sql",
      "docs/plans/research-training-diagnostic-registration.sql",
      "docs/plans/dee-1211-research-source-owner.sql",
      "docs/plans/dee-1212-issued-training-diagnostic.sql",
    ]);
    expect(() => assertVitestProofReport(report())).not.toThrow();
  });

  it("requires every unique source dependency to trigger this PostgreSQL workflow", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/postgres-integration.yml"), "utf8");
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
    expect(sourcePaths).toContain("lib/trader/research/research-issued-training-diagnostic-postgres-v2.ts");
    expect(uncoveredSourcePathsForPullRequestWorkflow(workflow, sourcePaths)).toEqual([]);
    const withoutPlanTrigger = workflow.replace('      - "docs/plans/dee-1212-issued-training-diagnostic.md"\n', "");
    expect(uncoveredSourcePathsForPullRequestWorkflow(withoutPlanTrigger, sourcePaths)).toContain(
      "docs/plans/dee-1212-issued-training-diagnostic.md",
    );
  });

  it("retains the single-star and recursive workflow path semantics", () => {
    expect(githubPathPatternMatches("tests/integration/*", "tests/integration/a.test.ts")).toBe(true);
    expect(githubPathPatternMatches("tests/integration/*", "tests/integration/nested/a.test.ts")).toBe(false);
    expect(githubPathPatternMatches("lib/trader/research/**", "lib/trader/research/nested/a.ts")).toBe(true);
  });

  it.each([
    ["missing suite", (value: ReturnType<typeof report>) => { value.testResults = []; }],
    ["duplicate file", (value: ReturnType<typeof report>) => { value.testResults.push(structuredClone(value.testResults[0]!)); }],
    ["skipped assertion", (value: ReturnType<typeof report>) => { value.testResults[0]!.assertionResults[0]!.status = "skipped"; }],
    ["failed assertion", (value: ReturnType<typeof report>) => { value.testResults[0]!.assertionResults[0]!.status = "failed"; }],
    ["missing required case", (value: ReturnType<typeof report>) => { value.testResults[0]!.assertionResults[0]!.title = "other"; }],
    ["duplicated required case", (value: ReturnType<typeof report>) => { value.testResults[0]!.assertionResults[1]!.title = value.testResults[0]!.assertionResults[0]!.title; }],
    ["empty file result", (value: ReturnType<typeof report>) => { value.testResults[0]!.assertionResults = []; value.numTotalTests = 0; value.numPassedTests = 0; }],
    ["todo count", (value: ReturnType<typeof report>) => { value.numTodoTests = 1; }],
    ["assertion count mismatch", (value: ReturnType<typeof report>) => { value.numTotalTests += 1; value.numPassedTests += 1; }],
    ["nested suite counter mismatch", (value: ReturnType<typeof report>) => { value.numPassedTestSuites = 1; }],
    ["file path mismatch", (value: ReturnType<typeof report>) => { value.testResults[0]!.name = "/workspace/other.test.ts"; }],
  ])("refuses %s", (_label, mutate) => {
    const value = report(); mutate(value);
    expect(() => assertVitestProofReport(value)).toThrow();
  });

  it("refuses missing or changed proof source bytes", () => {
    const bytes = Buffer.from("synthetic source");
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(() => assertSourceHashes(["source.ts"], { "source.ts": digest }, () => bytes,
      (input: Uint8Array) => createHash("sha256").update(input).digest("hex"))).not.toThrow();
    expect(() => assertSourceHashes(["source.ts"], { "source.ts": "0".repeat(64) }, () => bytes,
      (input: Uint8Array) => createHash("sha256").update(input).digest("hex"))).toThrow(/SOURCE_FILE_CHANGED/);
    expect(() => assertSourceHashes(["missing.ts"], {}, () => { throw new Error("missing"); },
      (input: Uint8Array) => createHash("sha256").update(input).digest("hex"))).toThrow(/SOURCE_FILE_MISSING/);
  });
});
