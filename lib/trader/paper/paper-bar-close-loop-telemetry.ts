import {
  emitTraderTelemetry,
  type WaiaTraderTelemetryPayload,
  type WaiaTraderTelemetrySink,
} from "@/lib/observability/waia-trader-telemetry";
import { isCriticalReconciliationClassification } from "@/lib/trader/execution/reconciliation-telemetry";
import type { ReconciliationClassification } from "@/lib/trader/execution/reconciliation.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { RiskDecisionOutcome } from "@/lib/trader/risk/types";

export type PaperBarCloseCycleCompleteInput = {
  organizationId: string;
  cycleId: string;
  cyclesRun: number;
  durationMs: number;
  result: PaperCycleResult;
  stateRefreshed: boolean;
  accountStateAfterCycle: AccountRiskState;
  errorClass?: string;
};

export type PaperBarCloseRollupInput = {
  organizationId: string;
  cyclesRun: number;
  rollupEvery: number;
  countCycleComplete: number;
  countSignal: number;
  countNoSignal: number;
  countSubmitted: number;
  countRiskRejected: number;
  countReconCritical: number;
};

export type PaperBarCloseRollupCounters = {
  countCycleComplete: number;
  countSignal: number;
  countNoSignal: number;
  countSubmitted: number;
  countRiskRejected: number;
  countReconCritical: number;
};

export function createPaperBarCloseRollupCounters(): PaperBarCloseRollupCounters {
  return {
    countCycleComplete: 0,
    countSignal: 0,
    countNoSignal: 0,
    countSubmitted: 0,
    countRiskRejected: 0,
    countReconCritical: 0,
  };
}

function mapExecutionStatus(result: PaperCycleResult): string | null {
  if (result.execution === null) {
    return null;
  }
  if (result.submitBlocked && result.skipReason !== undefined) {
    return null;
  }
  return result.execution.status;
}

function mapRiskOutcome(
  result: PaperCycleResult,
  executionStatus: string | null,
): RiskDecisionOutcome | null {
  if (executionStatus !== "risk_rejected" || result.execution?.status !== "risk_rejected") {
    return null;
  }
  return result.execution.riskDecision.decision.outcome;
}

function mapReconciliationClassification(
  result: PaperCycleResult,
): ReconciliationClassification | null {
  const firstSubmitted = result.strategyExecutions.find(
    (entry) => entry.execution?.status === "submitted",
  );
  const target = firstSubmitted ?? result.strategyExecutions.at(-1);
  const first = target?.reconciliation?.outcomes[0];
  return first?.classification ?? result.reconciliation?.outcomes[0]?.classification ?? null;
}

function countSubmittedStrategies(result: PaperCycleResult): number {
  return result.strategyExecutions.filter((entry) => entry.execution?.status === "submitted")
    .length;
}

function summarizeStrategyIds(result: PaperCycleResult): string {
  return result.strategyExecutions
    .map((entry) => entry.signal.strategyId)
    .sort((a, b) => a.localeCompare(b))
    .join(",");
}

function resolveSeverity(input: {
  executionStatus: string | null;
  riskOutcome: RiskDecisionOutcome | null;
  reconciliationClassification: ReconciliationClassification | null;
}): "info" | "critical" {
  if (input.executionStatus === "conflict") {
    return "critical";
  }
  if (input.executionStatus === "risk_rejected" && input.riskOutcome === "STOP_ACCOUNT") {
    return "critical";
  }
  if (
    input.reconciliationClassification !== null &&
    isCriticalReconciliationClassification(input.reconciliationClassification)
  ) {
    return "critical";
  }
  return "info";
}

export function buildPaperBarCloseCycleCompletePayload(
  input: PaperBarCloseCycleCompleteInput,
): WaiaTraderTelemetryPayload {
  const signalOutcome = input.result.evaluation.signal.outcome;
  const skipReason =
    input.result.skipReason !== undefined && input.result.submitBlocked
      ? input.result.skipReason
      : null;
  const executionStatus = mapExecutionStatus(input.result);
  const riskOutcome = mapRiskOutcome(input.result, executionStatus);
  const reconciliationClassification = mapReconciliationClassification(input.result);

  const payload: WaiaTraderTelemetryPayload = {
    event: "waia_trader_event",
    kind: "paper_loop",
    organization_id: input.organizationId,
    outcome: "cycle_complete",
    severity: resolveSeverity({
      executionStatus,
      riskOutcome,
      reconciliationClassification,
    }),
    duration_ms: input.durationMs,
    cycle_id: input.cycleId,
    cycles_run: input.cyclesRun,
    execution_mode: "mock",
    signal_outcome: signalOutcome,
    skip_reason: skipReason,
    execution_status: executionStatus,
    risk_outcome: riskOutcome,
    reconciliation_classification: reconciliationClassification,
    state_refreshed: input.stateRefreshed,
    open_order_count: input.accountStateAfterCycle.openOrderCount,
    position_symbol_count: input.accountStateAfterCycle.positions.length,
    strategy_signal_count: input.result.strategyExecutions.length,
    strategy_submitted_count: countSubmittedStrategies(input.result),
    strategy_ids: summarizeStrategyIds(input.result),
  };

  if (input.errorClass !== undefined) {
    payload.error_class = input.errorClass;
  }

  return payload;
}

export function emitPaperBarCloseCycleComplete(
  input: PaperBarCloseCycleCompleteInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  emitTraderTelemetry(buildPaperBarCloseCycleCompletePayload(input), sink);
}

export function buildPaperBarCloseRollupPayload(
  input: PaperBarCloseRollupInput,
): WaiaTraderTelemetryPayload {
  return {
    event: "waia_trader_event",
    kind: "paper_loop",
    organization_id: input.organizationId,
    outcome: "rollup",
    severity: "info",
    cycles_run: input.cyclesRun,
    rollup_every: input.rollupEvery,
    count_cycle_complete: input.countCycleComplete,
    count_signal: input.countSignal,
    count_no_signal: input.countNoSignal,
    count_submitted: input.countSubmitted,
    count_risk_rejected: input.countRiskRejected,
    count_recon_critical: input.countReconCritical,
    execution_mode: "mock",
  };
}

export function emitPaperBarCloseRollup(
  input: PaperBarCloseRollupInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  emitTraderTelemetry(buildPaperBarCloseRollupPayload(input), sink);
}

export function updatePaperBarCloseRollupCounters(
  counters: PaperBarCloseRollupCounters,
  payload: WaiaTraderTelemetryPayload,
): void {
  counters.countCycleComplete += 1;
  if (payload.signal_outcome === "SIGNAL") {
    counters.countSignal += 1;
  } else if (payload.signal_outcome === "NO_SIGNAL") {
    counters.countNoSignal += 1;
  }
  if (payload.execution_status === "submitted") {
    counters.countSubmitted += 1;
  }
  if (payload.execution_status === "risk_rejected") {
    counters.countRiskRejected += 1;
  }
  if (
    payload.reconciliation_classification !== null &&
    isCriticalReconciliationClassification(
      payload.reconciliation_classification as ReconciliationClassification,
    )
  ) {
    counters.countReconCritical += 1;
  }
}
