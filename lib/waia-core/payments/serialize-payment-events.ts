import { createHash } from "node:crypto";

import {
  PaymentChainBrokenError,
  PaymentDigestMismatchError,
} from "@/lib/waia-core/payments/payment.errors";
import { canonicalJsonString } from "@/lib/waia-core/payments/canonical-json";
import {
  PAYMENT_EVENT_SCHEMA_VERSION,
  type PaymentEventDigestInput,
  type PaymentEventRecordPayload,
  type PaymentEventRecordView,
  type SettlementEvidence,
} from "@/lib/waia-core/payments/payment-events.types";

export type SerializedSettlementEvidence = {
  settlementNetwork: string;
  settlementAsset: string;
  settlementAmount: string;
  settlementTxHash: string;
  transferIndex: number;
  confirmationsRequired: number;
  confirmationsObserved: number;
  blockHeight: string | null;
  observedAt: string;
  confirmedAt: string;
  valuedAmountUsd: string;
  valuationSource: string;
  valuationAt: string;
  evidenceRef: string | null;
};

export type SerializedPaymentEventDigestInput = {
  schemaVersion: typeof PAYMENT_EVENT_SCHEMA_VERSION;
  organizationId: string;
  paymentId: string;
  seq: number;
  eventType: PaymentEventDigestInput["eventType"];
  direction: PaymentEventDigestInput["direction"];
  subjectModule: PaymentEventDigestInput["subjectModule"];
  subjectInvoiceId: string | null;
  idempotencyKey: string | null;
  reason: PaymentEventDigestInput["reason"];
  paymentAddressId: string | null;
  settlement: SerializedSettlementEvidence | null;
  prevEventDigest: string | null;
};

function toIsoTimestamp(value: Date): string {
  return value.toISOString();
}

function serializeSettlementEvidence(settlement: SettlementEvidence): SerializedSettlementEvidence {
  return {
    settlementNetwork: settlement.settlementNetwork,
    settlementAsset: settlement.settlementAsset,
    settlementAmount: settlement.settlementAmount,
    settlementTxHash: settlement.settlementTxHash,
    transferIndex: settlement.transferIndex,
    confirmationsRequired: settlement.confirmationsRequired,
    confirmationsObserved: settlement.confirmationsObserved,
    blockHeight: settlement.blockHeight,
    observedAt: toIsoTimestamp(settlement.observedAt),
    confirmedAt: toIsoTimestamp(settlement.confirmedAt),
    valuedAmountUsd: settlement.valuedAmountUsd,
    valuationSource: settlement.valuationSource,
    valuationAt: toIsoTimestamp(settlement.valuationAt),
    evidenceRef: settlement.evidenceRef,
  };
}

export function serializePaymentEventDigestInput(
  input: PaymentEventDigestInput,
): SerializedPaymentEventDigestInput {
  return {
    schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
    organizationId: input.organizationId,
    paymentId: input.paymentId,
    seq: input.seq,
    eventType: input.eventType,
    direction: input.direction,
    subjectModule: input.subjectModule,
    subjectInvoiceId: input.subjectInvoiceId,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    paymentAddressId: input.paymentAddressId,
    settlement: input.settlement ? serializeSettlementEvidence(input.settlement) : null,
    prevEventDigest: input.prevEventDigest,
  };
}

export function computePaymentEventDigest(input: PaymentEventDigestInput): string {
  const canonical = serializePaymentEventDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildPaymentEventRecordPayload(
  input: PaymentEventDigestInput,
): PaymentEventRecordPayload {
  const recordContentDigest = computePaymentEventDigest(input);
  return {
    ...input,
    schemaVersion: PAYMENT_EVENT_SCHEMA_VERSION,
    recordContentDigest,
  };
}

export function verifyPaymentEventDigest(payload: PaymentEventRecordPayload): void {
  const { recordContentDigest, schemaVersion: _schemaVersion, ...digestInput } = payload;
  const expected = computePaymentEventDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new PaymentDigestMismatchError(`${payload.paymentId}:${payload.seq}`);
  }
}

export function verifyPaymentEventChain(events: PaymentEventRecordView[]): void {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let previousDigest: string | null = null;

  for (const event of ordered) {
    verifyPaymentEventDigest(event);
    if (event.prevEventDigest !== previousDigest) {
      throw new PaymentChainBrokenError(event.paymentId, event.seq);
    }
    previousDigest = event.recordContentDigest;
  }
}
