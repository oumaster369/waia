import "server-only";

import { and, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { organizationEntitlements } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { isWaiaCoreEnforcementEnabled, isWaiaCoreShadowMode } from "@/lib/waia-core/config";
import { writeAuditLogPostgres, writeAuditLogSqlite } from "@/lib/waia-core/audit/write";
import type { EntitlementCheckInput } from "@/lib/waia-core/types";

type PgEntitlementExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type EntitlementCheckResult = {
  allowed: boolean;
  shadowMismatch: boolean;
  enforced: boolean;
};

export function checkEntitlementSqlite(
  db: WaiaDb,
  input: EntitlementCheckInput,
): EntitlementCheckResult {
  const row = db
    .select({ enabled: organizationEntitlements.enabled })
    .from(organizationEntitlements)
    .where(
      and(
        eq(organizationEntitlements.organizationId, input.organizationId),
        eq(organizationEntitlements.entitlementKey, input.entitlementKey),
      ),
    )
    .limit(1)
    .all()[0];

  const allowed = row?.enabled === true;
  const enforced = isWaiaCoreEnforcementEnabled();
  const shadowMismatch = !allowed && isWaiaCoreShadowMode();

  if (shadowMismatch) {
    writeAuditLogSqlite(db, {
      actorType: "system",
      actorId: input.actorUserId ?? null,
      action: "entitlement.shadow_mismatch",
      entityType: "organization_entitlement",
      entityId: input.entitlementKey,
      organizationId: input.organizationId,
      metadata: {
        entitlementKey: input.entitlementKey,
        enforced,
      },
    });
  }

  return {
    allowed: enforced ? allowed : true,
    shadowMismatch,
    enforced,
  };
}

/** Postgres parity for {@link checkEntitlementSqlite}. */
export async function checkEntitlementPostgres(
  ex: PgEntitlementExecutor,
  input: EntitlementCheckInput,
): Promise<EntitlementCheckResult> {
  const rows = await ex
    .select({ enabled: pgSchema.organizationEntitlements.enabled })
    .from(pgSchema.organizationEntitlements)
    .where(
      and(
        eq(pgSchema.organizationEntitlements.organizationId, input.organizationId),
        eq(pgSchema.organizationEntitlements.entitlementKey, input.entitlementKey),
      ),
    )
    .limit(1);

  const allowed = rows[0]?.enabled === true;
  const enforced = isWaiaCoreEnforcementEnabled();
  const shadowMismatch = !allowed && isWaiaCoreShadowMode();

  if (shadowMismatch) {
    await writeAuditLogPostgres(ex, {
      actorType: "system",
      actorId: input.actorUserId ?? null,
      action: "entitlement.shadow_mismatch",
      entityType: "organization_entitlement",
      entityId: input.entitlementKey,
      organizationId: input.organizationId,
      metadata: { entitlementKey: input.entitlementKey, enforced },
    });
  }

  return {
    allowed: enforced ? allowed : true,
    shadowMismatch,
    enforced,
  };
}
