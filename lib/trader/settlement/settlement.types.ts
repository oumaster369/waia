import {
  accountStatusEnum,
  accountStatusEventTypeEnum,
  settlementOutcomeEnum,
} from "@/db/core-enums";
import type { PaymentSubjectModule } from "@/lib/waia-core/payments/payment-events.types";

export const SETTLEMENT_SCHEMA_VERSION = "waia.trader.settlement.v1" as const;
export type SettlementSchemaVersion = typeof SETTLEMENT_SCHEMA_VERSION;

export const SETTLEMENT_APPLICATION_SCHEMA_VERSION =
  "waia.trader.settlement-application.v1" as const;
export type SettlementApplicationSchemaVersion = typeof SETTLEMENT_APPLICATION_SCHEMA_VERSION;

export const ACCOUNT_STATUS_EVENT_SCHEMA_VERSION = "waia.trader.account-status-event.v1" as const;
export type AccountStatusEventSchemaVersion = typeof ACCOUNT_STATUS_EVENT_SCHEMA_VERSION;

export const settlementOutcomes = settlementOutcomeEnum;
export type SettlementOutcome = (typeof settlementOutcomes)[number];

export const accountStatuses = accountStatusEnum;
export type AccountStatus = (typeof accountStatuses)[number];

export const accountStatusEventTypes = accountStatusEventTypeEnum;
export type AccountStatusEventType = (typeof accountStatusEventTypes)[number];

export const settlementExceptionReasons = {
  unsupportedAssetOrNetwork: "UNSUPPORTED_ASSET_OR_NETWORK",
  missingAttribution: "MISSING_ATTRIBUTION",
  missingOnChainAmount: "MISSING_ON_CHAIN_AMOUNT",
  noCandidateInvoice: "NO_CANDIDATE_INVOICE",
  multipleCandidateInvoices: "MULTIPLE_CANDIDATE_INVOICES",
  amountMismatch: "AMOUNT_MISMATCH",
  invoiceNotIssued: "INVOICE_NOT_ISSUED",
  invoiceNotFound: "INVOICE_NOT_FOUND",
} as const;

export type SettlementExceptionReason =
  (typeof settlementExceptionReasons)[keyof typeof settlementExceptionReasons];

/** Default amount tolerance for exact-match auto-settlement (USD minor units). */
export const DEFAULT_SETTLEMENT_AMOUNT_TOLERANCE = "0";

export type ConfirmedPaymentForSettlement = {
  paymentId: string;
  organizationId: string;
  subjectModule: PaymentSubjectModule;
  settlementNetwork: string | null;
  settlementAsset: string | null;
  settlementAmount: string | null;
  settlementTxHash: string | null;
  transferIndex: number | null;
  blockHeight: string | null;
  paymentAddressId: string | null;
  exchangeAccountId: string | null;
  updatedAt: Date;
};

export type InvoiceSettlementCandidate = {
  id: string;
  organizationId: string;
  exchangeAccountId: string;
  performanceFee: string;
  status: string;
  periodStart: Date;
};

export type SettlementRecordPayload = {
  schemaVersion: SettlementSchemaVersion;
  organizationId: string;
  exchangeAccountId: string;
  paymentId: string;
  settlementNetwork: string | null;
  settlementTxHash: string | null;
  transferIndex: number | null;
  blockHeight: string | null;
  asset: string | null;
  onChainAmount: string | null;
  valuedAmount: string | null;
  valuationCurrency: string | null;
  valuationBasis: string | null;
  outcome: SettlementOutcome;
  exceptionReason: string | null;
  prevEventDigest: string | null;
  recordContentDigest: string;
};

export type SettlementRecordView = SettlementRecordPayload & {
  id: string;
  createdAt: Date;
};

export type SettlementApplicationRecordPayload = {
  schemaVersion: SettlementApplicationSchemaVersion;
  settlementId: string;
  organizationId: string;
  invoiceId: string;
  appliedAmount: string;
  invoiceStatusAfter: "PAID";
  recordContentDigest: string;
};

export type SettlementApplicationRecordView = SettlementApplicationRecordPayload & {
  id: string;
  createdAt: Date;
};

export type AccountStatusEventRecordPayload = {
  schemaVersion: AccountStatusEventSchemaVersion;
  organizationId: string;
  exchangeAccountId: string;
  seq: number;
  eventType: AccountStatusEventType;
  reason: string | null;
  sourcePaymentId: string | null;
  sourceInvoiceId: string | null;
  prevEventDigest: string | null;
  recordContentDigest: string;
};

export type AccountStatusEventRecordView = AccountStatusEventRecordPayload & {
  id: string;
  createdAt: Date;
};

export type AccountStatusProjectionView = {
  organizationId: string;
  exchangeAccountId: string;
  status: AccountStatus;
  reason: string | null;
  lastEventSeq: number;
  lastEventDigest: string;
  createdAt: Date;
  updatedAt: Date;
};

export type SettlementEvaluation = {
  outcome: SettlementOutcome;
  exceptionReason: string | null;
  exchangeAccountId: string;
  invoiceId: string | null;
  appliedAmount: string | null;
  valuedAmount: string | null;
  valuationCurrency: string | null;
  valuationBasis: string | null;
};
