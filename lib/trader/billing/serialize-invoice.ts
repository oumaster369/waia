import { createHash } from "node:crypto";

import { DraftInvoiceDigestMismatchError } from "@/lib/trader/billing/invoice.errors";
import {
  INVOICE_CURRENCY,
  INVOICE_SCHEMA_VERSION,
  type InvoiceRecordDigestInput,
  type InvoiceRecordPayload,
} from "@/lib/trader/billing/invoice.types";
import type { FeeComputationArtifact } from "@/lib/trader/billing/fee-computation.types";
import type { ReportingPeriodRecordView } from "@/lib/trader/billing/reporting-period.types";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

export const FEE_ARTIFACT_DIGEST_SCHEMA_VERSION = "waia.trader.fee-artifact.v1" as const;

export type SerializedFeeArtifactDigestInput = {
  schemaVersion: typeof FEE_ARTIFACT_DIGEST_SCHEMA_VERSION;
  periodId: string;
  organizationId: string;
  exchangeAccountId: string;
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
  computedAt: string;
};

export type SerializedInvoiceDigestInput = {
  schemaVersion: typeof INVOICE_SCHEMA_VERSION;
  organizationId: string;
  exchangeAccountId: string;
  reportingPeriodId: string;
  feeArtifactDigest: string;
  status: InvoiceRecordDigestInput["status"];
  currency: typeof INVOICE_CURRENCY;
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
  periodStart: string;
  periodEnd: string;
  valuationSource: string;
  feeComputedAt: string;
};

function toIsoTimestamp(value: Date): string {
  return value.toISOString();
}

export function serializeFeeArtifactDigestInput(
  artifact: FeeComputationArtifact,
): SerializedFeeArtifactDigestInput {
  return {
    schemaVersion: FEE_ARTIFACT_DIGEST_SCHEMA_VERSION,
    periodId: artifact.periodId,
    organizationId: artifact.organizationId,
    exchangeAccountId: artifact.exchangeAccountId,
    periodRealizedStrategyProfit: artifact.periodRealizedStrategyProfit,
    cumulativeRealizedStrategyProfit: artifact.cumulativeRealizedStrategyProfit,
    previousHighWaterMark: artifact.previousHighWaterMark,
    newProfitAboveHwm: artifact.newProfitAboveHwm,
    feeRate: artifact.feeRate,
    performanceFee: artifact.performanceFee,
    proposedNewHighWaterMark: artifact.proposedNewHighWaterMark,
    billable: artifact.billable,
    unrealizedPnl: artifact.unrealizedPnl,
    realizedFillFinality: artifact.realizedFillFinality,
    computedAt: toIsoTimestamp(artifact.computedAt),
  };
}

