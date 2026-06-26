import type { SettlementApplicationRecordView } from "@/lib/trader/settlement/settlement.types";
import type {
  ReconciliationCaseView,
  SettlementReconciliationEffectiveOutcome,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";

export function effectiveOutcome(input: {
  applications: SettlementApplicationRecordView[];
  case: ReconciliationCaseView;
}): SettlementReconciliationEffectiveOutcome {
  if (input.applications.length > 0) {
    return "FINANCIALLY_APPLIED";
  }

  if (
    input.case.status === "RESOLVED" &&
    input.case.resolutionType !== null &&
    input.case.resolutionType !== "MANUAL_APPLY"
  ) {
    return "CLOSED_WITHOUT_APPLICATION";
  }

  return "PENDING_RECONCILIATION";
}
