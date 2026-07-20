import {
  invoiceCorrectionTypeEnum,
  invoiceDisputeEventTypeEnum,
  invoiceDisputeStatusEnum,
} from "@/db/core-enums";

export const INVOICE_DISPUTE_EVENT_SCHEMA_VERSION = "waia.trader.invoice-dispute-event.v1" as const;
export type InvoiceDisputeEventSchemaVersion = typeof INVOICE_DISPUTE_EVENT_SCHEMA_VERSION;

export const INVOICE_CORRECTION_SCHEMA_VERSION = "waia.trader.invoice-correction.v1" as const;
export type InvoiceCorrectionSchemaVersion = typeof INVOICE_CORRECTION_SCHEMA_VERSION;

export const invoiceDisputeStatuses = invoiceDisputeStatusEnum;
export type InvoiceDisputeStatus = (typeof invoiceDisputeStatuses)[number];

export const invoiceDisputeEventTypes = invoiceDisputeEventTypeEnum;
export type InvoiceDisputeEventType = (typeof invoiceDisputeEventTypes)[number];

export const invoiceCorrectionTypes = invoiceCorrectionTypeEnum;
export type InvoiceCorrectionType = (typeof invoiceCorrectionTypes)[number];

export type InvoiceDisputeEventRecordPayload = {
  schemaVersion: InvoiceDisputeEventSchemaVersion;
  organizationId: string;
  disputeId: string;
  seq: number;
  eventType: InvoiceDisputeEventType;
  reason: string | null;
  actorType: string;
  actorId: string | null;
  prevEventDigest: string | null;
  recordContentDigest: string;
};

export type InvoiceDisputeEventRecordView = InvoiceDisputeEventRecordPayload & {
  id: string;
  createdAt: Date;
};

export type InvoiceDisputeProjectionView = {
  id: string;
  organizationId: string;
  invoiceId: string;
  exchangeAccountId: string;
  status: InvoiceDisputeStatus;
  reason: string | null;
  openedBy: string | null;
  openedAt: Date;
  resolvedAt: Date | null;
  resolutionReason: string | null;
  lastEventSeq: number;
  lastEventDigest: string;
  createdAt: Date;
  updatedAt: Date;
};

export type InvoiceCorrectionRecordPayload = {
  schemaVersion: InvoiceCorrectionSchemaVersion;
  organizationId: string;
  invoiceId: string;
  disputeId: string | null;
  exchangeAccountId: string;
  reportingPeriodId: string;
  correctionType: InvoiceCorrectionType;
  amount: string;
  currency: string;
  restoredHwm: string;
  hwmLedgerEntryId: string;
  reason: string;
  actorType: string;
  actorId: string | null;
  recordContentDigest: string;
};

export type InvoiceCorrectionRecordView = InvoiceCorrectionRecordPayload & {
  id: string;
  createdAt: Date;
};
