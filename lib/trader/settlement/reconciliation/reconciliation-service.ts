import type { ReconciliationReader } from "@/lib/trader/settlement/reconciliation/reconciliation-reader.types";
import type {
  ReconciliationCaseDetail,
  ReconciliationCaseListQuery,
  ReconciliationCaseListResult,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type ReconciliationService = {
  listCases(
    context: OrgContext,
    query: ReconciliationCaseListQuery,
  ): Promise<ReconciliationCaseListResult>;
  getCaseDetail(context: OrgContext, caseId: string): Promise<ReconciliationCaseDetail | null>;
};

export function createReconciliationService(reader: ReconciliationReader): ReconciliationService {
  return {
    listCases(context, query) {
      return reader.listCases(context, query);
    },
    getCaseDetail(context, caseId) {
      return reader.getCaseDetail(context, caseId);
    },
  };
}
