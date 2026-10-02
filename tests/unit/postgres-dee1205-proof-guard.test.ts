import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertExactCiDatabaseTarget,
  assertSourceHashes,
  assertVitestProofReport,
  exactCiDatabaseUrl,
  requiredSuites,
  sourcePaths,
} from "@/scripts/postgres-validation/dee1205-postgres-proof-contract.mjs";

function passingReport() {
  return {
    numTotalTestSuites: 2, // nested describe blocks need not equal the file count
    numPassedTestSuites: 2,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 2,
    numPassedTests: 2,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [{
      name: `/workspace/${requiredSuites[0]}`,
      status: "passed",
      assertionResults: [{ status: "passed" }, { status: "passed" }],
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
    failed.numPassedTests = 1;
    failed.numFailedTests = 1;
    expect(() => assertVitestProofReport(failed)).toThrow();
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
