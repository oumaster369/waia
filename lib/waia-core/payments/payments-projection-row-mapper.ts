import type { PaymentProjectionView } from "@/lib/waia-core/payments/payment-projection.types";

type PaymentProjectionRow = {
  paymentId: string;
  organizationId: string;
  status: PaymentProjectionView["status"];
  direction: PaymentProjectionView["direction"];
  subjectModule: PaymentProjectionView["subjectModule"];
  subjectInvoiceId: string | null;
  settlementAmount: string | null;
  settlementAsset: string | null;
  settlementNetwork: string | null;
  settlementTxHash: string | null;
  transferIndex: number | null;
  valuedAmountUsd: string | null;
  valuationSource: string | null;
  lastEventSeq: number;
  lastEventDigest: string;
  createdAt: Date;
  updatedAt: Date;
};

export function mapPaymentProjectionRow(row: PaymentProjectionRow): PaymentProjectionView {
  return {
    paymentId: row.paymentId,
    organizationId: row.organizationId,
    status: row.status,
    direction: row.direction,
    subjectModule: row.subjectModule,
    subjectInvoiceId: row.subjectInvoiceId,
    settlementAmount: row.settlementAmount,
    settlementAsset: row.settlementAsset,
    settlementNetwork: row.settlementNetwork,
    settlementTxHash: row.settlementTxHash,
    transferIndex: row.transferIndex,
    valuedAmountUsd: row.valuedAmountUsd,
    valuationSource: row.valuationSource,
    lastEventSeq: row.lastEventSeq,
    lastEventDigest: row.lastEventDigest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function paymentProjectionToUpsertValues(
  projection: PaymentProjectionView,
  updatedAt: Date,
) {
  return {
    paymentId: projection.paymentId,
    organizationId: projection.organizationId,
    status: projection.status,
    direction: projection.direction,
    subjectModule: projection.subjectModule,
    subjectInvoiceId: projection.subjectInvoiceId,
    settlementAmount: projection.settlementAmount,
    settlementAsset: projection.settlementAsset,
    settlementNetwork: projection.settlementNetwork,
    settlementTxHash: projection.settlementTxHash,
    transferIndex: projection.transferIndex,
    valuedAmountUsd: projection.valuedAmountUsd,
    valuationSource: projection.valuationSource,
    lastEventSeq: projection.lastEventSeq,
    lastEventDigest: projection.lastEventDigest,
    createdAt: projection.createdAt,
    updatedAt,
  };
}
