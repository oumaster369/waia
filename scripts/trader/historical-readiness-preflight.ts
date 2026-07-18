/**
 * HTR-WP23 — historical readiness preflight CLI.
 *
 * Usage:
 *   pnpm trader:htr:readiness:preflight -- --self-test
 *   pnpm trader:htr:readiness:preflight -- --candidate-json '<json>'
 */

import {
  assertHtrReadinessPreflightPass,
  runHtrReadinessPreflight,
  type HtrReadinessPreflightInput,
} from "@/lib/trader/readiness/htr-readiness-preflight";
import type { HtrFhvRunCandidateInput } from "@/lib/trader/readiness/htr-fhv-run-contract-v0";

function parseArgs(argv: string[]): {
  selfTest?: boolean;
  candidateJson?: string;
  validatePostgres?: boolean;
} {
  const candidateIndex = argv.indexOf("--candidate-json");
  return {
    selfTest: argv.includes("--self-test"),
    candidateJson: candidateIndex >= 0 ? argv[candidateIndex + 1] : undefined,
    validatePostgres: argv.includes("--validate-postgres-connection"),
  };
}

function main(): void {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error("WAIA_TRADER_CLI=1 required");
  }

  const { selfTest, candidateJson, validatePostgres } = parseArgs(process.argv.slice(2));
  if (!selfTest && !candidateJson) {
    throw new Error("HTR_WP23_PREFLIGHT_CLI:SELF_TEST_OR_CANDIDATE_JSON_REQUIRED");
  }

  let input: HtrReadinessPreflightInput;
  if (selfTest) {
    input = {
      mode: "self-test",
      validatePostgresConnection: validatePostgres,
    };
  } else {
    const candidate = JSON.parse(candidateJson!) as HtrFhvRunCandidateInput;
    input = {
      mode: "candidate-run",
      candidate,
      validatePostgresConnection: validatePostgres,
    };
  }

  const result = runHtrReadinessPreflight(input);
  console.log(JSON.stringify(result, null, 2));

  if (selfTest) {
    assertHtrReadinessPreflightPass(result);
  }

  if (result.terminalState !== "HTR_WP23_READINESS_PREFLIGHT_PASS") {
    process.exitCode = 1;
  }
}

main();
