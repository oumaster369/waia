import type { KillSwitchType } from "@/lib/trader/risk/kill-switch/types";
import type { TriggerOutcome } from "@/lib/trader/risk/kill-switch/automatic-trigger";
import type { ReconciliationClassification } from "@/lib/trader/execution/reconciliation.types";

export type EscalationActivationOutcome = TriggerOutcome & {
  switchType: KillSwitchType;
  sourceClassifications: ReconciliationClassification[];
};

export type ReconciliationEscalationReport = {
  organizationId: string;
  escalationsAttempted: number;
  outcomes: EscalationActivationOutcome[];
};
