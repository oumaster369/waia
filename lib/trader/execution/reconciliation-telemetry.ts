import {
  emitTraderTelemetry,
  type WaiaTraderTelemetryPayload,
  type WaiaTraderTelemetrySink,
} from "@/lib/observability/waia-trader-telemetry";
import type {
  ReconciliationClassification,
  ReconciliationEscalationKind,
  ReconcileTarget,
} from "@/lib/trader/execution/reconciliation.types";
import { reconciliationClassificationEnum } from "@/lib/trader/execution/reconciliation.types";

export const CRITICAL_RECONCILIATION_CLASSIFICATIONS = [
  "UNKNOWN_POSITION",
  "TERMINAL_DRIFT",
  "NOT_FOUND_AT_VENUE",
  "AMBIGUOUS_STALE",
] as const satisfies readonly ReconciliationClassification[];

export type CriticalReconciliationClassification =
  (typeof CRITICAL_RECONCILIATION_CLASSIFICATIONS)[number];

export function isCriticalReconciliationClassification(
  classification: ReconciliationClassification,
): classification is CriticalReconciliationClassification {
  return (CRITICAL_RECONCILIATION_CLASSIFICATIONS as readonly string[]).includes(classification);
}

export function buildReconciliationCountFields(
  counts: Record<ReconciliationClassification, number>,
): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const classification of reconciliationClassificationEnum) {
    fields[`count_${classification.toLowerCase()}`] = counts[classification] ?? 0;
  }
  return fields;
}

export type ReconciliationRunCompleteInput = {
  organizationId: string;
  target: ReconcileTarget;
  counts: Record<ReconciliationClassification, number>;
  durationMs: number;
};

export type ReconciliationCriticalMismatchInput = {
  organizationId: string;
  classification: CriticalReconciliationClassification;
  escalationKind?: ReconciliationEscalationKind;
};

export type ReconciliationStartupCompleteInput = {
  organizationId: string;
  executionMode: "mock" | "paper";
  counts: Record<ReconciliationClassification, number>;
  durationMs: number;
  escalationsAttempted: number;
};

export function emitReconciliationRunComplete(
  input: ReconciliationRunCompleteInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  const payload: WaiaTraderTelemetryPayload = {
    event: "waia_trader_event",
    kind: "reconciliation",
    organization_id: input.organizationId,
    outcome: "run_complete",
    severity: "info",
    duration_ms: input.durationMs,
    target_kind: input.target.kind,
    ...buildReconciliationCountFields(input.counts),
  };

  if (input.target.kind === "open") {
    payload.execution_mode = input.target.executionMode;
  }

  emitTraderTelemetry(payload, sink);
}

export function emitReconciliationCriticalMismatch(
  input: ReconciliationCriticalMismatchInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  const payload: WaiaTraderTelemetryPayload = {
    event: "waia_trader_event",
    kind: "reconciliation",
    organization_id: input.organizationId,
    outcome: input.classification,
    severity: "critical",
  };

  if (input.classification === "TERMINAL_DRIFT" && input.escalationKind !== undefined) {
    payload.escalation_kind = input.escalationKind;
  }

  emitTraderTelemetry(payload, sink);
}

export function emitReconciliationStartupComplete(
  input: ReconciliationStartupCompleteInput,
  sink?: WaiaTraderTelemetrySink,
): void {
  emitTraderTelemetry(
    {
      event: "waia_trader_event",
      kind: "reconciliation",
      organization_id: input.organizationId,
      outcome: "startup_complete",
      severity: "info",
      duration_ms: input.durationMs,
      execution_mode: input.executionMode,
      escalations_attempted: input.escalationsAttempted,
      ...buildReconciliationCountFields(input.counts),
    },
    sink,
  );
}
