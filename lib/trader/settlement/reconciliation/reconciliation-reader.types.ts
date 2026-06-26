import type {
  ReconciliationCaseDetail,
  ReconciliationCaseListQuery,
  ReconciliationCaseListResult,
  ReconciliationCaseView,
  ReconciliationHealthMetrics,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import type { SettlementRecordView } from "@/lib/trader/settlement/settlement.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type ReconciliationReader = {
  listCases(
    context: OrgContext,
    query: ReconciliationCaseListQuery,
  ): Promise<ReconciliationCaseListResult>;
  getCaseDetail(context: OrgContext, caseId: string): Promise<ReconciliationCaseDetail | null>;
  listExceptionSettlementsWithoutCase(context: OrgContext): Promise<SettlementRecordView[]>;
  getHealthMetrics(): Promise<ReconciliationHealthMetrics>;
};
