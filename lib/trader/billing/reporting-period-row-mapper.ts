import type {
  ReportingPeriodRecordPayload,
  ReportingPeriodRecordView,
} from "@/lib/trader/billing/reporting-period.types";
import { verifyReportingPeriodRecordDigest } from "@/lib/trader/billing/serialize-reporting-period";

type SqliteReportingPeriodRow = {
  id: string;
  organizationId: string;
  exchangeAccountId: string;
  periodStart: Date;
  periodEnd: Date | null;
  startingEquity: string;
  endingEquity: string | null;
  openPositionsSnapshotRef: string;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  netDeposits: string;
  netWithdrawals: string;
  valuationSource: string;
  startingSnapshotAt: Date;
  endingSnapshotAt: Date | null;
  schemaVersion: string;
  status: ReportingPeriodRecordPayload["status"];
  recordContentDigest: string;
  createdAt: Date;
  updatedAt: Date;
};

export function mapReportingPeriodRow(row: SqliteReportingPeriodRow): ReportingPeriodRecordView {
  const view: ReportingPeriodRecordView = {
    id: row.id,
    organizationId: row.organizationId,
    exchangeAccountId: row.exchangeAccountId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    startingEquity: row.startingEquity,
    endingEquity: row.endingEquity,
    openPositionsSnapshotRef: row.openPositionsSnapshotRef,
    realizedPnl: row.realizedPnl,
    unrealizedPnl: row.unrealizedPnl,
    netDeposits: row.netDeposits,
    netWithdrawals: row.netWithdrawals,
    valuationSource: row.valuationSource,
    startingSnapshotAt: row.startingSnapshotAt,
    endingSnapshotAt: row.endingSnapshotAt,
    schemaVersion: row.schemaVersion as ReportingPeriodRecordPayload["schemaVersion"],
    status: row.status,
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  verifyReportingPeriodRecordDigest(view);
  return view;
}

export function reportingPeriodPayloadToInsertValues(
  id: string,
  organizationId: string,
  payload: ReportingPeriodRecordPayload,
  createdAt: Date,
  updatedAt: Date,
) {
  return {
    id,
    organizationId,
    exchangeAccountId: payload.exchangeAccountId,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    startingEquity: payload.startingEquity,
    endingEquity: payload.endingEquity,
    openPositionsSnapshotRef: payload.openPositionsSnapshotRef,
    realizedPnl: payload.realizedPnl,
    unrealizedPnl: payload.unrealizedPnl,
    netDeposits: payload.netDeposits,
    netWithdrawals: payload.netWithdrawals,
    valuationSource: payload.valuationSource,
    startingSnapshotAt: payload.startingSnapshotAt,
    endingSnapshotAt: payload.endingSnapshotAt,
    schemaVersion: payload.schemaVersion,
    status: payload.status,
    recordContentDigest: payload.recordContentDigest,
    createdAt,
    updatedAt,
  };
}

export function reportingPeriodPayloadToUpdateValues(
  payload: ReportingPeriodRecordPayload,
  updatedAt: Date,
) {
  return {
    periodEnd: payload.periodEnd,
    endingEquity: payload.endingEquity,
    openPositionsSnapshotRef: payload.openPositionsSnapshotRef,
    realizedPnl: payload.realizedPnl,
    unrealizedPnl: payload.unrealizedPnl,
    netDeposits: payload.netDeposits,
    netWithdrawals: payload.netWithdrawals,
    valuationSource: payload.valuationSource,
    endingSnapshotAt: payload.endingSnapshotAt,
    status: payload.status,
    recordContentDigest: payload.recordContentDigest,
    updatedAt,
  };
}
