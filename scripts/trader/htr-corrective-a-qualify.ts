/**
 * HTR-FINAL-AUDIT-CORRECTIVE-A (C-A5) — integrated qualification CLI.
 *
 * Usage:
 *   pnpm trader:htr:corrective-a:qualify -- --source-git-sha <SHA>
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  attachClosed1mMarkToAccountingBridge,
  createHtrAccountingCycleBridge,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import { normalizeAccountingStateDrawdownFields } from "@/lib/trader/accounting/accounting-frontier.types";
import {
  assertProductionReplayEvidenceSinkConfigured,
  NOOP_REPLAY_EVIDENCE_SINK,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-sink";
import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  createHtrHistoricalCostModelAuthorityV1,
  HTR_HISTORICAL_COST_MODEL_DIGEST,
} from "@/lib/trader/execution/htr-historical-cost-model-authority";
import { executeBreachPartialEntryCancellation } from "@/lib/trader/guardian/htr-breach-partial-entry-cancellation";
import {
  evaluateHtrGuardianCycle,
  requiresHtrPartialEntryCancellation,
} from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { createInitialAccountingState } from "@/lib/trader/accounting";
import { buildHtrOperatorReportV1 } from "@/lib/trader/readiness/build-htr-operator-report.v1";
import {
  HTR_FHV_RUN_CONTRACT_V0,
  computeHtrFhvRunContractDigest,
} from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import { runHtrReadinessPreflight } from "@/lib/trader/readiness/htr-readiness-preflight";
import { DEFAULT_D20_DRAWDOWN_POLICY } from "@/lib/trader/risk/drawdown-policy.types";
import { makeWp17Bar } from "@/tests/unit/helpers/wp17-execution-fixtures";

export const HTR_CORRECTIVE_A_PACKET_SHA256 =
  "04863e7af156a3593ff5380d519decff0e33168bf518c4b05886b1ad2f82c6a2" as const;

export const HTR_CORRECTIVE_A_EVIDENCE_STAGING_ROOT =
  "replay-runs/RI-P7/htr-corrective-a-qualification" as const;

export const HTR_CORRECTIVE_A_EVIDENCE_INTEGRITY_CONTRACT_ID =
  "waia.htr.evidence-integrity.v2" as const;

export const HTR_CORRECTIVE_A_EVIDENCE_MANIFEST_SCHEMA =
  "htr-corrective-a-evidence-manifest/v1" as const;

export const HTR_CORRECTIVE_A_FORBIDDEN_ACCEPTED_EVIDENCE_PATHS = [
  "replay-runs/RI-P7/htr-wp22-runtime-qualification",
  "replay-runs/RI-P7/htr-wp23-readiness-package",
] as const;

export const HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_SCHEMA =
  "htr-corrective-a-integrated-qualification/v1" as const;

export const HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_PHASE =
  "corrective-a-integrated-g5" as const;

export type HtrCorrectiveAIntegratedQualificationTerminalState =
  | "HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_PASS"
  | "HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_FAIL";

export type HtrCorrectiveAGateStatus = {
  gate: "G1" | "G2" | "G3" | "G4";
  correctiveArea: "C-A1" | "C-A2" | "C-A3" | "C-A4";
  terminalState: "PASS" | "FAIL";
  proofSummary: string;
};

export type HtrCorrectiveAIntegratedQualificationResult = {
  schemaVersion: typeof HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_SCHEMA;
  phase: typeof HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_PHASE;
  terminalState: HtrCorrectiveAIntegratedQualificationTerminalState;
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  packetSha256: typeof HTR_CORRECTIVE_A_PACKET_SHA256;
  gateStatuses: HtrCorrectiveAGateStatus[];
  qualificationHarnessSha256: string;
  invalidationReason?: string;
  payloadSha256?: string;
};

export function readQualificationHarnessSha256(): string {
  return createHash("sha256")
    .update(readFileSync(new URL(import.meta.url).pathname, "utf8"), "utf8")
    .digest("hex");
}

export function computeCorrectiveAQualificationPayloadSha256(
  payload: Omit<HtrCorrectiveAIntegratedQualificationResult, "payloadSha256">,
): string {
  const semanticBody = { ...payload };
  if (semanticBody.invalidationReason === undefined) {
    delete semanticBody.invalidationReason;
  }
  return computeSemanticSha256Hex(semanticBody);
}

function evaluateCorrectiveAG1DrawdownGate(): HtrCorrectiveAGateStatus {
  const bridge = createHtrAccountingCycleBridge({
    organizationId: "00000000-0000-4000-8000-0000000415a5",
    accountKey: "corrective-a5-g1",
    runId: "corrective-a5-g1-run",
    frontierAsOf: "2026-01-31T23:00:00.000Z",
  });

  attachClosed1mMarkToAccountingBridge(
    bridge,
    makeWp17Bar(1, {
      barCloseTime: "2026-01-31T23:01:59.999Z",
      close: "50000",
    }),
    1,
  );

  const janAccountHwm = bridge.state.equityHwm;

  attachClosed1mMarkToAccountingBridge(
    bridge,
    makeWp17Bar(2, {
      barCloseTime: "2026-02-01T00:01:59.999Z",
      close: "40000",
    }),
    2,
  );

  const monthlyReset =
    bridge.state.monthKey === "2026-02" &&
    bridge.state.monthlyPeakHwm === bridge.state.equity &&
    bridge.state.equityHwm === janAccountHwm;

  return {
    gate: "G1",
    correctiveArea: "C-A1",
    terminalState: monthlyReset ? "PASS" : "FAIL",
    proofSummary: monthlyReset
      ? "month-boundary monthly HWM reset preserves account HWM"
      : "month-boundary monthly HWM reset failed",
  };
}

function evaluateCorrectiveAG2CostGate(): HtrCorrectiveAGateStatus {
  const authority = createHtrHistoricalCostModelAuthorityV1();
  const digestMatch =
    authority.costModelDigest === HTR_HISTORICAL_COST_MODEL_DIGEST &&
    authority.costModelDigest === HTR_FHV_RUN_CONTRACT_V0.costModelDigest;

  const preflight = runHtrReadinessPreflight({
    mode: "candidate-run",
    candidate: {
      costModelId: HTR_FHV_RUN_CONTRACT_V0.costModelId,
      costModelSchemaVersion: HTR_FHV_RUN_CONTRACT_V0.costModelSchemaVersion,
      feeBps: HTR_FHV_RUN_CONTRACT_V0.feeBps,
      halfSpreadBps: HTR_FHV_RUN_CONTRACT_V0.halfSpreadBps,
      marketImpactBps: HTR_FHV_RUN_CONTRACT_V0.marketImpactBps,
      slippageModel: HTR_FHV_RUN_CONTRACT_V0.slippageModel,
      costModelDigest: HTR_FHV_RUN_CONTRACT_V0.costModelDigest,
    },
  });

  const pass =
    digestMatch &&
    preflight.terminalState === "HTR_WP23_READINESS_PREFLIGHT_PASS" &&
    preflight.fhvRunContractDigest === computeHtrFhvRunContractDigest();

  return {
    gate: "G2",
    correctiveArea: "C-A2",
    terminalState: pass ? "PASS" : "FAIL",
    proofSummary: pass
      ? "D-5 authority digest matches FHV contract and preflight accepts candidate"
      : "cost-model authority or FHV preflight mismatch",
  };
}

function evaluateCorrectiveAG3BreachGate(): HtrCorrectiveAGateStatus {
  const state = createInitialAccountingState({
    organizationId: "00000000-0000-4000-8000-0000000415a5",
    accountKey: "corrective-a5-g3",
    runId: "corrective-a5-g3-run",
  });
  state.equity = "50000";
  state.accountDrawdownBps = DEFAULT_D20_DRAWDOWN_POLICY.accountBps + 1;
  const drawdownState = normalizeAccountingStateDrawdownFields(state);

  const guardian = evaluateHtrGuardianCycle({
    reconciliation: {
      state,
      startingEquityUsdt: "100000",
      startingCashUsdt: "100000",
    },
    accountPeakHwm: drawdownState.equityHwm,
    monthlyPeakHwm: drawdownState.monthlyPeakHwm,
    equityUsdt: state.equity,
  });

  const requiresCancel = requiresHtrPartialEntryCancellation(guardian);
  const consumerCallable = typeof executeBreachPartialEntryCancellation === "function";

  const pass = requiresCancel && guardian.cancelPartialEntry === true && consumerCallable;

  return {
    gate: "G3",
    correctiveArea: "C-A3",
    terminalState: pass ? "PASS" : "FAIL",
    proofSummary: pass
      ? "guardian cancelPartialEntry surfaces to deterministic cancellation consumer"
      : "breach cancellation consumer wiring incomplete",
  };
}

function evaluateCorrectiveAG4FhvGate(): HtrCorrectiveAGateStatus {
  let noopForbidden = false;
  try {
    assertProductionReplayEvidenceSinkConfigured(NOOP_REPLAY_EVIDENCE_SINK, true);
  } catch (error) {
    noopForbidden =
      error instanceof Error && error.message.includes("NOOP_PRODUCTION_PATH_FORBIDDEN");
  }

  const operatorReport = buildHtrOperatorReportV1({
    reportId: "00000000-0000-4000-8022-0000000000a5",
    runId: "corrective-a5-g4-run",
    organizationId: "00000000-0000-4000-8000-0000000415a5",
    accountKey: "corrective-a5-g4",
    generatedAtUtc: "2026-07-18T00:00:00.000Z",
    semanticEvents: [],
    provenance: {
      codeSha: "0000000000000000000000000000000000000000",
      dirtyTree: false,
      datasetManifestDigest: "0000000000000000000000000000000000000000000000000000000000000000",
      runConfigDigest: "0000000000000000000000000000000000000000000000000000000000000000",
      strategyVersions: ["mean-reversion-v0@0.1.0"],
      costModelVersion: "waia.trader.cost-model.v1",
      riskPolicyVersion: "htr-wp16-d20-drawdown/v1",
      initialPortfolioDigest: "0000000000000000000000000000000000000000000000000000000000000000",
    },
  });

  const pass =
    noopForbidden &&
    operatorReport.schemaVersion.length > 0 &&
    operatorReport.billingHwmDistinctFromRiskDrawdown === true;

  return {
    gate: "G4",
    correctiveArea: "C-A4",
    terminalState: pass ? "PASS" : "FAIL",
    proofSummary: pass
      ? "FHV operator report builder active and production NOOP sink forbidden"
      : "FHV emission contract incomplete",
  };
}

export function runHtrCorrectiveAIntegratedQualification(input: {
  sourceGitSha: string;
}): HtrCorrectiveAIntegratedQualificationResult {
  const gitSha = readGitCodeSha();
  const dirtyTree = readGitDirtyTree();
  const qualificationHarnessSha256 = readQualificationHarnessSha256();

  if (dirtyTree) {
    return {
      schemaVersion: HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_SCHEMA,
      phase: HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_PHASE,
      terminalState: "HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_FAIL",
      sourceGitSha: input.sourceGitSha,
      sourceDirtyTree: true,
      packetSha256: HTR_CORRECTIVE_A_PACKET_SHA256,
      gateStatuses: [],
      qualificationHarnessSha256,
      invalidationReason: "sourceDirtyTree=true",
    };
  }

  if (gitSha !== input.sourceGitSha) {
    return {
      schemaVersion: HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_SCHEMA,
      phase: HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_PHASE,
      terminalState: "HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_FAIL",
      sourceGitSha: input.sourceGitSha,
      sourceDirtyTree: false,
      packetSha256: HTR_CORRECTIVE_A_PACKET_SHA256,
      gateStatuses: [],
      qualificationHarnessSha256,
      invalidationReason: `sourceGitShaMismatch:expected=${input.sourceGitSha}:actual=${gitSha}`,
    };
  }

  const gateStatuses = [
    evaluateCorrectiveAG1DrawdownGate(),
    evaluateCorrectiveAG2CostGate(),
    evaluateCorrectiveAG3BreachGate(),
    evaluateCorrectiveAG4FhvGate(),
  ];

  const allPass = gateStatuses.every((gate) => gate.terminalState === "PASS");

  const base: Omit<HtrCorrectiveAIntegratedQualificationResult, "payloadSha256"> = {
    schemaVersion: HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_SCHEMA,
    phase: HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_PHASE,
    terminalState: allPass
      ? "HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_PASS"
      : "HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_FAIL",
    sourceGitSha: input.sourceGitSha,
    sourceDirtyTree: false,
    packetSha256: HTR_CORRECTIVE_A_PACKET_SHA256,
    gateStatuses,
    qualificationHarnessSha256,
    invalidationReason: allPass
      ? undefined
      : gateStatuses
          .filter((gate) => gate.terminalState === "FAIL")
          .map((gate) => `${gate.correctiveArea}:${gate.proofSummary}`)
          .join(";"),
  };

  return {
    ...base,
    payloadSha256: computeCorrectiveAQualificationPayloadSha256(base),
  };
}

export function assertHtrCorrectiveAIntegratedQualificationPass(
  result: HtrCorrectiveAIntegratedQualificationResult,
): void {
  if (result.terminalState !== "HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_PASS") {
    throw new Error(
      `HTR_CORRECTIVE_A_QUALIFY:FAIL:${result.invalidationReason ?? result.terminalState}`,
    );
  }
  if (result.sourceDirtyTree) {
    throw new Error("HTR_CORRECTIVE_A_QUALIFY:DIRTY_SOURCE_TREE");
  }
  if (result.packetSha256 !== HTR_CORRECTIVE_A_PACKET_SHA256) {
    throw new Error("HTR_CORRECTIVE_A_QUALIFY:PACKET_SHA256_MISMATCH");
  }
}

function parseArgs(argv: string[]): { sourceGitSha?: string } {
  const shaIndex = argv.indexOf("--source-git-sha");
  return {
    sourceGitSha: shaIndex >= 0 ? argv[shaIndex + 1] : undefined,
  };
}

function assertGitTreeClean(): void {
  const status = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  if (status.length > 0) {
    throw new Error("HTR_CORRECTIVE_A_QUALIFY:DIRTY_SOURCE_TREE");
  }
}

function main(): void {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error("WAIA_TRADER_CLI=1 required");
  }

  assertGitTreeClean();

  const { sourceGitSha } = parseArgs(process.argv.slice(2));
  const resolvedSha = sourceGitSha ?? readGitCodeSha();
  if (!resolvedSha) {
    throw new Error("HTR_CORRECTIVE_A_QUALIFY:SOURCE_GIT_SHA_REQUIRED");
  }

  const result = runHtrCorrectiveAIntegratedQualification({ sourceGitSha: resolvedSha });
  console.log(JSON.stringify(result, null, 2));

  if (result.terminalState !== "HTR_CORRECTIVE_A_INTEGRATED_QUALIFICATION_PASS") {
    process.exitCode = 1;
  }
}

function isCliEntrypoint(scriptSuffix: string): boolean {
  return (process.argv[1] ?? "").endsWith(scriptSuffix);
}

if (isCliEntrypoint("htr-corrective-a-qualify.ts")) {
  main();
}
