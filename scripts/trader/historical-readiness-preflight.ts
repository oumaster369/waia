/**
 * HTR-WP23 — historical readiness preflight CLI.
 *
 * Usage:
 *   pnpm trader:htr:readiness:preflight -- --self-test
 *   pnpm trader:htr:readiness:preflight -- --candidate-json '<json>'
 *   pnpm trader:htr:readiness:preflight -- \
 *     --emit-evidence \
 *     --staging-only \
 *     --source-git-sha <EXACT_CLEAN_HEAD_SHA>
 */

import {
  assertHtrReadinessPreflightPass,
  parseHtrWp23ReadinessPreflightCliArgs,
  runHtrReadinessPreflight,
  type HtrReadinessPreflightInput,
} from "@/lib/trader/readiness/htr-readiness-preflight";
import { runHtrWp23OfficialEvidenceSeal } from "@/lib/trader/readiness/htr-readiness-evidence-harness";
import type { HtrFhvRunCandidateInput } from "@/lib/trader/readiness/htr-fhv-run-contract-v0";

function main(): void {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error("WAIA_TRADER_CLI=1 required");
  }

  const mode = parseHtrWp23ReadinessPreflightCliArgs(process.argv.slice(2));

  if (mode.kind === "evidence-seal") {
    const sealed = runHtrWp23OfficialEvidenceSeal(mode.sourceGitSha);
    console.log(JSON.stringify(sealed, null, 2));
    return;
  }

  let input: HtrReadinessPreflightInput;
  if (mode.kind === "self-test") {
    input = {
      mode: "self-test",
      validatePostgresConnection: mode.validatePostgresConnection,
    };
  } else {
    const candidate = JSON.parse(mode.candidateJson) as HtrFhvRunCandidateInput;
    input = {
      mode: "candidate-run",
      candidate,
      validatePostgresConnection: mode.validatePostgresConnection,
    };
  }

  const result = runHtrReadinessPreflight(input);
  console.log(JSON.stringify(result, null, 2));

  if (mode.kind === "self-test") {
    assertHtrReadinessPreflightPass(result);
  }

  if (result.terminalState !== "HTR_WP23_READINESS_PREFLIGHT_PASS") {
    process.exitCode = 1;
  }
}

main();
