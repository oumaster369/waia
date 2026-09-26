import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "waia-billing-parity-proof-"));
const reportPath = join(directory, "report.json");
const required = [
  "admin-console-billing-idempotency-postgres.test.ts",
  "postgres-reporting-period-parity.test.ts",
  "postgres-invoice-issuance-parity.test.ts",
];
const passed = () => required.map((file) => ({
  name: `/workspace/tests/integration/${file}`, status: "passed",
  assertionResults: [{ status: "passed" }],
}));
function run(testResults: ReturnType<typeof passed>) {
  writeFileSync(reportPath, JSON.stringify({ testResults }));
  return spawnSync(process.execPath, ["scripts/postgres-validation/assert-billing-parity-test-results.mjs", reportPath],
    { encoding: "utf8" });
}
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });

describe("mandatory executed canonical-profile billing parity proof", () => {
  it("accepts all three actually executed billing parity suites", () => {
    const result = run(passed());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("3 billing parity suites, no skipped tests");
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
