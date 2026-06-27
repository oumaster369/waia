import "server-only";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import {
  hasModuleEntitlementPostgres,
  hasModuleEntitlementSqlite,
} from "@/lib/waia-core/entitlements/authoritative";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureTraderOrgProfilePostgres } from "@/lib/trader/provisioning/postgres";
import { ensureTraderOrgProfileSqlite } from "@/lib/trader/provisioning/sqlite";

const TRADER_ENTITLEMENT_KEY = "trader";

/**
 * Ensures entitled organizations have a `trader_org_profiles` anchor at runtime.
 * Idempotent; writes audit on first create. Returns false when entitlement absent.
 */
export async function ensureTraderRuntimeForUser(userId: string): Promise<boolean> {
  const organizationId = personalOrganizationIdFromUserId(userId);
  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind === "sqlite") {
      const entitled = hasModuleEntitlementSqlite(runtime.db, {
        organizationId,
        entitlementKey: TRADER_ENTITLEMENT_KEY,
      });
      if (!entitled) {
        return false;
      }
      ensureTraderOrgProfileSqlite(runtime.db, {
        organizationId,
        actorType: "system",
        actorId: userId,
      });
      return true;
    }

    const entitled = await hasModuleEntitlementPostgres(runtime.db, {
      organizationId,
      entitlementKey: TRADER_ENTITLEMENT_KEY,
    });
    if (!entitled) {
      return false;
    }
    await ensureTraderOrgProfilePostgres(runtime.db, {
      organizationId,
      actorType: "system",
      actorId: userId,
    });
    return true;
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}
