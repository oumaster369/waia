import { assertAdminPermission } from "@/lib/trader/admin-route-shared";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { OrgScopeError, type OrgContext } from "@/lib/waia-core/scope/org-context";

/** Explicit capability check for admin adapters; ordinary services require membership. */
export function createAdminServiceOrgAccess(runtime: WaiaRuntimeDb, permission: string) {
  return async (context: OrgContext & { userId: string }): Promise<void> => {
    const result = await assertAdminPermission(runtime, context.userId, context.organizationId, permission);
    if (!result.allowed) throw new OrgScopeError("ORG_ADMIN_PERMISSION_REQUIRED");
  };
}
