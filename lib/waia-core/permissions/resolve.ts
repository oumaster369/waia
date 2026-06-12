import "server-only";

import { and, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { organizationMembers, organizationSubscriptions, userPlatformRoles } from "@/db/schema";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { isWaiaCoreEnforcementEnabled } from "@/lib/waia-core/config";
import type { PermissionCheckInput, PlatformRole, WaiaModule } from "@/lib/waia-core/types";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

const ADMIN_PERMISSIONS = new Set([
  "admin.audit.read",
  "admin.org.read",
  "admin.entitlement.manage",
]);

const USER_PERMISSIONS = new Set(["org.member.read", "org.subscription.read"]);

const ROLE_PERMISSIONS: Record<PlatformRole, ReadonlySet<string>> = {
  user: USER_PERMISSIONS,
  admin: new Set([...USER_PERMISSIONS, ...ADMIN_PERMISSIONS]),
  agent: new Set(["service.automation.run"]),
  service: new Set(["service.backend.run", "audit.write"]),
};

export type PermissionCheckResult = {
  allowed: boolean;
  role: PlatformRole | null;
  enforced: boolean;
};

export function resolvePermissionSqlite(
  db: WaiaDb,
  input: PermissionCheckInput,
): PermissionCheckResult {
  const roleRow = db
    .select({ role: userPlatformRoles.role })
    .from(userPlatformRoles)
    .where(eq(userPlatformRoles.userId, input.userId))
    .limit(1)
    .all()[0];

  const role = (roleRow?.role as PlatformRole | undefined) ?? null;
  if (!role) {
    return { allowed: false, role: null, enforced: isWaiaCoreEnforcementEnabled() };
  }

  const member = db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(organizationMembers.userId, input.userId),
      ),
    )
    .limit(1)
    .all()[0];

  if (!member && role !== "admin" && role !== "service") {
    return { allowed: false, role, enforced: isWaiaCoreEnforcementEnabled() };
  }

  const allowed = ROLE_PERMISSIONS[role]?.has(input.permission) ?? false;
  return { allowed, role, enforced: isWaiaCoreEnforcementEnabled() };
}

export function hasActiveModuleSubscriptionSqlite(
  db: WaiaDb,
  organizationId: string,
  module: WaiaModule,
): boolean {
  const row = db
    .select({ status: organizationSubscriptions.status })
    .from(organizationSubscriptions)
    .where(
      and(
        eq(organizationSubscriptions.organizationId, organizationId),
        eq(organizationSubscriptions.module, module),
      ),
    )
    .limit(1)
    .all()[0];
  return row?.status === "active";
}

/** Postgres parity for {@link resolvePermissionSqlite}. */
export async function resolvePermissionPostgres(
  ex: PgReadExecutor,
  input: PermissionCheckInput,
): Promise<PermissionCheckResult> {
  const roleRows = await ex
    .select({ role: pgSchema.userPlatformRoles.role })
    .from(pgSchema.userPlatformRoles)
    .where(eq(pgSchema.userPlatformRoles.userId, input.userId))
    .limit(1);

  const role = (roleRows[0]?.role as PlatformRole | undefined) ?? null;
  if (!role) {
    return { allowed: false, role: null, enforced: isWaiaCoreEnforcementEnabled() };
  }

  const memberRows = await ex
    .select({ id: pgSchema.organizationMembers.id })
    .from(pgSchema.organizationMembers)
    .where(
      and(
        eq(pgSchema.organizationMembers.organizationId, input.organizationId),
        eq(pgSchema.organizationMembers.userId, input.userId),
      ),
    )
    .limit(1);

  if (!memberRows[0] && role !== "admin" && role !== "service") {
    return { allowed: false, role, enforced: isWaiaCoreEnforcementEnabled() };
  }

  const allowed = ROLE_PERMISSIONS[role]?.has(input.permission) ?? false;
  return { allowed, role, enforced: isWaiaCoreEnforcementEnabled() };
}

/** Postgres parity for {@link hasActiveModuleSubscriptionSqlite}. */
export async function hasActiveModuleSubscriptionPostgres(
  ex: PgReadExecutor,
  organizationId: string,
  module: WaiaModule,
): Promise<boolean> {
  const rows = await ex
    .select({ status: pgSchema.organizationSubscriptions.status })
    .from(pgSchema.organizationSubscriptions)
    .where(
      and(
        eq(pgSchema.organizationSubscriptions.organizationId, organizationId),
        eq(pgSchema.organizationSubscriptions.module, module),
      ),
    )
    .limit(1);
  return rows[0]?.status === "active";
}
