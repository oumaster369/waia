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
