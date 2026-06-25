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
