import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "waia-capital-proof-"));
const reportPath = join(directory, "report.json");
const required = [
  "postgres-execution-v2.test.ts", "postgres-risk-v2.test.ts",
  "postgres-risk-limits-bootstrap.test.ts", "postgres-trader-service-actor-authorization.test.ts",
  "postgres-reality-v2.test.ts", "postgres-canonical-decision-verification-v2.test.ts",
  "postgres-promotion-audit-atomicity.test.ts", "postgres-runtime-authority-v2.test.ts",
  "postgres-guardian-authority-v2.test.ts",
  "postgres-billing-period-command-atomicity.test.ts",
  "postgres-billing-invoice-command-atomicity.test.ts",
];
const passed = () => required.map((file) => ({
  name: `/workspace/tests/integration/${file}`, status: "passed",
  assertionResults: [{ status: "passed" }],
}));
function run(testResults: ReturnType<typeof passed>) {
  writeFileSync(reportPath, JSON.stringify({ testResults }));
  return spawnSync(process.execPath, ["scripts/postgres-validation/assert-capital-test-results.mjs", reportPath],
    { encoding: "utf8" });
}
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });

describe("mandatory executed Postgres capital proof", () => {
  it("accepts all eleven actually executed critical suites", () => {
    const result = run(passed());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("11 critical suites, no skipped tests");
  });
  it.each(required)("rejects missing, skipped or failed proof for %s", (file) => {
    for (const mode of ["missing", "skipped", "failed", "empty", "duplicate"] as const) {
      let results = passed();
      const selected = results.find((row) => row.name.endsWith(`/${file}`))!;
      if (mode === "missing") results = results.filter((row) => row !== selected);
      else if (mode === "duplicate") results.push(selected);
      else if (mode === "empty") selected.assertionResults = [];
      else selected.assertionResults[0]!.status = mode === "skipped" ? "pending" : "failed";
      const result = run(results);
      expect(result.status, `${file}: ${mode}`).not.toBe(0);
      expect(result.stderr).toContain(`Required PostgreSQL proof missing, failed or skipped: ${file}`);
    }
  });
});
