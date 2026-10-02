import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSourceHashes, assertVitestProofReport, requiredSuites, sourcePaths } from "@/scripts/postgres-validation/dee1200-postgres-proof-contract.mjs";

type VitestFile = {
  name: string;
  status: string;
  assertionResults: Array<{ status: string }>;
};
type VitestReport = {
  numTotalTestSuites: number;
  numPassedTestSuites: number;
  numFailedTestSuites: number;
  numPendingTestSuites: number;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: VitestFile[];
};

const historicalSevenFileBase = JSON.parse(readFileSync(resolve(
  process.cwd(), "tests/fixtures/dee1200-seven-suite-vitest-base.json",
), "utf8")) as VitestReport;

function withDiagnosticSuite(base: VitestReport): VitestReport {
  const diagnosticPath = requiredSuites.find((path) => path.endsWith("postgres-research-training-diagnostic-v1.test.ts"))!;
  return {
    ...structuredClone(base),
    numTotalTestSuites: base.numTotalTestSuites + 1,
    numPassedTestSuites: base.numPassedTestSuites + 1,
    numTotalTests: base.numTotalTests + 1,
    numPassedTests: base.numPassedTests + 1,
    testResults: [...structuredClone(base.testResults), {
      name: `/workspace/${diagnosticPath}`,
      status: "passed",
      assertionResults: [{ status: "passed" }],
    }],
  };
}

describe("DEE-1200 PostgreSQL proof report guard", () => {
  // The checked-in base is a reduced copy of a prior seven-file Vitest JSON
  // report. The eighth entry below is synthetic guard input only, never native
  // diagnostic evidence.
  it("accepts the real seven-file historical base plus one explicitly synthetic eighth suite", () => {
    expect(historicalSevenFileBase.testResults).toHaveLength(7);
    expect(historicalSevenFileBase.numTotalTestSuites).toBeGreaterThan(7);
    expect(() => assertVitestProofReport(withDiagnosticSuite(historicalSevenFileBase))).not.toThrow();
  });

  it("rejects the seven-file base without the registered diagnostic suite", () => {
    expect(() => assertVitestProofReport(historicalSevenFileBase)).toThrow(/SUITE_OR_ASSERTION_COUNTS/);
  });

  it.each(["missing", "duplicate", "skip", "empty", "failure"] as const)("rejects %s suite evidence", (mode) => {
    const report = withDiagnosticSuite(historicalSevenFileBase);
    const index = report.testResults.length - 1;
    if (mode === "missing") report.testResults.pop();
    if (mode === "duplicate") report.testResults[index] = { ...report.testResults[0]! };
    if (mode === "skip") report.testResults[index]!.assertionResults[0]!.status = "pending";
    if (mode === "empty") report.testResults[index]!.assertionResults = [];
    if (mode === "failure") {
      report.testResults[index]!.assertionResults[0]!.status = "failed";
      report.numPassedTests -= 1;
      report.numFailedTests += 1;
    }
    expect(() => assertVitestProofReport(report)).toThrow();
  });

  it("rejects a changed captured source hash", () => {
    const bytes = Buffer.from("synthetic source");
    expect(() => assertSourceHashes(["source.ts"], { "source.ts": "wrong" }, () => bytes,
      (input: Uint8Array) => Buffer.from(input).toString("hex"))).toThrow(/SOURCE_FILE_CHANGED:source.ts/);
  });

  it("rejects an omitted passing assertion even when the global counters are unchanged", () => {
    const report = withDiagnosticSuite(historicalSevenFileBase);
    const file = report.testResults.find(result => result.assertionResults.length > 1)!;
    file.assertionResults.pop();
    expect(() => assertVitestProofReport(report)).toThrow(/ASSERTION_TOTAL_MISMATCH/);
  });

  it("binds DEE-1207 invocation inputs and ensures their changes trigger the PostgreSQL workflow", () => {
    const inputs = [
      "lib/trader/research/research-feature-invocation-v1.ts",
      "tests/unit/trader-research-feature-invocation-v1.test.ts",
      "docs/plans/dee-1207-research-input-use.md",
    ];
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/postgres-integration.yml"), "utf8");
    for (const path of inputs) expect(sourcePaths).toContain(path);
    expect(workflow).toContain('"lib/trader/research/**"');
    expect(workflow).toContain('"tests/unit/trader-research-feature-invocation-v1.test.ts"');
    expect(workflow).toContain('"docs/plans/dee-1207-research-input-use.md"');
  });
});
