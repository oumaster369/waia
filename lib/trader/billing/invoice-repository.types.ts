import type { InvoiceRecordPayload, InvoiceRecordView } from "@/lib/trader/billing/invoice.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type InsertInvoiceRepoInput = {
  payload: InvoiceRecordPayload;
};

export type InvoiceRepository = {
  insertInvoice(
    context: OrgContext,
    input: InsertInvoiceRepoInput,
  ): InvoiceRecordView | Promise<InvoiceRecordView>;

  findByReportingPeriod(
    context: OrgContext,
    exchangeAccountId: string,
    reportingPeriodId: string,
  ): InvoiceRecordView | null | Promise<InvoiceRecordView | null>;

  getById(
    context: OrgContext,
    id: string,
  ): InvoiceRecordView | null | Promise<InvoiceRecordView | null>;
};
