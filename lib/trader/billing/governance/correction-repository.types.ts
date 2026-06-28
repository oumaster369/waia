import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import type {
  InvoiceCorrectionRecordPayload,
  InvoiceCorrectionRecordView,
} from "@/lib/trader/billing/governance/billing-governance.types";

export type InvoiceCorrectionRepository = {
  insertCorrection(
    context: OrgContext,
    payload: InvoiceCorrectionRecordPayload,
  ): Promise<InvoiceCorrectionRecordView>;
  listCorrectionsForInvoice(
    context: OrgContext,
    invoiceId: string,
  ): Promise<InvoiceCorrectionRecordView[]>;
};