export function computeFeeArtifactDigest(artifact: FeeComputationArtifact): string {
  const canonical = serializeFeeArtifactDigestInput(artifact);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function serializeInvoiceDigestInput(
  input: InvoiceRecordDigestInput,
): SerializedInvoiceDigestInput {
  return {
    schemaVersion: INVOICE_SCHEMA_VERSION,
    organizationId: input.organizationId,
    exchangeAccountId: input.exchangeAccountId,
    reportingPeriodId: input.reportingPeriodId,
    feeArtifactDigest: input.feeArtifactDigest,
    status: input.status,
    currency: input.currency,
    periodRealizedStrategyProfit: input.periodRealizedStrategyProfit,
    cumulativeRealizedStrategyProfit: input.cumulativeRealizedStrategyProfit,
    previousHighWaterMark: input.previousHighWaterMark,
    newProfitAboveHwm: input.newProfitAboveHwm,
    feeRate: input.feeRate,
    performanceFee: input.performanceFee,
    proposedNewHighWaterMark: input.proposedNewHighWaterMark,
    billable: input.billable,
    unrealizedPnl: input.unrealizedPnl,
    realizedFillFinality: input.realizedFillFinality,
    startingEquity: input.startingEquity,
    endingEquity: input.endingEquity,
    netDeposits: input.netDeposits,
    netWithdrawals: input.netWithdrawals,
    periodStart: toIsoTimestamp(input.periodStart),
    periodEnd: toIsoTimestamp(input.periodEnd),
    valuationSource: input.valuationSource,
    feeComputedAt: toIsoTimestamp(input.feeComputedAt),
  };
}

export function computeInvoiceRecordDigest(input: InvoiceRecordDigestInput): string {
  const canonical = serializeInvoiceDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildInvoiceRecordDigestInput(
  artifact: FeeComputationArtifact,
  period: ReportingPeriodRecordView,
  feeArtifactDigest: string,
  disclosure: {
    startingEquity: string;
    endingEquity: string;
    netDeposits: string;
    netWithdrawals: string;
    periodStart: Date;
    periodEnd: Date;
    valuationSource: string;
  },
): InvoiceRecordDigestInput {
  return {
    organizationId: artifact.organizationId,
    exchangeAccountId: artifact.exchangeAccountId,
    reportingPeriodId: artifact.periodId,
    feeArtifactDigest,
    status: "DRAFT",
    currency: INVOICE_CURRENCY,
    periodRealizedStrategyProfit: artifact.periodRealizedStrategyProfit,
    cumulativeRealizedStrategyProfit: artifact.cumulativeRealizedStrategyProfit,
    previousHighWaterMark: artifact.previousHighWaterMark,
    newProfitAboveHwm: artifact.newProfitAboveHwm,
    feeRate: artifact.feeRate,
    performanceFee: artifact.performanceFee,
    proposedNewHighWaterMark: artifact.proposedNewHighWaterMark,
    billable: artifact.billable,
    unrealizedPnl: artifact.unrealizedPnl,
    realizedFillFinality: artifact.realizedFillFinality,
    startingEquity: disclosure.startingEquity,
    endingEquity: disclosure.endingEquity,
    netDeposits: disclosure.netDeposits,
    netWithdrawals: disclosure.netWithdrawals,
    periodStart: disclosure.periodStart,
    periodEnd: disclosure.periodEnd,
    valuationSource: disclosure.valuationSource,
    feeComputedAt: artifact.computedAt,
  };
}

export function buildInvoiceRecordPayload(input: InvoiceRecordDigestInput): InvoiceRecordPayload {
  const recordContentDigest = computeInvoiceRecordDigest(input);
  return {
    ...input,
    schemaVersion: INVOICE_SCHEMA_VERSION,
    recordContentDigest,
  };
}

export function buildInvoiceRecordPayloadFromSources(
  artifact: FeeComputationArtifact,
  period: ReportingPeriodRecordView,
  disclosure: {
    startingEquity: string;
    endingEquity: string;
    netDeposits: string;
    netWithdrawals: string;
    periodStart: Date;
    periodEnd: Date;
    valuationSource: string;
  },
): InvoiceRecordPayload {
  const feeArtifactDigest = computeFeeArtifactDigest(artifact);
  const digestInput = buildInvoiceRecordDigestInput(
    artifact,
    period,
    feeArtifactDigest,
    disclosure,
  );
  return buildInvoiceRecordPayload(digestInput);
}

export function verifyInvoiceRecordDigest(payload: InvoiceRecordPayload): void {
  const {
    recordContentDigest,
    schemaVersion: _schemaVersion,
    status: _status,
    ...digestInput
  } = payload;
  const expected = computeInvoiceRecordDigest({ ...digestInput, status: "DRAFT" });
  if (expected !== recordContentDigest) {
    throw new DraftInvoiceDigestMismatchError();
  }
}

/** Recompute digests from canonical sources — supports future DRAFT → ISSUED fail-closed verification. */
export function verifyDraftInvoiceCanonicalBinding(
  invoice: InvoiceRecordPayload,
  artifact: FeeComputationArtifact,
  period: ReportingPeriodRecordView,
  disclosure: {
    startingEquity: string;
    endingEquity: string;
    netDeposits: string;
    netWithdrawals: string;
    periodStart: Date;
    periodEnd: Date;
    valuationSource: string;
  },
): void {
  const feeArtifactDigest = computeFeeArtifactDigest(artifact);
  if (feeArtifactDigest !== invoice.feeArtifactDigest) {
    throw new DraftInvoiceDigestMismatchError("FEE_ARTIFACT_DIGEST_MISMATCH");
  }

  const expectedPayload = buildInvoiceRecordPayloadFromSources(artifact, period, disclosure);
  if (expectedPayload.recordContentDigest !== invoice.recordContentDigest) {
    throw new DraftInvoiceDigestMismatchError("INVOICE_RECORD_CONTENT_DIGEST_MISMATCH");
  }
}
