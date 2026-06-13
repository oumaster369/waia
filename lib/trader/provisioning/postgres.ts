import "server-only";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import {
  getTraderOrgProfilePostgres,
  insertTraderOrgProfilePostgres,
} from "@/lib/trader/persistence/org-profile";
import {
  traderAuditActions,
  traderEntityTypes,
  type EnsureTraderOrgProfileInput,
  type EnsureTraderOrgProfileResult,
} from "@/lib/trader/types";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

/**
 * Idempotent trader org anchor provisioning (library only — no runtime call sites in AT-E1).
 * On first create, writes `trader.org_profile.created` to the Core audit stream.
 */
export async function ensureTraderOrgProfilePostgres(
  ex: PgExecutor,
  input: EnsureTraderOrgProfileInput,
): Promise<EnsureTraderOrgProfileResult> {
  const existing = await getTraderOrgProfilePostgres(ex, { organizationId: input.organizationId });
  if (existing) {
    return { profileId: existing.id, created: false };
  }

  const created = await insertTraderOrgProfilePostgres(ex, input.organizationId);
  await writeTraderAuditLogPostgres(ex, {
    actorType: input.actorType ?? "system",
    actorId: input.actorId ?? null,
    action: traderAuditActions.orgProfileCreated,
    entityType: traderEntityTypes.orgProfile,
    entityId: created.id,
    organizationId: created.organizationId,
  });

  return { profileId: created.id, created: true };
}
