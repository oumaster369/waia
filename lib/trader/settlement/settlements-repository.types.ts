import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import type {
  SettlementApplicationRecordPayload,
  SettlementApplicationRecordView,
  SettlementRecordPayload,
  SettlementRecordView,
} from "@/lib/trader/settlement/settlement.types";
import type { SettlementApplicationSource } from "@/lib/trader/settlement/reconciliation/reconciliation.types";

export type InsertSettlementApplicationInput = {
  payload: SettlementApplicationRecordPayload;
  applicationSource?: SettlementApplicationSource;
  reconciliationCaseId?: string | null;
  decisionId?: string | null;
};

export type SettlementsRepository = {
  findByPaymentId(paymentId: string): Promise<SettlementRecordView | null>;
  insertSettlement(
    context: OrgContext,
    payload: SettlementRecordPayload,
  ): Promise<SettlementRecordView>;
};

export type SettlementApplicationsRepository = {
  insertApplication(
    context: OrgContext,
    input: InsertSettlementApplicationInput,
  ): Promise<SettlementApplicationRecordView>;
  listBySettlementId(
    context: OrgContext,
    settlementId: string,
  ): Promise<SettlementApplicationRecordView[]>;
};
