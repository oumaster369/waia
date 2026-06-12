import "server-only";

import { and, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { organizationEntitlements } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";

export type ModuleEntitlementQuery = {
  organizationId: string;
  entitlementKey: string;
};

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

/**
 * Authoritative entitlement read (SQLite). Returns true only when a row exists with `enabled === true`.
 * Does not consult {@link isWaiaCoreEnforcementEnabled} — use for access gates, not shadow telemetry.
 */
export function hasModuleEntitlementSqlite(db: WaiaDb, input: ModuleEntitlementQuery): boolean {
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

  return row?.enabled === true;
}

/** Postgres parity for {@link hasModuleEntitlementSqlite}. */
export async function hasModuleEntitlementPostgres(
  ex: PgReadExecutor,
  input: ModuleEntitlementQuery,
): Promise<boolean> {
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

  return rows[0]?.enabled === true;
}
