import { readFileSync } from "node:fs";

// Opt-in native suites can exit successfully while skipped. This guard requires
// executed evidence from all five files in the separate, serial PG17 lane.
const requiredFiles = [
  "account-observation-migration-postgres.test.ts",
  "trader-account-observation-postgres.test.ts",
  "account-observation-reader-postgres.test.ts",
  "account-observation-credential-postgres.test.ts",
  "account-observation-risk-owner-postgres.test.ts",
];
const refuse = (reason) => {
  throw new Error(`Required account observation proof missing, failed or skipped: ${reason}`);
};
let report;
try {
  report = JSON.parse(readFileSync(process.argv[2], "utf8"));
} catch {
  refuse("unreadable or malformed result report");
}
if (!report || !Array.isArray(report.testResults) || report.testResults.length !== requiredFiles.length) {
  refuse("expected exactly five suite results");
}
for (const file of requiredFiles) {
  const results = report.testResults.filter((result) =>
    result && typeof result.name === "string" && result.name.endsWith(`/tests/integration/${file}`),
  );
  if (
    results.length !== 1 ||
    results[0].status !== "passed" ||
    !Array.isArray(results[0].assertionResults) ||
    results[0].assertionResults.length === 0 ||
    results[0].assertionResults.some((result) => !result || result.status !== "passed")
  ) {
    refuse(file);
  }
}
console.log("Verified executed PostgreSQL proof: 5 account observation suites, no skipped tests.");
