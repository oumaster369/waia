/**
 * WAIA Core enum value sets — DB-layer source of truth (no application dependencies).
 *
 * Both `db/schema.ts` (SQLite) and `db/schema.postgres.ts` (Postgres) import these.
 * Application code re-exports the value arrays + derived TS types from `lib/waia-core/types.ts`.
 */

export const organizationKindEnum = ["personal", "business", "fund", "partner"] as const;
export const organizationMemberRoleEnum = ["owner", "member", "manager"] as const;
export const platformRoleEnum = ["user", "admin", "agent", "service"] as const;
export const waiaModuleEnum = ["twin", "trader", "3p", "marketplace"] as const;
export const subscriptionStatusEnum = ["active", "inactive"] as const;
export const auditActorTypeEnum = ["user", "admin", "agent", "service", "system"] as const;

/** WAIA Core payment event types (AT-E12 S1 / DEE-312). */
export const paymentEventTypeEnum = ["DETECTED", "CONFIRMED", "FAILED"] as const;

/** WAIA Core payment direction (AT-E12 S1 / DEE-312). */
export const paymentDirectionEnum = ["INBOUND", "OUTBOUND"] as const;

/** Soft subject discriminator for cross-module invoice references (AT-E12 S1). */
export const paymentSubjectModuleEnum = ["trader", "twin", "marketplace"] as const;

/** Terminal-negative failure reasons on FAILED events (AT-E12 S1). */
export const paymentFailureReasonEnum = ["DROPPED", "EXPIRED", "REJECTED", "ORPHANED"] as const;

/** Projected payment aggregate status (derived from events). */
export const paymentStatusEnum = ["DETECTED", "CONFIRMED", "FAILED"] as const;

/** Payment wallet role in the control domain (AT-E12 S2 / DEE-315). */
export const paymentWalletKindEnum = ["DEPOSIT", "DISBURSEMENT", "RESERVE"] as const;

/** Custody posture metadata for payment wallets (AT-E12 S2 / DEE-315). */
export const paymentWalletCustodyModelEnum = ["PLATFORM", "ORGANIZATION", "CUSTODIAL"] as const;

/** Append-only address lifecycle event types (AT-E12 S2 / DEE-315). */
export const paymentAddressEventTypeEnum = [
  "GENERATED",
  "RESERVED",
  "RELEASED",
  "ASSIGNED",
  "ACTIVATED",
  "ROTATED",
  "RETIRED",
  "ARCHIVED",
  "RECOVERED",
] as const;

/** Projected payment address status (derived from address events; AT-E12 S2 / DEE-315). */
export const paymentAddressStatusEnum = [
  "GENERATED",
  "RESERVED",
  "RELEASED",
  "ASSIGNED",
  "ACTIVATED",
  "ROTATED",
  "RETIRED",
  "ARCHIVED",
  "RECOVERED",
] as const;

/** AI-TRADER invoice lifecycle (AT-E11 / AT-E12 S3-B). */
export const invoiceStatusEnum = ["DRAFT", "ISSUED", "PAID"] as const;

/** AI-TRADER invoice dispute projection status (AT-E11 / DEE-215). */
export const invoiceDisputeStatusEnum = ["OPEN", "RESOLVED_UPHELD", "RESOLVED_CORRECTED"] as const;

/** AI-TRADER append-only invoice dispute event types (AT-E11 / DEE-215). */
export const invoiceDisputeEventTypeEnum = [
  "OPENED",
  "RESOLVED_UPHELD",
  "RESOLVED_CORRECTED",
] as const;

/** AI-TRADER append-only invoice correction kinds (AT-E11 / DEE-215). */
export const invoiceCorrectionTypeEnum = ["CREDIT", "REFUND"] as const;

/** AI-TRADER exchange account status (AT-E12 S3-B minimal FSM). */
export const accountStatusEnum = ["ACTIVE", "SUSPENDED"] as const;

/** AI-TRADER account status event types (AT-E12 S3-B). */
export const accountStatusEventTypeEnum = ["SUSPENDED", "REACTIVATED"] as const;

/** AI-TRADER settlement outcome (AT-E12 S3-B). */
export const settlementOutcomeEnum = ["APPLIED", "EXCEPTION"] as const;

/** AI-TRADER settlement reconciliation case status (AT-E12 S3-C-A). */
export const settlementReconciliationCaseStatusEnum = [
  "OPEN",
  "ASSIGNED",
  "UNDER_REVIEW",
  "DECISION_PENDING",
  "RESOLVED",
  "CANCELLED",
  "ESCALATED",
] as const;

/** AI-TRADER settlement application source (AT-E12 S3-C-A). */
export const settlementApplicationSourceEnum = ["AUTO", "MANUAL"] as const;

/**
 * AI-TRADER settlement reconciliation terminal resolution types (AT-E12 S3-C-B).
 * Escalation is a holding state action, not a resolution type.
 */
export const settlementReconciliationResolutionTypeEnum = [
  "MANUAL_APPLY",
  "WAIVE",
  "CLOSE_NO_ACTION",
  "CLOSE_DUPLICATE",
] as const;

/**
 * CANCELLED in settlementReconciliationCaseStatusEnum is reserved-forbidden:
 * the S3-C-B FSM never produces it (single terminal = RESOLVED).
 */
