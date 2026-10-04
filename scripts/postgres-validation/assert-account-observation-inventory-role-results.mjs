import { readFileSync } from "node:fs";

const requiredFile = "account-observation-inventory-role-postgres.test.ts";
const refuse = (reason) => {
  throw new Error(`Required inventory role proof missing, failed or skipped: ${reason}`);
};
let report;
try {
  report = JSON.parse(readFileSync(process.argv[2], "utf8"));
} catch {
  refuse("unreadable or malformed result report");
}
if (!report || !Array.isArray(report.testResults) || report.testResults.length !== 1) {
  refuse("expected exactly one dedicated role suite result");
}
const suite = report.testResults[0];
if (
  !suite || typeof suite.name !== "string" || !suite.name.endsWith(`/tests/integration/${requiredFile}`) ||
  suite.status !== "passed" || !Array.isArray(suite.assertionResults) || suite.assertionResults.length !== 8 ||
  suite.assertionResults.some((result) => !result || result.status !== "passed")
) {
  refuse(requiredFile);
}
console.log("Verified executed PostgreSQL proof: 8 inventory role and policy cases, no skipped tests.");
