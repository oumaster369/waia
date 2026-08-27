import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { userPlatformRoles } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";

export type WaiaAdminAccess = {
  superAdmin: boolean;
  finance: boolean;
  hr: boolean;
};

const NONE: WaiaAdminAccess = { superAdmin: false, finance: false, hr: false };

/** Server-owned module access. Legacy platform `admin` remains equivalent to SUPER_ADMIN. */
export async function resolveWaiaAdminAccess(
  runtime: WaiaRuntimeDb,
  userId: string,
): Promise<WaiaAdminAccess> {
  if (runtime.kind === "sqlite") {
    const row = runtime.db
      .select({ role: userPlatformRoles.role })
      .from(userPlatformRoles)
      .where(eq(userPlatformRoles.userId, userId))
      .limit(1)
      .all()[0];
    return row?.role === "admin" ? { superAdmin: true, finance: true, hr: true } : NONE;
  }

  const [platformRows, grantRows] = await Promise.all([
    runtime.db
      .select({ role: pgSchema.userPlatformRoles.role })
      .from(pgSchema.userPlatformRoles)
      .where(eq(pgSchema.userPlatformRoles.userId, userId))
      .limit(1),
    runtime.db
      .select({ role: pgSchema.waiaAdminModuleGrants.role })
      .from(pgSchema.waiaAdminModuleGrants)
      .where(
        and(
          eq(pgSchema.waiaAdminModuleGrants.userId, userId),
          isNull(pgSchema.waiaAdminModuleGrants.revokedAt),
        ),
      ),
  ]);
  const roles = new Set(grantRows.map((row) => row.role));
  const superAdmin = platformRows[0]?.role === "admin" || roles.has("SUPER_ADMIN");
  return {
    superAdmin,
    finance: superAdmin || roles.has("FINANCE_ADMIN"),
    hr: superAdmin || roles.has("HR_ADMIN"),
  };
}
