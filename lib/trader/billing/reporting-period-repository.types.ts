import type {
  ReportingPeriodRecordPayload,
  ReportingPeriodRecordView,
} from "@/lib/trader/billing/reporting-period.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type OpenReportingPeriodInput = {
  exchangeAccountId: string;
  periodStart: Date;
  startingEquity: string;
  openPositionsSnapshotRef: string;
  valuationSource: string;
  startingSnapshotAt: Date;
};

export type CloseReportingPeriodInput = {
  exchangeAccountId: string;
  periodEnd: Date;
  endingEquity: string;
  endingSnapshotAt: Date;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  netDeposits?: string;
  netWithdrawals?: string;
};

export type InsertOpenReportingPeriodRepoInput = {
  payload: ReportingPeriodRecordPayload;
};

export type CloseReportingPeriodRepoInput = {
  id: string;
  payload: ReportingPeriodRecordPayload;
};

export type ListReportingPeriodsQuery = {
  exchangeAccountId?: string;
  limit?: number;
};

export const DEFAULT_REPORTING_PERIODS_LIST_LIMIT = 50;
export const MAX_REPORTING_PERIODS_LIST_LIMIT = 200;

export type ReportingPeriodRepository = {
  insertOpenPeriod(
    context: OrgContext,
    input: InsertOpenReportingPeriodRepoInput,
  ): ReportingPeriodRecordView | Promise<ReportingPeriodRecordView>;

  findOpenPeriod(
    context: OrgContext,
    exchangeAccountId: string,
  ): ReportingPeriodRecordView | null | Promise<ReportingPeriodRecordView | null>;

  getById(
    context: OrgContext,
    id: string,
  ): ReportingPeriodRecordView | null | Promise<ReportingPeriodRecordView | null>;

  closePeriod(
    context: OrgContext,
    input: CloseReportingPeriodRepoInput,
  ): ReportingPeriodRecordView | Promise<ReportingPeriodRecordView>;

  listClosedPeriods(
    context: OrgContext,
    query?: ListReportingPeriodsQuery,
  ): ReportingPeriodRecordView[] | Promise<ReportingPeriodRecordView[]>;
};
