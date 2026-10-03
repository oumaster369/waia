import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "waia-account-observation-proof-"));
const reportPath = join(directory, "report.json");
const guard = "scripts/postgres-validation/assert-account-observation-test-results.mjs";
const inventoryRoleGuard = "scripts/postgres-validation/assert-account-observation-inventory-role-results.mjs";
const required = [
  "account-observation-migration-postgres.test.ts",
  "trader-account-observation-postgres.test.ts",
  "account-observation-reader-postgres.test.ts",
  "account-observation-credential-postgres.test.ts",
  "account-observation-risk-owner-postgres.test.ts",
];
const passed = () => required.map((file) => ({
  name: `/workspace/tests/integration/${file}`, status: "passed",
  assertionResults: [{ status: "passed" }, { status: "passed" }],
}));
function runBody(body: string) {
  writeFileSync(reportPath, body);
  return spawnSync(process.execPath, [guard, reportPath], { encoding: "utf8" });
}
function run(report: unknown) { return runBody(JSON.stringify(report)); }
function runInventoryBody(body: string) {
  writeFileSync(reportPath, body);
  return spawnSync(process.execPath, [inventoryRoleGuard, reportPath], { encoding: "utf8" });
}
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });

describe("mandatory PostgreSQL 17 account observation executed proof", () => {
  it("accepts all five actually executed suites in any report order", () => {
    for (const testResults of [passed(), passed().reverse()]) {
      const result = run({ testResults });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("5 account observation suites, no skipped tests");
    }
  });

  it.each(required)("rejects incomplete or non-passing proof for %s", (file) => {
    for (const mode of ["missing", "pending", "skipped", "todo", "failed", "unknown", "empty", "duplicate", "suite-failed", "suite-pending"] as const) {
      let testResults = passed();
      const selected = testResults.find((row) => row.name.endsWith(`/${file}`))!;
      if (mode === "missing") testResults = testResults.filter((row) => row !== selected);
      else if (mode === "duplicate") testResults.push(selected);
      else if (mode === "empty") selected.assertionResults = [];
      else if (mode === "suite-failed") selected.status = "failed";
      else if (mode === "suite-pending") selected.status = "pending";
      else selected.assertionResults[1]!.status = mode;
      const result = run({ testResults });
      expect(result.status, `${file}: ${mode}`).not.toBe(0);
      expect(result.stderr).toContain("Required account observation proof");
    }
  });

  it("rejects malformed JSON, missing reports and malformed result shapes", () => {
    for (const body of ["", "{", "null", "[]", "{}", '{"testResults":null}', '{"testResults":{}}']) {
      const result = runBody(body);
      expect(result.status, body).not.toBe(0);
      expect(result.stderr).toContain("Required account observation proof");
    }
    const missing = spawnSync(process.execPath, [guard, join(directory, "missing.json")], { encoding: "utf8" });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("Required account observation proof");
    expect(spawnSync(process.execPath, [guard], { encoding: "utf8" }).status).not.toBe(0);
    for (const malformed of [null, {}, { name: 1 }, { ...passed()[0], assertionResults: null },
      { ...passed()[0], assertionResults: [null] }, { ...passed()[0], assertionResults: [{}] }]) {
      const result = run({ testResults: [malformed, ...passed().slice(1)] });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Required account observation proof");
    }
  });

  it("rejects skip-only output, wrong file identities and extra unregistered suites", () => {
    const skipped = passed().map((row) => ({ ...row, assertionResults: [{ status: "pending" }] }));
    const wrongPath = passed(); wrongPath[0]!.name = "/workspace/tests/unit/account-observation-migration-postgres.test.ts";
    const extra = [...passed(), { ...passed()[0]!, name: "/workspace/tests/integration/unregistered.test.ts" }];
    for (const testResults of [[], skipped, wrongPath, extra]) {
      const result = run({ testResults });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Required account observation proof");
    }
  });

  it("requires all eight native inventory role proof cases to execute and pass", () => {
    const name = "/workspace/tests/integration/account-observation-inventory-role-postgres.test.ts";
    const assertions = [{ status: "passed" }, { status: "passed" }, { status: "passed" }, { status: "passed" }, { status: "passed" }, { status: "passed" }, { status: "passed" }, { status: "passed" }];
    const accepted = runInventoryBody(JSON.stringify({ testResults: [{ name, status: "passed", assertionResults: assertions }] }));
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain("8 inventory role and policy cases, no skipped tests");
    for (const report of [
      { testResults: [{ name, status: "passed", assertionResults: assertions.slice(0, 3) }] },
      { testResults: [{ name, status: "skipped", assertionResults: assertions }] },
      { testResults: [{ name: name.replace("integration", "unit"), status: "passed", assertionResults: assertions }] },
      { testResults: [{ name, status: "passed", assertionResults: [{ status: "passed" }, { status: "pending" }, ...assertions.slice(2)] }] },
      { testResults: [{ name, status: "passed", assertionResults: assertions }, { name, status: "passed", assertionResults: assertions }] },
    ]) {
      const rejected = runInventoryBody(JSON.stringify(report));
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("Required inventory role proof");
    }
    for (const body of ["", "{", "null", "{}", '{"testResults":[]}']) {
      const rejected = runInventoryBody(body);
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("Required inventory role proof");
    }
  });
});
