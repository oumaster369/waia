import type {
  PaymentEventRecordPayload,
  PaymentEventRecordView,
  SettlementEvidence,
} from "@/lib/waia-core/payments/payment-events.types";
import { verifyPaymentEventDigest } from "@/lib/waia-core/payments/serialize-payment-events";

type PaymentEventRow = {
  id: string;
  paymentId: string;
  organizationId: string;
  seq: number;
  eventType: PaymentEventRecordPayload["eventType"];
  direction: PaymentEventRecordPayload["direction"];
  subjectModule: PaymentEventRecordPayload["subjectModule"];
  subjectInvoiceId: string | null;
  idempotencyKey: string | null;
  reason: PaymentEventRecordPayload["reason"];
  settlementNetwork: string | null;
  settlementAsset: string | null;
  settlementAmount: string | null;
  settlementTxHash: string | null;
  transferIndex: number | null;
  confirmationsRequired: number | null;
  confirmationsObserved: number | null;
  blockHeight: string | null;
  observedAt: Date | null;
  confirmedAt: Date | null;
  valuedAmountUsd: string | null;
  valuationSource: string | null;
  valuationAt: Date | null;
  evidenceRef: string | null;
  paymentAddressId: string | null;
  schemaVersion: string;
  recordContentDigest: string;
  prevEventDigest: string | null;
  createdAt: Date;
};

function mapSettlementFromRow(row: PaymentEventRow): SettlementEvidence | null {
  if (!row.settlementTxHash || row.transferIndex === null || !row.settlementNetwork) {
    return null;
  }
  if (
    !row.settlementAsset ||
    !row.settlementAmount ||
    row.confirmationsRequired === null ||
    row.confirmationsObserved === null ||
    !row.observedAt ||
    !row.confirmedAt ||
    !row.valuedAmountUsd ||
    !row.valuationSource ||
    !row.valuationAt
  ) {
    return null;
  }

  return {
    settlementNetwork: row.settlementNetwork,
    settlementAsset: row.settlementAsset,
    settlementAmount: row.settlementAmount,
    settlementTxHash: row.settlementTxHash,
    transferIndex: row.transferIndex,
    confirmationsRequired: row.confirmationsRequired,
    confirmationsObserved: row.confirmationsObserved,
    blockHeight: row.blockHeight,
    observedAt: row.observedAt,
    confirmedAt: row.confirmedAt,
    valuedAmountUsd: row.valuedAmountUsd,
    valuationSource: row.valuationSource,
    valuationAt: row.valuationAt,
    evidenceRef: row.evidenceRef,
  };
}

export function mapPaymentEventRow(row: PaymentEventRow): PaymentEventRecordView {
  const view: PaymentEventRecordView = {
    id: row.id,
    organizationId: row.organizationId,
    paymentId: row.paymentId,
    seq: row.seq,
    eventType: row.eventType,
    direction: row.direction,
    subjectModule: row.subjectModule,
    subjectInvoiceId: row.subjectInvoiceId,
    idempotencyKey: row.idempotencyKey,
    reason: row.reason,
    paymentAddressId: row.paymentAddressId,
    settlement: mapSettlementFromRow(row),
    prevEventDigest: row.prevEventDigest,
    schemaVersion: row.schemaVersion as PaymentEventRecordPayload["schemaVersion"],
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
  };
  verifyPaymentEventDigest(view);
  return view;
}

export function paymentEventPayloadToInsertValues(
  id: string,
  organizationId: string,
  payload: PaymentEventRecordPayload,
  createdAt: Date,
) {
  const settlement = payload.settlement;
  return {
    id,
    paymentId: payload.paymentId,
    organizationId,
    seq: payload.seq,
    eventType: payload.eventType,
    direction: payload.direction,
    subjectModule: payload.subjectModule,
    subjectInvoiceId: payload.subjectInvoiceId,
    idempotencyKey: payload.idempotencyKey,
    reason: payload.reason,
    settlementNetwork: settlement?.settlementNetwork ?? null,
    settlementAsset: settlement?.settlementAsset ?? null,
    settlementAmount: settlement?.settlementAmount ?? null,
    settlementTxHash: settlement?.settlementTxHash ?? null,
    transferIndex: settlement?.transferIndex ?? null,
    confirmationsRequired: settlement?.confirmationsRequired ?? null,
    confirmationsObserved: settlement?.confirmationsObserved ?? null,
    blockHeight: settlement?.blockHeight ?? null,
    observedAt: settlement?.observedAt ?? null,
    confirmedAt: settlement?.confirmedAt ?? null,
    valuedAmountUsd: settlement?.valuedAmountUsd ?? null,
    valuationSource: settlement?.valuationSource ?? null,
    valuationAt: settlement?.valuationAt ?? null,
    evidenceRef: settlement?.evidenceRef ?? null,
    paymentAddressId: payload.paymentAddressId,
    schemaVersion: payload.schemaVersion,
    recordContentDigest: payload.recordContentDigest,
    prevEventDigest: payload.prevEventDigest,
    createdAt,
  };
}
