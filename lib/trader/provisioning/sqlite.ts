import "server-only";

import type { WaiaDb } from "@/db/types";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  getTraderOrgProfileSqlite,
  insertTraderOrgProfileSqlite,
} from "@/lib/trader/persistence/org-profile";
import {
  traderAuditActions,
  traderEntityTypes,
  type EnsureTraderOrgProfileInput,
  type EnsureTraderOrgProfileResult,
} from "@/lib/trader/types";

/**
 * Idempotent trader org anchor provisioning (library only — no runtime call sites in AT-E1).
 * On first create, writes `trader.org_profile.created` to the Core audit stream.
 */
export function ensureTraderOrgProfileSqlite(
  db: WaiaDb,
  input: EnsureTraderOrgProfileInput,
): EnsureTraderOrgProfileResult {
  const existing = getTraderOrgProfileSqlite(db, { organizationId: input.organizationId });
  if (existing) {
    return { profileId: existing.id, created: false };
  }

  const created = insertTraderOrgProfileSqlite(db, input.organizationId);
  writeTraderAuditLogSqlite(db, {
    actorType: input.actorType ?? "system",
    actorId: input.actorId ?? null,
    action: traderAuditActions.orgProfileCreated,
    entityType: traderEntityTypes.orgProfile,
    entityId: created.id,
    organizationId: created.organizationId,
  });

  return { profileId: created.id, created: true };
}
