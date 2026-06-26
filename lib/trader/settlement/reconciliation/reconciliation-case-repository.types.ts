import type {
  ReconciliationCaseView,
  ReconciliationEventRecordPayload,
  ReconciliationEventRecordView,
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

export type ReconciliationCaseRepository = {
  findBySettlementId(
    context: OrgContext,
    settlementId: string,
  ): Promise<ReconciliationCaseView | null>;
  openCase(
    context: OrgContext,
    input: OpenReconciliationCaseInput,
  ): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }>;
  listEventsForCase(context: OrgContext, caseId: string): Promise<ReconciliationEventRecordView[]>;
};
