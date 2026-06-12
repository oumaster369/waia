import "server-only";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import {
  hasModuleEntitlementPostgres,
  hasModuleEntitlementSqlite,
} from "@/lib/waia-core/entitlements/authoritative";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

const TRADER_ENTITLEMENT_KEY = "trader";

/**
 * Authoritative trader-module access check for route gates.
 * Uses the personal organization and reads the entitlement row directly (not shadow-mode checkEntitlement).
 */
export async function hasTraderAccessForUser(userId: string): Promise<boolean> {
  const organizationId = personalOrganizationIdFromUserId(userId);
  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind === "sqlite") {
      return hasModuleEntitlementSqlite(runtime.db, {
        organizationId,
        entitlementKey: TRADER_ENTITLEMENT_KEY,
      });
    }
    return hasModuleEntitlementPostgres(runtime.db, {
      organizationId,
      entitlementKey: TRADER_ENTITLEMENT_KEY,
    });
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}
