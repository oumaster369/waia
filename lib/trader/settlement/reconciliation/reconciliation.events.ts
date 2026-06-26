import type { ReconciliationEvidenceSnapshot } from "@/lib/trader/settlement/reconciliation/reconciliation.types";

export const RECONCILIATION_EVENT_CASE_OPENED = "CASE_OPENED" as const;

export function buildCaseOpenedEventPayload(
  evidence: ReconciliationEvidenceSnapshot,
): ReconciliationEvidenceSnapshot {
  return evidence;
}
