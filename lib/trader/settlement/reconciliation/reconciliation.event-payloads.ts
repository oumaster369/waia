import type { settlementReconciliationResolutionTypeEnum } from "@/db/core-enums";
import type { ReconciliationEvidenceSnapshot } from "@/lib/trader/settlement/reconciliation/reconciliation.types";

export type ReconciliationResolutionType =
  (typeof settlementReconciliationResolutionTypeEnum)[number];

export type ReconciliationProjectedImpact = {
  resolutionType: ReconciliationResolutionType;
  targetInvoiceId: string | null;
  appliedAmount: string | null;
  invoiceStatusAfter: string | null;
  accountReactivation: boolean;
};

export type ReconciliationProposalRef = {
  seq: number;
  digest: string;
};

export type ReconciliationSettlementApplicationRef = {
  applicationId: string;
  settlementId: string;
  invoiceId: string;
  appliedAmount: string;
};

/** CASE_OPENED — only event that embeds the evidence snapshot. */
export type CaseOpenedEventPayload = {
  evidenceSnapshot: ReconciliationEvidenceSnapshot;
  exceptionReason: string | null;
  priority: number;
};

export type CaseClaimedEventPayload = {
  assignedTo: string;
  claimExpiresAt: string;
  idempotencyKey: string;
};

export type CaseReleasedEventPayload = {
  reason?: string;
  idempotencyKey: string;
};

export type ClaimExpiredEventPayload = {
  expiredAssignee: string;
  claimExpiresAt: string;
  idempotencyKey: string;
};

export type ReviewStartedEventPayload = {
  idempotencyKey: string;
};

export type ResolutionProposedEventPayload = {
  decisionId: string;
  resolutionType: ReconciliationResolutionType;
  targetInvoiceId: string | null;
  projectedImpact: ReconciliationProjectedImpact;
  rationale: string;
  coolingOffUntil: string;
  recommendationRef: string | null;
  idempotencyKey: string;
};

export type ProposalCancelledEventPayload = {
  decisionId: string;
  reason: string;
  idempotencyKey: string;
};

export type ResolutionExecutedEventPayload = {
  decisionId: string;
  proposalRef: ReconciliationProposalRef;
  resolutionType: ReconciliationResolutionType;
  settlementApplicationRef: ReconciliationSettlementApplicationRef | null;
  effectiveAt: string;
  idempotencyKey: string;
};

export type CaseEscalatedEventPayload = {
  reason: string;
  idempotencyKey: string;
};

export type CaseReopenedEventPayload = {
  reason: string;
  idempotencyKey: string;
};

/** Reserved — never emitted in S3-C-B MVP. */
export type ResolutionRecommendedEventPayload = {
  recommendationId: string;
  resolutionType: ReconciliationResolutionType;
  targetInvoiceId: string | null;
  rationale: string;
  confidence: number | null;
  modelVersion: string | null;
};

export type ReconciliationEventPayload =
  | CaseOpenedEventPayload
  | CaseClaimedEventPayload
  | CaseReleasedEventPayload
  | ClaimExpiredEventPayload
  | ReviewStartedEventPayload
  | ResolutionProposedEventPayload
  | ProposalCancelledEventPayload
  | ResolutionExecutedEventPayload
  | CaseEscalatedEventPayload
  | CaseReopenedEventPayload;

export function isResolutionProposedPayload(
  payload: unknown,
): payload is ResolutionProposedEventPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "decisionId" in payload &&
    "resolutionType" in payload &&
    "coolingOffUntil" in payload
  );
}
