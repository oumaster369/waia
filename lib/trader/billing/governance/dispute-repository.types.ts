import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import type {
  InvoiceDisputeEventRecordPayload,
  InvoiceDisputeEventRecordView,
  InvoiceDisputeProjectionView,
} from "@/lib/trader/billing/governance/billing-governance.types";

export type InvoiceDisputeRepository = {
  findOpenByInvoiceId(
    context: OrgContext,
    invoiceId: string,
  ): Promise<InvoiceDisputeProjectionView | null>;
  getById(context: OrgContext, disputeId: string): Promise<InvoiceDisputeProjectionView | null>;
  listEventsForDispute(
    context: OrgContext,
    disputeId: string,
  ): Promise<InvoiceDisputeEventRecordView[]>;
  appendEventAndProjection(
    context: OrgContext,
    payload: InvoiceDisputeEventRecordPayload,
    projection: InvoiceDisputeProjectionView,
  ): Promise<InvoiceDisputeEventRecordView>;
  listOpenDisputeInvoiceIds(context: OrgContext): Promise<string[]>;
};
