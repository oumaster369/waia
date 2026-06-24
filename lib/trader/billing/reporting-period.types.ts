export const REPORTING_PERIOD_SCHEMA_VERSION = "waia.trader.reporting-period.v1" as const;

export type ReportingPeriodSchemaVersion = typeof REPORTING_PERIOD_SCHEMA_VERSION;

export const reportingPeriodStatuses = ["OPEN", "CLOSED"] as const;

export type ReportingPeriodStatus = (typeof reportingPeriodStatuses)[number];

/** Immutable valued-input payload digested for tamper detection (AT-E11 S1). */
export type ReportingPeriodRecordPayload = {
  schemaVersion: ReportingPeriodSchemaVersion;
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
  status: ReportingPeriodStatus;
  recordContentDigest: string;
};

export type ReportingPeriodRecordView = ReportingPeriodRecordPayload & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ReportingPeriodRecordDigestInput = {
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
  status: ReportingPeriodStatus;
};
