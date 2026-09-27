import { readFileSync } from "node:fs";

const requiredFile = "postgres-historical-production-first-cycle-v2.test.ts";
const requiredTitle = "commits 35 production cycles and applies the first future-only Forecast learning closure";
const optionalTitle = "continues the upfront 80-cycle extent and binds matured knowledge to an authorized Forecast";
if (process.env.WAIA_PG_INTEGRATION !== "1" || process.env.WAIA_POSTGRES_CLI !== "1" ||
  process.env.WAIA_TRADER_CLI !== "1" ||
  process.env.WAIA_HISTORICAL_PG_RECONCILIATION_PROFILE !== "HISTORICAL_PG_RECONCILIATION_V1" ||
  process.env.WAIA_HISTORICAL_KNOWLEDGE_CONTINUATION_PROOF === "1" ||
  !process.env.DATABASE_URL_POSTGRES || process.env.DATABASE_URL_POSTGRES_SESSION !== process.env.DATABASE_URL_POSTGRES) {
  throw new Error("Required historical PROFILE35 command environment missing or wrong");
}
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const results = report.testResults;
if (!Array.isArray(results) || results.length !== 1 ||
  !results[0].name.endsWith(`/tests/integration/${requiredFile}`) || results[0].status !== "passed" ||
  !Array.isArray(results[0].assertionResults) || results[0].assertionResults.length === 0 ||
  results[0].assertionResults.some(r => r.status !== "passed") ||
  results[0].assertionResults.filter(r => r.title === requiredTitle).length !== 1 ||
  results[0].assertionResults.some(r => r.title === optionalTitle)) {
  throw new Error("Required historical PROFILE35 proof missing, failed, duplicated or skipped");
}
console.log(JSON.stringify({ proof: "historical-reconciliation-profile35",
  profile: process.env.WAIA_HISTORICAL_PG_RECONCILIATION_PROFILE, expectedCycles: 35,
  suite: requiredFile, registeredAssertions: results[0].assertionResults.length,
  allRegisteredPassed: true, optional80Registered: false }));
