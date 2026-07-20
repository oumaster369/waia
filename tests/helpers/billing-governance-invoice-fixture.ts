import type { getDb } from "@/db/client";
import { traderInvoices } from "@/db/schema";
import { buildInvoiceRecordPayloadFromSources } from "@/lib/trader/billing/serialize-invoice";
import type { FeeComputationArtifact } from "@/lib/trader/billing/fee-computation.types";
import type { ReportingPeriodRecordView } from "@/lib/trader/billing/reporting-period.types";
import { invoicePayloadToInsertValues } from "@/lib/trader/billing/invoice-row-mapper";

export function buildIssuedInvoicePayload(
  organizationId: string,
  exchangeAccountId: string,
  issuedAt: Date,
  overrides: {
    periodId?: string;
    performanceFee?: string;
    previousHighWaterMark?: string;
    proposedNewHighWaterMark?: string;
    issuedBy?: string;
  } = {},
) {
  const periodId = overrides.periodId ?? `period-${crypto.randomUUID().slice(0, 8)}`;
  const artifact: FeeComputationArtifact = {
    periodId,
    organizationId,
    exchangeAccountId,
    periodRealizedStrategyProfit: "500.00",
    cumulativeRealizedStrategyProfit: "500.00",
    previousHighWaterMark: overrides.previousHighWaterMark ?? "10000.00",
    newProfitAboveHwm: "500.00",
    feeRate: "0.30",
    performanceFee: overrides.performanceFee ?? "150.000000",
    proposedNewHighWaterMark: overrides.proposedNewHighWaterMark ?? "10500.00",
    billable: true,
    unrealizedPnl: "0",
    realizedFillFinality: true,
    computedAt: issuedAt,
  };
  const period: ReportingPeriodRecordView = {
    id: periodId,
    organizationId,
    exchangeAccountId,
    periodStart: new Date("2026-06-01T00:00:00.000Z"),
    periodEnd: new Date("2026-06-28T23:59:59.000Z"),
    startingEquity: "10000.00",
    endingEquity: "10500.00",
    openPositionsSnapshotRef: "paper-positions:governance",
    realizedPnl: "500.00",
    unrealizedPnl: "0",
    netDeposits: "0",
    netWithdrawals: "0",
    valuationSource: "paper_pnl_read_model.v1",
    startingSnapshotAt: new Date("2026-06-01T00:05:00.000Z"),
    endingSnapshotAt: new Date("2026-06-28T23:55:00.000Z"),
    status: "CLOSED",
    schemaVersion: "waia.trader.reporting-period.v1",
    recordContentDigest: "period-digest-governance",
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };

  const payload = buildInvoiceRecordPayloadFromSources(artifact, period, {
    startingEquity: period.startingEquity,
    endingEquity: period.endingEquity!,
    netDeposits: period.netDeposits,
    netWithdrawals: period.netWithdrawals,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd!,
    valuationSource: period.valuationSource,
  });

  return {
    ...payload,
    status: "ISSUED" as const,
  };
}

export function insertIssuedInvoiceWithDigest(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  exchangeAccountId: string,
  issuedAt: Date,
  overrides: {
    periodId?: string;
    performanceFee?: string;
    previousHighWaterMark?: string;
    proposedNewHighWaterMark?: string;
    issuedBy?: string;
  } = {},
): string {
  const id = crypto.randomUUID();
  const now = issuedAt;
  const issuedBy = overrides.issuedBy ?? "00000000-0000-4000-8000-00000003215";
  const payload = buildIssuedInvoicePayload(organizationId, exchangeAccountId, issuedAt, overrides);

  db.insert(traderInvoices)
    .values({
      ...invoicePayloadToInsertValues(id, organizationId, payload, now, now),
      issuanceApprovedAt: issuedAt,
      issuanceApprovedBy: issuedBy,
      coolingOffUntil: new Date(issuedAt.getTime() - 24 * 60 * 60 * 1000),
      issuedAt,
      issuedBy,
      settledAmount: "0",
      paidAt: null,
    })
    .run();

  return id;
}
