import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import type { ReconciliationEscalationReport } from "@/lib/trader/execution/reconciliation-escalation.types";
import type {
  ReconciliationReport,
  ReconciliationService,
} from "@/lib/trader/execution/reconciliation.types";
import type { KillSwitchTriggerPort } from "@/lib/trader/risk/kill-switch/automatic-trigger";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type StartupExecutionMode = "mock" | "paper";

/** In-memory orchestration result — not a persistence contract. */
export type StartupReconciliationResult = {
  organizationId: string;
  executionMode: StartupExecutionMode;
  runStartedAt: Date;
  reconciliation: ReconciliationReport;
  escalation: ReconciliationEscalationReport;
};

export type StartupReconciliationDeps = {
  reconciliationService: ReconciliationService;
  triggerPort: KillSwitchTriggerPort;
  reconciliationTelemetrySink?: WaiaTraderTelemetrySink;
  nowMs?: () => number;
};

export type StartupReconciliationRunner = {
  runStartupReconciliation(
    context: OrgContext,
    executionMode: StartupExecutionMode,
  ): Promise<StartupReconciliationResult>;
};
