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

export {
  HWM_LEDGER_SCHEMA_VERSION,
  hwmEntryTypes,
  type HwmEntryType,
  type HwmLedgerRecordDigestInput,
  type HwmLedgerRecordPayload,
  type HwmLedgerRecordView,
  type HwmLedgerSchemaVersion,
} from "@/lib/trader/billing/hwm-ledger.types";

export {
  HwmLedgerAlreadyBootstrappedError,
  HwmLedgerDigestMismatchError,
  HwmLedgerError,
  HwmLedgerNotBootstrappedError,
  HwmLedgerRatchetNotAllowedError,
  HwmLedgerRollbackReasonRequiredError,
  HwmLedgerValidationError,
} from "@/lib/trader/billing/hwm-ledger.errors";

export {
  buildHwmLedgerRecordPayload,
  computeHwmLedgerRecordDigest,
  serializeHwmLedgerDigestInput,
  verifyHwmLedgerRecordDigest,
  type SerializedHwmLedgerDigestInput,
} from "@/lib/trader/billing/serialize-hwm-ledger";

export {
  DEFAULT_HWM_LEDGER_LIST_LIMIT,
  MAX_HWM_LEDGER_LIST_LIMIT,
  type HwmLedgerRepository,
  type InsertHwmLedgerEntryRepoInput,
  type ListHwmLedgerQuery,
} from "@/lib/trader/billing/hwm-ledger-repository.types";

export {
  createPostgresHwmLedgerRepository,
  createSqliteHwmLedgerRepository,
} from "@/lib/trader/billing/hwm-ledger-repository-adapters";

export {
  createHwmLedgerService,
  createPostgresHwmLedgerService,
  createSqliteHwmLedgerService,
  type BootstrapHwmInput,
  type HwmLedgerService,
  type HwmLedgerServiceDeps,
  type RecordHwmRatchetInput,
  type RecordHwmRollbackInput,
} from "@/lib/trader/billing/hwm-ledger-service";

export {
  MIN_FEE_THRESHOLD,
  PERFORMANCE_FEE_RATE,
  type FeeComputationArtifact,
  type FeeComputationInput,
} from "@/lib/trader/billing/fee-computation.types";

export {
  FeeComputationError,
  FeeComputationHwmNotBootstrappedError,
  FeeComputationPeriodNotClosedError,
  FeeComputationPeriodNotFoundError,
  FeeComputationPriorPeriodRealizedPnlMissingError,
  FeeComputationRealizedPnlMissingError,
  FeeComputationValidationError,
} from "@/lib/trader/billing/fee-computation.errors";

export {
  computeFeeComputation,
  foldCumulativeRealizedStrategyProfit,
  selectClosedPeriodsUpToTarget,
  sortClosedReportingPeriodsChronologically,
} from "@/lib/trader/billing/fee-computation";

export {
  createFeeComputationService,
  createPostgresFeeComputationService,
  createSqliteFeeComputationService,
  type ComputeFeeForPeriodInput,
  type FeeComputationService,
  type FeeComputationServiceDeps,
} from "@/lib/trader/billing/fee-computation-service";

export {
  INVOICE_CURRENCY,
  INVOICE_SCHEMA_VERSION,
  invoiceStatuses,
  type GenerateDraftInvoiceInput,
  type InvoiceRecordDigestInput,
  type InvoiceRecordPayload,
  type InvoiceRecordView,
  type InvoiceSchemaVersion,
  type InvoiceStatus,
} from "@/lib/trader/billing/invoice.types";

export {
  DraftInvoiceContentMismatchError,
  DraftInvoiceDigestMismatchError,
  DraftInvoiceError,
  DraftInvoiceNotBillableError,
  DraftInvoiceNotDraftError,
  DraftInvoicePeriodDisclosureMissingError,
  DraftInvoiceValidationError,
} from "@/lib/trader/billing/invoice.errors";

export {
  FEE_ARTIFACT_DIGEST_SCHEMA_VERSION,
  buildInvoiceRecordDigestInput,
  buildInvoiceRecordPayload,
  buildInvoiceRecordPayloadFromSources,
  computeFeeArtifactDigest,
  computeInvoiceRecordDigest,
  serializeFeeArtifactDigestInput,
  serializeInvoiceDigestInput,
  verifyDraftInvoiceCanonicalBinding,
  verifyInvoiceRecordDigest,
  type SerializedFeeArtifactDigestInput,
  type SerializedInvoiceDigestInput,
} from "@/lib/trader/billing/serialize-invoice";

