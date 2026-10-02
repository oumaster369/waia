import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertExactCiDatabaseTarget,
  assertSourceHashes,
  assertVitestProofReport,
  exactCiDatabaseUrl,
  requiredCaseTitles,
  requiredSuites,
  sourcePaths,
} from "@/scripts/postgres-validation/dee1205-postgres-proof-contract.mjs";

function passingReport() {
  return {
    numTotalTestSuites: 2, // nested describe blocks need not equal the file count
    numPassedTestSuites: 2,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: requiredCaseTitles.length,
    numPassedTests: requiredCaseTitles.length,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [{
      name: `/workspace/${requiredSuites[0]}`,
      status: "passed",
      assertionResults: requiredCaseTitles.map((title) => ({ title, status: "passed" })),
    }],
  };
}

describe("DEE-1205 executed PostgreSQL proof guard", () => {
  it("runs on every source pinned by the scheduled-owner proof", () => {
    const workflow = readFileSync(".github/workflows/postgres-integration.yml", "utf8");
    const pullRequestPaths = workflow.slice(workflow.indexOf("    paths:\n"), workflow.indexOf("\nenv:\n"));
    const triggers = [...pullRequestPaths.matchAll(/^      - "([^"]+)"$/gm)].map((match) => match[1]!);
    expect(triggers.length).toBeGreaterThan(0);
    for (const path of sourcePaths) {
      const covered = triggers.some((trigger) => trigger === path ||
        (trigger.endsWith("/**") && path.startsWith(trigger.slice(0, -2))) ||
        (trigger.includes("*") && trigger.indexOf("*") === trigger.lastIndexOf("*") &&
          path.startsWith(trigger.slice(0, trigger.indexOf("*"))) &&
          path.endsWith(trigger.slice(trigger.indexOf("*") + 1))));
      expect(covered, `Missing PostgreSQL proof pull-request trigger for ${path}`).toBe(true);
    }
  });

  it("accepts only the exact disposable CI database pair", () => {
    const env = { CI: "true", GITHUB_ACTIONS: "true",
      DATABASE_URL_POSTGRES: exactCiDatabaseUrl,
      DATABASE_URL_POSTGRES_SESSION: exactCiDatabaseUrl };
    expect(assertExactCiDatabaseTarget(env)).toBe(exactCiDatabaseUrl);
    for (const changed of [
      { ...env, DATABASE_URL_POSTGRES_SESSION: undefined },
      { ...env, DATABASE_URL_POSTGRES: exactCiDatabaseUrl.replace("waia_dee1205", "waia_it") },
      { ...env, GITHUB_ACTIONS: undefined },
      { ...env, DATABASE_URL_POSTGRES: `${exactCiDatabaseUrl}?sslmode=disable` },
    ]) expect(() => assertExactCiDatabaseTarget(changed)).toThrow("EXACT_CI_DATABASE_REQUIRED");
  });

  it("requires one real executed file with all exact passing assertions", () => {
    expect(sourcePaths).toContain("tests/helpers/postgres-commit-ack-loss-proxy.ts");
    expect(sourcePaths).toContain("docs/plans/dee-1205-scheduled-noncapital-owner.sql");
    expect(sourcePaths).toContain("lib/trader/paper/scheduled-owned-postgres-transport-v1.ts");
    expect(sourcePaths).toContain("scripts/postgres-validation/probe-dee1213-worker-transport.mjs");
    expect(() => assertVitestProofReport(passingReport())).not.toThrow();
    const skipped = passingReport();
    skipped.testResults[0]!.assertionResults[0]!.status = "pending";
    expect(() => assertVitestProofReport(skipped)).toThrow();
    const omitted = passingReport();
    omitted.testResults[0]!.assertionResults.pop();
    expect(() => assertVitestProofReport(omitted)).toThrow("ASSERTION_TOTAL_MISMATCH");
    const missing = passingReport();
    missing.testResults = [];
    expect(() => assertVitestProofReport(missing)).toThrow();
    const failed = passingReport();
    failed.numPassedTests = requiredCaseTitles.length - 1;
    failed.numFailedTests = 1;
    expect(() => assertVitestProofReport(failed)).toThrow();
    const omittedCase = passingReport();
    omittedCase.testResults[0]!.assertionResults.pop();
    omittedCase.numTotalTests -= 1;
    omittedCase.numPassedTests -= 1;
    expect(() => assertVitestProofReport(omittedCase)).toThrow("ASSERTION_TITLE_ROSTER_MISMATCH");
    const duplicateCase = passingReport();
    duplicateCase.testResults[0]!.assertionResults[13]!.title = requiredCaseTitles[0]!;
    expect(() => assertVitestProofReport(duplicateCase)).toThrow("ASSERTION_TITLE_ROSTER_MISMATCH");
    const substitutedCase = passingReport();
    substitutedCase.testResults[0]!.assertionResults[0]!.title = "different case with same count";
    expect(() => assertVitestProofReport(substitutedCase)).toThrow("ASSERTION_TITLE_ROSTER_MISMATCH");
  });

  it("refuses a missing or byte-changed reviewed source", () => {
    const bytes = new TextEncoder().encode("exact source");
    const hash = (value: Uint8Array) => Buffer.from(value).toString("hex");
    expect(() => assertSourceHashes(["owner.ts"], { "owner.ts": "wrong" }, () => bytes, hash))
      .toThrow("SOURCE_FILE_CHANGED:owner.ts");
    expect(() => assertSourceHashes(["owner.ts"], { "owner.ts": hash(bytes) }, () => { throw new Error("missing"); }, hash))
      .toThrow("SOURCE_FILE_MISSING:owner.ts");
  });
});
