export {
  INVOICE_CORRECTION_SCHEMA_VERSION,
  INVOICE_DISPUTE_EVENT_SCHEMA_VERSION,
  invoiceCorrectionTypes,
  invoiceDisputeEventTypes,
  invoiceDisputeStatuses,
  type InvoiceCorrectionRecordPayload,
  type InvoiceCorrectionRecordView,
  type InvoiceCorrectionType,
  type InvoiceDisputeEventRecordPayload,
  type InvoiceDisputeEventRecordView,
  type InvoiceDisputeEventType,
  type InvoiceDisputeProjectionView,
  type InvoiceDisputeStatus,
} from "@/lib/trader/billing/governance/billing-governance.types";

export {
  BillingGovernanceError,
  IllegalInvoiceDisputeTransitionError,
  InvoiceCorrectionDigestMismatchError,
  InvoiceCorrectionReasonRequiredError,
  InvoiceDisputeAlreadyOpenError,
  InvoiceDisputeEventDigestMismatchError,
  InvoiceDisputeInvalidInvoiceStatusError,
  InvoiceDisputeInvoiceNotFoundError,
  InvoiceDisputeNotFoundError,
  InvoiceDisputeNotOpenError,
  InvoiceDisputeOpenRequiredForCorrectionError,
} from "@/lib/trader/billing/governance/billing-governance.errors";

export {
  assertDisputeTransitionAllowed,
  isInvoiceDisputable,
  isInvoiceEnforcementFrozen,
  resolveDisputeStatusAfterEvent,
} from "@/lib/trader/billing/governance/billing-governance.transitions";

export {
  buildInvoiceCorrectionPayload,
  computeInvoiceCorrectionDigest,
  verifyInvoiceCorrectionDigest,
} from "@/lib/trader/billing/governance/serialize-invoice-correction";

export {
  buildInvoiceDisputeEventPayload,
  computeInvoiceDisputeEventDigest,
  verifyInvoiceDisputeEventDigest,
} from "@/lib/trader/billing/governance/serialize-invoice-dispute-event";

export {
  createBillingGovernanceService,
  createPostgresBillingGovernanceService,
  createSqliteBillingGovernanceService,
  type ApplyOverchargeCorrectionInput,
  type ApplyOverchargeCorrectionResult,
  type BillingGovernanceService,
  type BillingGovernanceServiceDeps,
  type OpenInvoiceDisputeInput,
  type ResolveInvoiceDisputeUpheldInput,
} from "@/lib/trader/billing/governance/billing-governance-service";

export { createPostgresInvoiceDisputeRepository } from "@/lib/trader/billing/governance/dispute-repository-postgres";
export { createSqliteInvoiceDisputeRepository } from "@/lib/trader/billing/governance/dispute-repository-sqlite";
export { createPostgresInvoiceCorrectionRepository } from "@/lib/trader/billing/governance/correction-repository-postgres";
export { createSqliteInvoiceCorrectionRepository } from "@/lib/trader/billing/governance/correction-repository-sqlite";
