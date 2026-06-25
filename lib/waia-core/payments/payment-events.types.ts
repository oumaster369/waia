import {
  paymentDirectionEnum,
  paymentEventTypeEnum,
  paymentFailureReasonEnum,
  paymentSubjectModuleEnum,
} from "@/db/core-enums";

export const PAYMENT_EVENT_SCHEMA_VERSION = "waia.core.payment-event.v1" as const;

export type PaymentEventSchemaVersion = typeof PAYMENT_EVENT_SCHEMA_VERSION;

export const paymentEventTypes = paymentEventTypeEnum;
export type PaymentEventType = (typeof paymentEventTypes)[number];

export const paymentDirections = paymentDirectionEnum;
export type PaymentDirection = (typeof paymentDirections)[number];

export const paymentSubjectModules = paymentSubjectModuleEnum;
export type PaymentSubjectModule = (typeof paymentSubjectModules)[number];

export const paymentFailureReasons = paymentFailureReasonEnum;
export type PaymentFailureReason = (typeof paymentFailureReasons)[number];

/** Settlement evidence captured on CONFIRMED events. */
export type SettlementEvidence = {
  settlementNetwork: string;
  settlementAsset: string;
  settlementAmount: string;
  settlementTxHash: string;
  transferIndex: number;
  confirmationsRequired: number;
  confirmationsObserved: number;
  blockHeight: string | null;
  observedAt: Date;
  confirmedAt: Date;
  valuedAmountUsd: string;
  valuationSource: string;
  valuationAt: Date;
  evidenceRef: string | null;
};

export type PaymentEventRecordPayload = {
  schemaVersion: PaymentEventSchemaVersion;
  organizationId: string;
  paymentId: string;
  seq: number;
  eventType: PaymentEventType;
  direction: PaymentDirection;
  subjectModule: PaymentSubjectModule;
  subjectInvoiceId: string | null;
  idempotencyKey: string | null;
  reason: PaymentFailureReason | null;
  paymentAddressId: string | null;
  settlement: SettlementEvidence | null;
  prevEventDigest: string | null;
  recordContentDigest: string;
};

export type PaymentEventRecordView = PaymentEventRecordPayload & {
  id: string;
  createdAt: Date;
};

export type PaymentEventDigestInput = {
  organizationId: string;
  paymentId: string;
  seq: number;
  eventType: PaymentEventType;
  direction: PaymentDirection;
  subjectModule: PaymentSubjectModule;
  subjectInvoiceId: string | null;
  idempotencyKey: string | null;
  reason: PaymentFailureReason | null;
  paymentAddressId: string | null;
  settlement: SettlementEvidence | null;
  prevEventDigest: string | null;
};
