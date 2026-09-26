import { readFileSync } from "node:fs";

// A successful Vitest exit also allows skipped suites. This gate requires
// executed proof for each canonical-profile billing companion, never a skip waiver.
const requiredFiles = [
  "admin-console-billing-idempotency-postgres.test.ts",
  "postgres-reporting-period-parity.test.ts",
  "postgres-invoice-issuance-parity.test.ts",
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
    throw new Error(`Required PostgreSQL proof missing, failed or skipped: ${file}`);
  }
}
console.log(
  `Verified executed PostgreSQL proof: ${requiredFiles.length} billing parity suites, no skipped tests.`,
);
