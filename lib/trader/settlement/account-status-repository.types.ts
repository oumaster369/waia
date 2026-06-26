import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import type {
  AccountStatusEventRecordPayload,
  AccountStatusEventRecordView,
  AccountStatusProjectionView,
} from "@/lib/trader/settlement/settlement.types";

export type AccountStatusRepository = {
  getProjection(
    context: OrgContext,
    exchangeAccountId: string,
  ): Promise<AccountStatusProjectionView | null>;
  listEventsForAccount(
    context: OrgContext,
    exchangeAccountId: string,
  ): Promise<AccountStatusEventRecordView[]>;
  appendEventAndProjection(
    context: OrgContext,
    payload: AccountStatusEventRecordPayload,
    projection: AccountStatusProjectionView,
  ): Promise<AccountStatusEventRecordView>;
};

export type InvoiceSettlementUpdateInput = {
  invoiceId: string;
  settledAmount: string;
  paidAt: Date;
};

export type InvoiceSettlementRepository = {
  listIssuedInvoicesForAccount(
    context: OrgContext,
    exchangeAccountId: string,
  ): Promise<
    Array<{
      id: string;
      organizationId: string;
      exchangeAccountId: string;
      performanceFee: string;
      status: string;
      periodStart: Date;
    }>
  >;
  getInvoiceForSettlementLock(
    context: OrgContext,
    invoiceId: string,
  ): Promise<{
    id: string;
    organizationId: string;
    exchangeAccountId: string;
    performanceFee: string;
    status: string;
    periodStart: Date;
    settledAmount: string;
  } | null>;
  markInvoicePaid(context: OrgContext, input: InvoiceSettlementUpdateInput): Promise<void>;
};
