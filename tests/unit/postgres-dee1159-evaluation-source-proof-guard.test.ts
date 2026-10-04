import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSourceHashes, assertVitestProofReport, draftSql, githubPathPatternMatches, requiredAssertionTitles, requiredAssertionTitlesBySuite, requiredSuites, sourcePaths, uncoveredSourcePathsForPullRequestWorkflow } from "@/scripts/postgres-validation/dee1159-evaluation-source-proof-contract.mjs";

function report() {
  const testResults = requiredSuites.map(path => ({ name: `/workspace/${path}`, status: "passed",
    assertionResults: requiredAssertionTitlesBySuite[path].map((title: string) => ({ title, status: "passed" })) }));
  return {
    numTotalTestSuites: requiredSuites.length, numPassedTestSuites: requiredSuites.length,
    numFailedTestSuites: 0, numPendingTestSuites: 0,
    numTotalTests: requiredAssertionTitles.length, numPassedTests: requiredAssertionTitles.length, numFailedTests: 0,
    numPendingTests: 0, numTodoTests: 0, testResults,
  };
}

describe("DEE-1159 evaluation source executed PostgreSQL proof guard", () => {
  it("accepts only a nonempty exact native suite with all assertions passed", () => {
    expect(requiredSuites).toEqual(["tests/integration/postgres-research-evaluation-source-v1.test.ts",
      "tests/integration/postgres-research-evaluation-claim-v1.test.ts"]);
    expect(() => assertVitestProofReport(report())).not.toThrow();
  });

  it("accepts nested Vitest describe suites for the exact native files", () => {
    const value = report(); value.numTotalTestSuites = 4; value.numPassedTestSuites = 4;
    expect(() => assertVitestProofReport(value)).not.toThrow();
  });

  it("triggers the native gate for every distinct proof-pinned source path", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/postgres-integration.yml"), "utf8");
    expect(new Set(sourcePaths).size).toBeGreaterThan(0);
    expect(sourcePaths).toContain("lib/trader/research/research-owned-postgres-pool-v1.ts");
    expect(sourcePaths).toContain("lib/trader/research/research-issued-training-diagnostic-postgres-v2.ts");
    expect(sourcePaths).toContain("scripts/trader/discovery-development-evaluation.ts");
    expect(sourcePaths).toContain("tests/unit/trader-discovery-development-evaluation-cli.test.ts");
    expect(draftSql).toContain("docs/plans/dee-1159-evaluation-stage-owner.sql");
    expect(sourcePaths).toContain("docs/plans/dee-1159-evaluation-stage-owner.sql");
    expect(sourcePaths).toContain("package.json");
    expect(sourcePaths).toContain("pnpm-lock.yaml");
    expect(uncoveredSourcePathsForPullRequestWorkflow(workflow)).toEqual([]);
  });

  it("models GitHub single-star and double-star path coverage without crossing rules", () => {
    expect(githubPathPatternMatches("lib/trader/market-data/*", "lib/trader/market-data/a.ts")).toBe(true);
    expect(githubPathPatternMatches("lib/trader/market-data/*", "lib/trader/market-data/nested/a.ts")).toBe(false);
    expect(githubPathPatternMatches("lib/trader/market-data/**", "lib/trader/market-data/nested/a.ts")).toBe(true);
    expect(githubPathPatternMatches("**/dee-1211-*.md", "docs/plans/dee-1211-research-source-owner.md")).toBe(true);
  });

  it("detects a missing recursive market-data trigger", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/postgres-integration.yml"), "utf8");
    const withoutRecursiveMarketData = workflow.replace('      - "lib/trader/market-data/**"\n', "");
    expect(uncoveredSourcePathsForPullRequestWorkflow(withoutRecursiveMarketData)).toContain(
      "lib/trader/market-data/fhv-acquisition-evidence-class.ts",
    );
  });

  it("uses only the isolated source-owner service for passwordless restricted-role proof", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/postgres-integration.yml"), "utf8");
    const ownerJob = workflow.slice(workflow.indexOf("  dee1159-evaluation-source-postgres:"),
      workflow.indexOf("\n  capital-authority:"));
    expect(ownerJob).toContain("POSTGRES_DB: waia_hsv2_it_dee1159_eval_source_v1");
    expect(ownerJob).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
  });

  it.each([
    ["claim assertion in wrong file", (value: ReturnType<typeof report>) => {
      const moved = value.testResults[1]!.assertionResults.pop()!; value.testResults[0]!.assertionResults.push(moved);
    }],
    ["missing suite", (value: ReturnType<typeof report>) => { value.testResults = []; }],
    ["duplicate suite", (value: ReturnType<typeof report>) => { value.testResults.push(structuredClone(value.testResults[0]!)); value.numTotalTestSuites++; value.numPassedTestSuites++; }],
    ["unequal nested suite counters", (value: ReturnType<typeof report>) => { value.numTotalTestSuites = 2; value.numPassedTestSuites = 1; }],
    ["empty suite", (value: ReturnType<typeof report>) => { value.testResults[0]!.assertionResults = []; value.numTotalTests = 0; value.numPassedTests = 0; }],
    ["skipped assertion", (value: ReturnType<typeof report>) => { value.testResults[0]!.assertionResults[0]!.status = "skipped"; }],
    ["failed assertion", (value: ReturnType<typeof report>) => { value.testResults[0]!.assertionResults[0]!.status = "failed"; }],
    ["todo counter", (value: ReturnType<typeof report>) => { value.numTodoTests = 1; }],
    ["failed file status", (value: ReturnType<typeof report>) => { value.testResults[0]!.status = "failed"; }],
    ["too few assertions", (value: ReturnType<typeof report>) => { value.numTotalTests = requiredAssertionTitles.length - 1; value.numPassedTests = value.numTotalTests; value.testResults[0]!.assertionResults.pop(); }],
    ["missing required poison case", (value: ReturnType<typeof report>) => { value.testResults[0]!.assertionResults[2]!.title = "unrelated case"; }],
    ["duplicate required poison case", (value: ReturnType<typeof report>) => { value.testResults[0]!.assertionResults[3]!.title = value.testResults[0]!.assertionResults[2]!.title; }],
  ])("refuses %s", (_label, mutate) => {
    const value = report(); mutate(value);
    expect(() => assertVitestProofReport(value)).toThrow();
  });

  it("rejects changed or absent source bytes using SHA-256", () => {
    const bytes = Buffer.from("synthetic source");
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(() => assertSourceHashes(["source.ts"], { "source.ts": digest }, () => bytes,
      (input: Uint8Array) => createHash("sha256").update(input).digest("hex"))).not.toThrow();
    expect(() => assertSourceHashes(["source.ts"], { "source.ts": "0".repeat(64) }, () => bytes,
      (input: Uint8Array) => createHash("sha256").update(input).digest("hex"))).toThrow(/SOURCE_FILE_CHANGED/);
    expect(() => assertSourceHashes(["missing.ts"], {}, () => { throw new Error("missing"); },
      (input: Uint8Array) => createHash("sha256").update(input).digest("hex"))).toThrow(/SOURCE_FILE_MISSING/);
  });

  it("rejects assertion totals that do not match the suite detail", () => {
    const value = report(); value.numTotalTests++; value.numPassedTests++;
    expect(() => assertVitestProofReport(value)).toThrow(/ASSERTION_TOTAL_MISMATCH/);
  });
});
