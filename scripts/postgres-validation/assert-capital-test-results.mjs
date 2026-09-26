import { readFileSync } from "node:fs";

// A successful Vitest exit also allows skipped suites. This gate requires
// executed proof for every critical PostgreSQL surface, never a skip waiver.
const requiredFiles = [
  "postgres-execution-v2.test.ts",
  "postgres-risk-v2.test.ts",
  "postgres-risk-limits-bootstrap.test.ts",
  "postgres-trader-service-actor-authorization.test.ts",
  "postgres-reality-v2.test.ts",
  "postgres-canonical-decision-verification-v2.test.ts",
  "postgres-promotion-audit-atomicity.test.ts",
  "postgres-runtime-authority-v2.test.ts",
  "postgres-guardian-authority-v2.test.ts",
  "postgres-org-live-enable-atomicity.test.ts",
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
  `Verified executed PostgreSQL proof: ${requiredFiles.length} critical suites, no skipped tests.`,
);
