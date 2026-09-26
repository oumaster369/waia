import { readFileSync } from "node:fs";

// A skipped opt-in suite can exit successfully. Require actual canonical-profile proof.
const requiredFiles = [
  "postgres-reconciliation-workflow-parity.test.ts",
  "postgres-settlement-reconciliation-parity.test.ts",
];
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const file of requiredFiles) {
  const results = report.testResults.filter((result) =>
    result.name.endsWith(`/tests/integration/${file}`),
  );
  if (
    results.length !== 1 ||
    results[0].status !== "passed" ||
    results[0].assertionResults.length === 0 ||
    results[0].assertionResults.some((result) => result.status !== "passed")
  ) {
    throw new Error(`Required payment reconciliation proof missing, failed or skipped: ${file}`);
  }
}
console.log("Verified executed payment reconciliation proof: 2 canonical suites, no skipped tests.");
