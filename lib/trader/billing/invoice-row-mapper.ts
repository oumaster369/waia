import type { InvoiceRecordPayload, InvoiceRecordView } from "@/lib/trader/billing/invoice.types";
import { verifyInvoiceRecordDigest } from "@/lib/trader/billing/serialize-invoice";

type InvoiceRow = {
  id: string;
  organizationId: string;
  exchangeAccountId: string;
  reportingPeriodId: string;
  feeArtifactDigest: string;
  status: InvoiceRecordPayload["status"];
  currency: string;
  periodRealizedStrategyProfit: string;
  cumulativeRealizedStrategyProfit: string;
  previousHighWaterMark: string;
  newProfitAboveHwm: string;
  feeRate: string;
  performanceFee: string;
  proposedNewHighWaterMark: string;
  billable: boolean;
  unrealizedPnl: string | null;
  realizedFillFinality: boolean;
  startingEquity: string;
  endingEquity: string;
  netDeposits: string;
  netWithdrawals: string;
  periodStart: Date;
  periodEnd: Date;
  valuationSource: string;
  feeComputedAt: Date;
  schemaVersion: string;
  recordContentDigest: string;
  issuanceApprovedAt: Date | null;
  issuanceApprovedBy: string | null;
  coolingOffUntil: Date | null;
  issuedAt: Date | null;
  issuedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function mapInvoiceRow(row: InvoiceRow): InvoiceRecordView {
  const view: InvoiceRecordView = {
    id: row.id,
    organizationId: row.organizationId,
    exchangeAccountId: row.exchangeAccountId,
    reportingPeriodId: row.reportingPeriodId,
    feeArtifactDigest: row.feeArtifactDigest,
    status: row.status,
    currency: row.currency as InvoiceRecordPayload["currency"],
    periodRealizedStrategyProfit: row.periodRealizedStrategyProfit,
    cumulativeRealizedStrategyProfit: row.cumulativeRealizedStrategyProfit,
    previousHighWaterMark: row.previousHighWaterMark,
    newProfitAboveHwm: row.newProfitAboveHwm,
    feeRate: row.feeRate,
    performanceFee: row.performanceFee,
    proposedNewHighWaterMark: row.proposedNewHighWaterMark,
    billable: row.billable,
    unrealizedPnl: row.unrealizedPnl,
    realizedFillFinality: row.realizedFillFinality,
    startingEquity: row.startingEquity,
    endingEquity: row.endingEquity,
    netDeposits: row.netDeposits,
    netWithdrawals: row.netWithdrawals,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    valuationSource: row.valuationSource,
    feeComputedAt: row.feeComputedAt,
    schemaVersion: row.schemaVersion as InvoiceRecordPayload["schemaVersion"],
    recordContentDigest: row.recordContentDigest,
    issuanceApprovedAt: row.issuanceApprovedAt,
    issuanceApprovedBy: row.issuanceApprovedBy,
    coolingOffUntil: row.coolingOffUntil,
    issuedAt: row.issuedAt,
    issuedBy: row.issuedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  verifyInvoiceRecordDigest(view);
  return view;
}

export function invoicePayloadToInsertValues(
  id: string,
  organizationId: string,
  payload: InvoiceRecordPayload,
  createdAt: Date,
  updatedAt: Date,
) {
  return {
    id,
    organizationId,
    exchangeAccountId: payload.exchangeAccountId,
    reportingPeriodId: payload.reportingPeriodId,
    feeArtifactDigest: payload.feeArtifactDigest,
    status: payload.status,
    currency: payload.currency,
    periodRealizedStrategyProfit: payload.periodRealizedStrategyProfit,
    cumulativeRealizedStrategyProfit: payload.cumulativeRealizedStrategyProfit,
    previousHighWaterMark: payload.previousHighWaterMark,
    newProfitAboveHwm: payload.newProfitAboveHwm,
    feeRate: payload.feeRate,
    performanceFee: payload.performanceFee,
    proposedNewHighWaterMark: payload.proposedNewHighWaterMark,
    billable: payload.billable,
    unrealizedPnl: payload.unrealizedPnl,
    realizedFillFinality: payload.realizedFillFinality,
    startingEquity: payload.startingEquity,
    endingEquity: payload.endingEquity,
    netDeposits: payload.netDeposits,
    netWithdrawals: payload.netWithdrawals,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    valuationSource: payload.valuationSource,
    feeComputedAt: payload.feeComputedAt,
    schemaVersion: payload.schemaVersion,
    recordContentDigest: payload.recordContentDigest,
    issuanceApprovedAt: null,
    issuanceApprovedBy: null,
    coolingOffUntil: null,
    issuedAt: null,
    issuedBy: null,
    createdAt,
    updatedAt,
  };
}
