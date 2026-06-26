import type { ReconciliationEvidenceSnapshot } from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import type { CaseOpenedEventPayload } from "@/lib/trader/settlement/reconciliation/reconciliation.event-payloads";

export const RECONCILIATION_EVENT_CASE_OPENED = "CASE_OPENED" as const;
export const RECONCILIATION_EVENT_CASE_CLAIMED = "CASE_CLAIMED" as const;
export const RECONCILIATION_EVENT_CASE_RELEASED = "CASE_RELEASED" as const;
export const RECONCILIATION_EVENT_CLAIM_EXPIRED = "CLAIM_EXPIRED" as const;
export const RECONCILIATION_EVENT_REVIEW_STARTED = "REVIEW_STARTED" as const;
export const RECONCILIATION_EVENT_RESOLUTION_PROPOSED = "RESOLUTION_PROPOSED" as const;
export const RECONCILIATION_EVENT_PROPOSAL_CANCELLED = "PROPOSAL_CANCELLED" as const;
export const RECONCILIATION_EVENT_RESOLUTION_EXECUTED = "RESOLUTION_EXECUTED" as const;
export const RECONCILIATION_EVENT_CASE_ESCALATED = "CASE_ESCALATED" as const;
export const RECONCILIATION_EVENT_CASE_REOPENED = "CASE_REOPENED" as const;

/** Reserved — never emitted in S3-C-B MVP (forward-compat seam). */
export const RECONCILIATION_EVENT_RESOLUTION_RECOMMENDED = "RESOLUTION_RECOMMENDED" as const;

export const reconciliationEventTypes = [
  RECONCILIATION_EVENT_CASE_OPENED,
  RECONCILIATION_EVENT_CASE_CLAIMED,
  RECONCILIATION_EVENT_CASE_RELEASED,
  RECONCILIATION_EVENT_CLAIM_EXPIRED,
  RECONCILIATION_EVENT_REVIEW_STARTED,
  RECONCILIATION_EVENT_RESOLUTION_PROPOSED,
  RECONCILIATION_EVENT_PROPOSAL_CANCELLED,
  RECONCILIATION_EVENT_RESOLUTION_EXECUTED,
  RECONCILIATION_EVENT_CASE_ESCALATED,
  RECONCILIATION_EVENT_CASE_REOPENED,
] as const;

export type ReconciliationEventType = (typeof reconciliationEventTypes)[number];

export function buildCaseOpenedEventPayload(input: {
  evidenceSnapshot: ReconciliationEvidenceSnapshot;
  exceptionReason: string | null;
  priority: number;
}): CaseOpenedEventPayload {
  return {
    evidenceSnapshot: input.evidenceSnapshot,
    exceptionReason: input.exceptionReason,
    priority: input.priority,
  };
}

/** @deprecated S3-C-A shape — use buildCaseOpenedEventPayload with wrapped snapshot. */
export function buildLegacyCaseOpenedPayload(
  evidence: ReconciliationEvidenceSnapshot,
): ReconciliationEvidenceSnapshot {
  return evidence;
}
