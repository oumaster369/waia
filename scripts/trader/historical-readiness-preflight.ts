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
 *   pnpm trader:htr:readiness:preflight -- \
 *     --emit-fhv-reports \
 *     --run-log-root <root> \
 *     --organization-id <uuid> \
 *     --account-key <key> \
 *     --run-id <run-id> \
 *     --report-json '<BuildHtrOperatorReportInputV1-without-events>'
 */

import { readGitCodeSha } from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  assertHtrReadinessPreflightPass,
  parseHtrWp23ReadinessPreflightCliArgs,
  runHtrReadinessPreflight,
  type HtrReadinessPreflightInput,
} from "@/lib/trader/readiness/htr-readiness-preflight";
import { emitFhvReportsFromSemanticEvents } from "@/lib/trader/readiness/htr-readiness-evidence-harness";
import type { BuildHtrOperatorReportInputV1 } from "@/lib/trader/readiness/build-htr-operator-report.v1";
import { runHtrWp23OfficialEvidenceSeal } from "@/lib/trader/readiness/htr-readiness-evidence-harness";
import type { HtrFhvRunCandidateInput } from "@/lib/trader/readiness/htr-fhv-run-contract-v0";

function readCliFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`HTR_FHV_REPORT_CLI:${flag}_VALUE_REQUIRED`);
  }
  return value;
}

function parseEmitFhvReportsMode(argv: string[]): {
  runLogRoot: string;
  organizationId: string;
  accountKey: string;
  runId: string;
  reportInput: Omit<
    BuildHtrOperatorReportInputV1,
    "semanticEvents" | "runId" | "organizationId" | "accountKey"
  >;
} | null {
  if (!argv.includes("--emit-fhv-reports")) {
    return null;
  }
  const runLogRoot = readCliFlagValue(argv, "--run-log-root");
  const organizationId = readCliFlagValue(argv, "--organization-id");
  const accountKey = readCliFlagValue(argv, "--account-key");
  const runId = readCliFlagValue(argv, "--run-id");
  const reportJson = readCliFlagValue(argv, "--report-json");
  if (!runLogRoot || !organizationId || !accountKey || !runId || !reportJson) {
    throw new Error("HTR_FHV_REPORT_CLI:REQUIRED_FLAGS_MISSING");
  }
  return {
    runLogRoot,
    organizationId,
    accountKey,
    runId,
    reportInput: JSON.parse(reportJson) as Omit<
      BuildHtrOperatorReportInputV1,
      "semanticEvents" | "runId" | "organizationId" | "accountKey"
    >,
  };
}

function main(): void {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error("WAIA_TRADER_CLI=1 required");
  }

  const argv = process.argv.slice(2);
  const emitFhvReports = parseEmitFhvReportsMode(argv);
  if (emitFhvReports) {
    const reports = emitFhvReportsFromSemanticEvents(emitFhvReports);
    console.log(
      JSON.stringify(
        {
          terminalState: "HTR_FHV_REPORT_EMISSION_OK",
          runId: emitFhvReports.runId,
          operatorReportId: reports.operatorReport.reportId,
          semanticEventsDigest: reports.fhvPnlReport.semanticEventsDigest,
          sourceGitSha: readGitCodeSha(),
        },
        null,
        2,
      ),
    );
    return;
  }

  const mode = parseHtrWp23ReadinessPreflightCliArgs(argv);

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
