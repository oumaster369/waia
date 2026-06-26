import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import type {
  SettlementApplicationRecordPayload,
  SettlementApplicationRecordView,
  SettlementRecordPayload,
  SettlementRecordView,
} from "@/lib/trader/settlement/settlement.types";

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
    payload: SettlementApplicationRecordPayload,
  ): Promise<SettlementApplicationRecordView>;
  listBySettlementId(
    context: OrgContext,
    settlementId: string,
  ): Promise<SettlementApplicationRecordView[]>;
};
