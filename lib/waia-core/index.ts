export * from "@/lib/waia-core/types";
export * from "@/lib/waia-core/ids";
export * from "@/lib/waia-core/config";
export { ensureUserCoreSeed } from "@/lib/waia-core/provisioning";
export { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
export { backfillCoreForAllUsersSqlite } from "@/lib/waia-core/backfill/sqlite";
export { backfillCoreForAllUsersPostgres } from "@/lib/waia-core/backfill/postgres";
export {
  getProfileForUserSqlite,
  updateProfileForUserSqlite,
} from "@/lib/waia-core/profiles/sqlite";
export {
  getProfileForUserPostgres,
  updateProfileForUserPostgres,
} from "@/lib/waia-core/profiles/postgres";
export {
  resolvePermissionSqlite,
  resolvePermissionPostgres,
  hasActiveModuleSubscriptionSqlite,
  hasActiveModuleSubscriptionPostgres,
} from "@/lib/waia-core/permissions/resolve";
export {
  checkEntitlementSqlite,
  checkEntitlementPostgres,
} from "@/lib/waia-core/entitlements/resolve";
export {
  hasModuleEntitlementSqlite,
  hasModuleEntitlementPostgres,
} from "@/lib/waia-core/entitlements/authoritative";
export type { ModuleEntitlementQuery } from "@/lib/waia-core/entitlements/authoritative";
export { writeAuditLogSqlite, writeAuditLogPostgres } from "@/lib/waia-core/audit/write";
export {
  listAuditLogsForAdminSqlite,
  listAuditLogsForAdminPostgres,
} from "@/lib/waia-core/audit/read";
export {
  requireOrgContext,
  orgScopedWhere,
  assertOrgMembershipSqlite,
  assertOrgMembershipPostgres,
  OrgScopeError,
} from "@/lib/waia-core/scope/org-context";
