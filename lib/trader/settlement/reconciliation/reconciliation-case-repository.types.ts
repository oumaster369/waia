import type {
  ReconciliationCaseView,
  ReconciliationEventRecordPayload,
  ReconciliationEventRecordView,
  ReconciliationCaseStatus,
  ReconciliationResolutionType,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type OpenReconciliationCaseInput = {
  caseId: string;
  settlementId: string;
  paymentId: string;
  exchangeAccountId: string;
  exceptionReason: string | null;
  priority: number;
  openedAt: Date;
  event: ReconciliationEventRecordPayload;
};

export type ReconciliationCaseProjectionUpdate = {
  status: ReconciliationCaseStatus;
  assignedTo?: string | null;
  claimExpiresAt?: Date | null;
  coolingOffUntil?: Date | null;
  resolutionType?: ReconciliationResolutionType | null;
  currentDecisionId?: string | null;
  resolvedAt?: Date | null;
  lastEventSeq: number;
  lastEventDigest: string;
};

export type AppendReconciliationEventInput = {
  caseId: string;
  expectedLastEventSeq: number;
  event: ReconciliationEventRecordPayload;
  projection: ReconciliationCaseProjectionUpdate;
};

export type ReconciliationCaseRepository = {
  findById(context: OrgContext, caseId: string): Promise<ReconciliationCaseView | null>;
  findBySettlementId(
    context: OrgContext,
    settlementId: string,
  ): Promise<ReconciliationCaseView | null>;
  openCase(
    context: OrgContext,
    input: OpenReconciliationCaseInput,
  ): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }>;
  appendEvent(
    context: OrgContext,
    input: AppendReconciliationEventInput,
  ): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }>;
  listEventsForCase(context: OrgContext, caseId: string): Promise<ReconciliationEventRecordView[]>;
  listClaimExpired(context: OrgContext, now: Date): Promise<ReconciliationCaseView[]>;
};
