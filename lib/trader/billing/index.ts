export {
  REPORTING_PERIOD_SCHEMA_VERSION,
  reportingPeriodStatuses,
  type ReportingPeriodRecordDigestInput,
  type ReportingPeriodRecordPayload,
  type ReportingPeriodRecordView,
  type ReportingPeriodSchemaVersion,
  type ReportingPeriodStatus,
} from "@/lib/trader/billing/reporting-period.types";

export {
  ReportingPeriodAlreadyOpenError,
  ReportingPeriodDigestMismatchError,
  ReportingPeriodError,
  ReportingPeriodInvalidTransitionError,
  ReportingPeriodNotOpenError,
  ReportingPeriodValidationError,
} from "@/lib/trader/billing/reporting-period.errors";

export {
  buildReportingPeriodRecordPayload,
  computeReportingPeriodRecordDigest,
  serializeReportingPeriodDigestInput,
  verifyReportingPeriodRecordDigest,
  type SerializedReportingPeriodDigestInput,
} from "@/lib/trader/billing/serialize-reporting-period";

export {
  REPORTING_PERIOD_TRANSITIONS,
  assertAllowedReportingPeriodTransition,
  isTerminalReportingPeriodStatus,
} from "@/lib/trader/billing/reporting-period-lifecycle.transitions";

export {
  DEFAULT_REPORTING_PERIODS_LIST_LIMIT,
  MAX_REPORTING_PERIODS_LIST_LIMIT,
  type CloseReportingPeriodInput,
  type CloseReportingPeriodRepoInput,
  type InsertOpenReportingPeriodRepoInput,
  type ListReportingPeriodsQuery,
  type OpenReportingPeriodInput,
  type ReportingPeriodRepository,
} from "@/lib/trader/billing/reporting-period-repository.types";

export {
  createPostgresReportingPeriodRepository,
  createSqliteReportingPeriodRepository,
} from "@/lib/trader/billing/repository-adapters";

export {
  createPostgresReportingPeriodLifecycleService,
  createReportingPeriodLifecycleService,
  createSqliteReportingPeriodLifecycleService,
  type ReportingPeriodLifecycleService,
  type ReportingPeriodLifecycleServiceDeps,
} from "@/lib/trader/billing/reporting-period-lifecycle-service";
