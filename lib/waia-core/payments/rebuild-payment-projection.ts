import { eventTypeToStatus } from "@/lib/waia-core/payments/payment-lifecycle.transitions";
import type { PaymentEventRecordView } from "@/lib/waia-core/payments/payment-events.types";
import type { PaymentProjectionView } from "@/lib/waia-core/payments/payment-projection.types";
import { verifyPaymentEventChain } from "@/lib/waia-core/payments/serialize-payment-events";

export function foldPaymentEventsToProjection(
  events: PaymentEventRecordView[],
): PaymentProjectionView | null {
  if (events.length === 0) {
    return null;
  }

  verifyPaymentEventChain(events);

  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const genesis = ordered[0]!;
  const head = ordered[ordered.length - 1]!;
  const confirmed = ordered.find((event) => event.eventType === "CONFIRMED");
  const settlement = confirmed?.settlement ?? null;

  return {
    paymentId: genesis.paymentId,
    organizationId: genesis.organizationId,
    status: eventTypeToStatus(head.eventType),
    direction: head.direction,
    subjectModule: head.subjectModule,
    subjectInvoiceId: head.subjectInvoiceId,
    settlementAmount: settlement?.settlementAmount ?? null,
    settlementAsset: settlement?.settlementAsset ?? null,
    settlementNetwork: settlement?.settlementNetwork ?? null,
    settlementTxHash: settlement?.settlementTxHash ?? null,
    transferIndex: settlement?.transferIndex ?? null,
    valuedAmountUsd: settlement?.valuedAmountUsd ?? null,
    valuationSource: settlement?.valuationSource ?? null,
    lastEventSeq: head.seq,
    lastEventDigest: head.recordContentDigest,
    createdAt: genesis.createdAt,
    updatedAt: head.createdAt,
  };
}
