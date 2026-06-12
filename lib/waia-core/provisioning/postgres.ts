import "server-only";

import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import type { CoreProvisioningInput } from "@/lib/waia-core/types";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

async function resolveDisplayName(
  ex: PgExecutor,
  userId: string,
  fallback?: string,
): Promise<string> {
  if (fallback && fallback.trim() !== "") {
    return fallback.trim().slice(0, 200);
  }
  const rows = await ex
    .select({ identityLabel: pgSchema.users.identityLabel })
    .from(pgSchema.users)
    .where(eq(pgSchema.users.id, userId))
    .limit(1);
  return rows[0]?.identityLabel?.trim() || "User";
}

/**
 * Idempotent WAIA Core seed for Postgres runtime (profiles, personal org, membership, role, twin entitlement).
 */
export async function ensureUserCoreSeedPostgres(
  ex: PgExecutor,
  input: CoreProvisioningInput,
): Promise<string> {
  const displayName = await resolveDisplayName(ex, input.userId, input.displayName);
  const personalOrgId = personalOrganizationIdFromUserId(input.userId);

  const profileRows = await ex
    .select({ id: pgSchema.profiles.id })
    .from(pgSchema.profiles)
    .where(eq(pgSchema.profiles.userId, input.userId))
    .limit(1);

  if (!profileRows[0]) {
    await ex.insert(pgSchema.profiles).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      displayName,
      locale: "en",
    });
  }

  const orgRows = await ex
    .select({ id: pgSchema.organizations.id })
    .from(pgSchema.organizations)
    .where(eq(pgSchema.organizations.id, personalOrgId))
    .limit(1);

  if (!orgRows[0]) {
    await ex.insert(pgSchema.organizations).values({
      id: personalOrgId,
      ownerUserId: input.userId,
      kind: "personal",
      name: `${displayName}'s workspace`,
    });
  }

  const memberRows = await ex
    .select({ id: pgSchema.organizationMembers.id })
    .from(pgSchema.organizationMembers)
    .where(
      and(
        eq(pgSchema.organizationMembers.organizationId, personalOrgId),
        eq(pgSchema.organizationMembers.userId, input.userId),
      ),
    )
    .limit(1);

  if (!memberRows[0]) {
    await ex.insert(pgSchema.organizationMembers).values({
      id: crypto.randomUUID(),
      organizationId: personalOrgId,
      userId: input.userId,
      memberRole: "owner",
    });
  }

  const roleRows = await ex
    .select({ userId: pgSchema.userPlatformRoles.userId })
    .from(pgSchema.userPlatformRoles)
    .where(eq(pgSchema.userPlatformRoles.userId, input.userId))
    .limit(1);

  if (!roleRows[0]) {
    await ex.insert(pgSchema.userPlatformRoles).values({
      userId: input.userId,
      role: "user",
    });
  }

  const subRows = await ex
    .select({ id: pgSchema.organizationSubscriptions.id })
    .from(pgSchema.organizationSubscriptions)
    .where(
      and(
        eq(pgSchema.organizationSubscriptions.organizationId, personalOrgId),
        eq(pgSchema.organizationSubscriptions.module, "twin"),
      ),
    )
    .limit(1);

  if (!subRows[0]) {
    await ex.insert(pgSchema.organizationSubscriptions).values({
      id: crypto.randomUUID(),
      organizationId: personalOrgId,
      module: "twin",
      status: "active",
    });
  }

  const entRows = await ex
    .select({ id: pgSchema.organizationEntitlements.id })
    .from(pgSchema.organizationEntitlements)
    .where(
      and(
        eq(pgSchema.organizationEntitlements.organizationId, personalOrgId),
        eq(pgSchema.organizationEntitlements.entitlementKey, "twin"),
      ),
    )
    .limit(1);

  if (!entRows[0]) {
    await ex.insert(pgSchema.organizationEntitlements).values({
      id: crypto.randomUUID(),
      organizationId: personalOrgId,
      entitlementKey: "twin",
      enabled: true,
      sourceModule: "twin",
    });
  }

  return personalOrgId;
}
