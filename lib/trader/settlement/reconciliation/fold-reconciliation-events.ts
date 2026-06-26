import {
  RECONCILIATION_EVENT_CASE_CLAIMED,
  RECONCILIATION_EVENT_CASE_ESCALATED,
  RECONCILIATION_EVENT_CASE_OPENED,
  RECONCILIATION_EVENT_CASE_RELEASED,
  RECONCILIATION_EVENT_CASE_REOPENED,
  RECONCILIATION_EVENT_CLAIM_EXPIRED,
  RECONCILIATION_EVENT_PROPOSAL_CANCELLED,
  RECONCILIATION_EVENT_RESOLUTION_EXECUTED,
  RECONCILIATION_EVENT_RESOLUTION_PROPOSED,
  RECONCILIATION_EVENT_REVIEW_STARTED,
} from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import type {
  CaseClaimedEventPayload,
  CaseEscalatedEventPayload,
  CaseOpenedEventPayload,
  CaseReleasedEventPayload,
  CaseReopenedEventPayload,
  ClaimExpiredEventPayload,
  ProposalCancelledEventPayload,
  ResolutionExecutedEventPayload,
  ResolutionProposedEventPayload,
  ReviewStartedEventPayload,
} from "@/lib/trader/settlement/reconciliation/reconciliation.event-payloads";
import type {
  ReconciliationCaseView,
  ReconciliationEventRecordView,
  ReconciliationEvidenceSnapshot,
  ReconciliationResolutionType,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import {
  RECONCILIATION_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
  inlineEvidenceValue,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";

export type FoldedReconciliationProjection = Omit<
  ReconciliationCaseView,
  | "id"
  | "organizationId"
  | "settlementId"
  | "paymentId"
  | "exchangeAccountId"
  | "exceptionReason"
  | "openedAt"
>;

export function normalizeLegacyEvidenceSnapshot(
  payload: unknown,
): ReconciliationEvidenceSnapshot | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if ("evidenceSnapshot" in record) {
    return record.evidenceSnapshot as ReconciliationEvidenceSnapshot;
  }
  if ("settlement" in record && !("schemaVersion" in record)) {
    const legacy = record as {
      settlement: ReconciliationEvidenceSnapshot["settlement"];
      payment: {
        paymentId: string;
        settlementNetwork: string | null;
        settlementAsset: string | null;
        settlementAmount: string | null;
        settlementTxHash: string | null;
        transferIndex: number | null;
      } | null;
      invoiceCandidates: Array<{
        id: string;
        status: string;
        performanceFee: string;
        periodStart: string;
      }>;
      applications: Array<{
        id: string;
        invoiceId: string;
        appliedAmount: string;
        applicationSource: "AUTO" | "MANUAL";
      }>;
    };
    return {
      schemaVersion: RECONCILIATION_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
      settlement: legacy.settlement,
      payment: legacy.payment ? inlineEvidenceValue(legacy.payment) : null,
      invoiceCandidates: inlineEvidenceValue(legacy.invoiceCandidates),
      applications: inlineEvidenceValue(legacy.applications),
    };
  }
  if ("schemaVersion" in record) {
    return record as ReconciliationEvidenceSnapshot;
  }
  return null;
}

export function foldReconciliationEvents(
  events: ReconciliationEventRecordView[],
  seed: Pick<ReconciliationCaseView, "priority" | "exceptionReason" | "openedAt">,
): FoldedReconciliationProjection {
  let status: ReconciliationCaseView["status"] = "OPEN";
  let assignedTo: string | null = null;
  let claimExpiresAt: Date | null = null;
  let coolingOffUntil: Date | null = null;
  let resolutionType: ReconciliationResolutionType | null = null;
  let currentDecisionId: string | null = null;
  let resolvedAt: Date | null = null;
  let lastEventSeq = 0;
  let lastEventDigest = "";

  for (const event of events) {
    lastEventSeq = event.seq;
    lastEventDigest = event.recordContentDigest;

    switch (event.eventType) {
      case RECONCILIATION_EVENT_CASE_OPENED: {
        const payload = event.payload as CaseOpenedEventPayload;
        break;
      }
      case RECONCILIATION_EVENT_CASE_CLAIMED: {
        const payload = event.payload as CaseClaimedEventPayload;
        status = "ASSIGNED";
        assignedTo = payload.assignedTo;
        claimExpiresAt = new Date(payload.claimExpiresAt);
        break;
      }
      case RECONCILIATION_EVENT_CASE_RELEASED:
      case RECONCILIATION_EVENT_CLAIM_EXPIRED: {
        status = "OPEN";
        assignedTo = null;
        claimExpiresAt = null;
        break;
      }
      case RECONCILIATION_EVENT_REVIEW_STARTED: {
        status = "UNDER_REVIEW";
        break;
      }
      case RECONCILIATION_EVENT_RESOLUTION_PROPOSED: {
        const payload = event.payload as ResolutionProposedEventPayload;
        status = "DECISION_PENDING";
        currentDecisionId = payload.decisionId;
        resolutionType = payload.resolutionType;
        coolingOffUntil = new Date(payload.coolingOffUntil);
        break;
      }
      case RECONCILIATION_EVENT_PROPOSAL_CANCELLED: {
        status = "UNDER_REVIEW";
        coolingOffUntil = null;
        resolutionType = null;
        currentDecisionId = null;
        break;
      }
      case RECONCILIATION_EVENT_RESOLUTION_EXECUTED: {
        const payload = event.payload as ResolutionExecutedEventPayload;
        status = "RESOLVED";
        resolvedAt = new Date(payload.effectiveAt);
        resolutionType = payload.resolutionType;
        currentDecisionId = payload.decisionId;
        coolingOffUntil = null;
        assignedTo = null;
        claimExpiresAt = null;
        break;
      }
      case RECONCILIATION_EVENT_CASE_ESCALATED: {
        status = "ESCALATED";
        coolingOffUntil = null;
        resolutionType = null;
        currentDecisionId = null;
        break;
      }
      case RECONCILIATION_EVENT_CASE_REOPENED: {
        status = "UNDER_REVIEW";
        break;
      }
      default:
        break;
    }
  }

  return {
    status,
    priority: seed.priority,
    resolutionType,
    currentDecisionId,
    assignedTo,
    claimExpiresAt,
    coolingOffUntil,
    resolvedAt,
    lastEventSeq,
    lastEventDigest,
  };
}

export function rebuildCaseProjection(
  caseRow: ReconciliationCaseView,
  events: ReconciliationEventRecordView[],
): ReconciliationCaseView {
  const folded = foldReconciliationEvents(events, {
    priority: caseRow.priority,
    exceptionReason: caseRow.exceptionReason,
    openedAt: caseRow.openedAt,
  });
  return {
    ...caseRow,
    ...folded,
  };
}

export function extractCaseOpenedEvidence(
  events: ReconciliationEventRecordView[],
): ReconciliationEvidenceSnapshot | null {
  const opened = events.find((e) => e.eventType === RECONCILIATION_EVENT_CASE_OPENED);
  if (!opened) {
    return null;
  }
  const payload = opened.payload;
  if (payload && typeof payload === "object" && "evidenceSnapshot" in payload) {
    return (payload as CaseOpenedEventPayload).evidenceSnapshot;
  }
  return normalizeLegacyEvidenceSnapshot(payload);
}

export function findEventByIdempotencyKey(
  events: ReconciliationEventRecordView[],
  idempotencyKey: string,
): ReconciliationEventRecordView | null {
  for (const event of events) {
    const payload = event.payload as { idempotencyKey?: string };
    if (payload?.idempotencyKey === idempotencyKey) {
      return event;
    }
  }
  return null;
}

export function findLiveProposalEvent(
  events: ReconciliationEventRecordView[],
): ReconciliationEventRecordView | null {
  let live: ReconciliationEventRecordView | null = null;
  for (const event of events) {
    if (event.eventType === RECONCILIATION_EVENT_RESOLUTION_PROPOSED) {
      live = event;
    }
    if (
      event.eventType === RECONCILIATION_EVENT_PROPOSAL_CANCELLED ||
      event.eventType === RECONCILIATION_EVENT_RESOLUTION_EXECUTED ||
      event.eventType === RECONCILIATION_EVENT_CASE_ESCALATED
    ) {
      live = null;
    }
  }
  return live;
}
