import type { InvoiceRecordPayload, InvoiceRecordView } from "@/lib/trader/billing/invoice.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type InsertInvoiceRepoInput = {
  payload: InvoiceRecordPayload;
};

export type SetIssuanceApprovalMetadataInput = {
  invoiceId: string;
  issuanceApprovedAt: Date;
  issuanceApprovedBy: string;
  coolingOffUntil: Date;
};

export type ClearIssuanceApprovalMetadataInput = {
  invoiceId: string;
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

  setIssuanceApprovalMetadata(
    context: OrgContext,
    input: SetIssuanceApprovalMetadataInput,
  ): InvoiceRecordView | Promise<InvoiceRecordView>;

  clearIssuanceApprovalMetadata(
    context: OrgContext,
    input: ClearIssuanceApprovalMetadataInput,
  ): InvoiceRecordView | Promise<InvoiceRecordView>;
};