export {
  createPostgresInvoiceRepository,
  createSqliteInvoiceRepository,
} from "@/lib/trader/billing/invoice-repository-adapters";

export type {
  InsertInvoiceRepoInput,
  InvoiceRepository,
} from "@/lib/trader/billing/invoice-repository.types";

export {
  createDraftInvoiceService,
  createPostgresDraftInvoiceService,
  createSqliteDraftInvoiceService,
  extractPeriodDisclosure,
  type DraftInvoiceService,
  type DraftInvoiceServiceDeps,
  type PeriodDisclosureSnapshot,
} from "@/lib/trader/billing/draft-invoice-service";

export {
  DEFAULT_INVOICE_APPROVAL_VALIDITY_MS,
  DEFAULT_INVOICE_ISSUANCE_COOLING_OFF_MS,
  computeApprovalExpiresAt,
  computeCoolingOffUntil,
  effectiveInvoiceApprovalValidityMs,
  effectiveInvoiceIssuanceCoolingOffMs,
} from "@/lib/trader/billing/invoice-issuance.config";

export {
  INVOICE_TRANSITIONS,
  assertAllowedInvoiceTransition,
  isTerminalInvoiceStatus,
} from "@/lib/trader/billing/invoice-lifecycle.transitions";

export {
  InvoiceIssuanceError,
  InvoiceIssuanceValidationError,
  IssuanceAlreadyIssuedError,
  IssuanceApprovalExpiredError,
  IssuanceApprovalRequiredError,
  IssuanceAttestationIncompleteError,
  IssuanceConcurrentConflictError,
  IssuanceCoolingOffNotElapsedError,
  IssuanceHwmInconsistentError,
  IssuanceInvoiceNotFoundError,
  IssuanceNotDraftError,
  IssuanceOperatorRequiredError,
} from "@/lib/trader/billing/invoice-issuance.errors";

export {
  ISSUANCE_ATTESTATION_KEYS,
  isIssuanceAttestationComplete,
  type ApproveIssuanceInput,
  type CancelPendingIssuanceInput,
  type InvoiceIssuanceService,
  type InvoiceIssuanceServiceDeps,
  type IssuanceAttestation,
  type IssueInvoiceInput,
} from "@/lib/trader/billing/invoice-issuance.types";

export type {
  ExecuteInvoiceIssuanceRepoInput,
  ExecuteInvoiceIssuanceRepoResult,
  InvoiceIssuanceRepository,
} from "@/lib/trader/billing/invoice-issuance-repository.types";

export {
  createPostgresInvoiceIssuanceRepository,
  createSqliteInvoiceIssuanceRepository,
  executeInvoiceIssuanceAtomicPostgres,
  executeInvoiceIssuanceAtomicPostgresTx,
  executeInvoiceIssuanceAtomicSqlite,
} from "@/lib/trader/billing/invoice-issuance-repository-adapters";

export {
  createInvoiceIssuanceService,
  createPostgresInvoiceIssuanceService,
  createSqliteInvoiceIssuanceService,
} from "@/lib/trader/billing/invoice-issuance-service";

export {
  createBillingGovernanceService,
  createPostgresBillingGovernanceService,
  createSqliteBillingGovernanceService,
  isInvoiceDisputable,
  isInvoiceEnforcementFrozen,
  type ApplyOverchargeCorrectionInput,
  type ApplyOverchargeCorrectionResult,
  type BillingGovernanceService,
  type OpenInvoiceDisputeInput,
  verifyInvoiceCorrectionDigest,
  verifyInvoiceDisputeEventDigest,
} from "@/lib/trader/billing/governance";

export {
  createBillingPeriodCloseOrchestrator,
  createPostgresBillingPeriodCloseOrchestrator,
  createSqliteBillingPeriodCloseOrchestrator,
  type BillingPeriodCloseOrchestrator,
  type BillingPeriodCloseOrchestratorDeps,
  type BillingPeriodCloseResult,
  type CloseAndMaterializeInput,
  type MaterializeDraftInput,
} from "@/lib/trader/billing/billing-period-close-orchestrator";
