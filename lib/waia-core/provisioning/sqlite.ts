import "server-only";

import { and, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import {
  organizationEntitlements,
  organizationMembers,
  organizationSubscriptions,
  organizations,
  profiles,
  userPlatformRoles,
  users,
} from "@/db/schema";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import type { CoreProvisioningInput } from "@/lib/waia-core/types";

function resolveDisplayName(db: WaiaDb, userId: string, fallback?: string): string {
  if (fallback && fallback.trim() !== "") {
    return fallback.trim().slice(0, 200);
  }
  const row = db
    .select({ identityLabel: users.identityLabel })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .all()[0];
  return row?.identityLabel?.trim() || "User";
}

/**
 * Idempotent WAIA Core seed for an existing user row (profiles, personal org, membership, role, twin entitlement).
 * Synchronous for SQLite transaction compatibility.
 */
export function ensureUserCoreSeedSqlite(db: WaiaDb, input: CoreProvisioningInput): string {
  const displayName = resolveDisplayName(db, input.userId, input.displayName);
  const now = new Date();
  const personalOrgId = personalOrganizationIdFromUserId(input.userId);

  const existingProfile = db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, input.userId))
    .limit(1)
    .all()[0];

  if (!existingProfile) {
    db.insert(profiles)
      .values({
        id: crypto.randomUUID(),
        userId: input.userId,
        displayName,
        locale: "en",
      })
      .run();
  }

  const existingOrg = db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, personalOrgId))
    .limit(1)
    .all()[0];

  if (!existingOrg) {
    db.insert(organizations)
      .values({
        id: personalOrgId,
        ownerUserId: input.userId,
        kind: "personal",
        name: `${displayName}'s workspace`,
      })
      .run();
  }

  const existingMember = db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, personalOrgId),
        eq(organizationMembers.userId, input.userId),
      ),
    )
    .limit(1)
    .all()[0];

  if (!existingMember) {
    db.insert(organizationMembers)
      .values({
        id: crypto.randomUUID(),
        organizationId: personalOrgId,
        userId: input.userId,
        memberRole: "owner",
      })
      .run();
  }

  const existingRole = db
    .select({ userId: userPlatformRoles.userId })
    .from(userPlatformRoles)
    .where(eq(userPlatformRoles.userId, input.userId))
    .limit(1)
    .all()[0];

  if (!existingRole) {
    db.insert(userPlatformRoles)
      .values({
        userId: input.userId,
        role: "user",
      })
      .run();
  }

  const existingSub = db
    .select({ id: organizationSubscriptions.id })
    .from(organizationSubscriptions)
    .where(
      and(
        eq(organizationSubscriptions.organizationId, personalOrgId),
        eq(organizationSubscriptions.module, "twin"),
      ),
    )
    .limit(1)
    .all()[0];

  if (!existingSub) {
    db.insert(organizationSubscriptions)
      .values({
        id: crypto.randomUUID(),
        organizationId: personalOrgId,
        module: "twin",
        status: "active",
        updatedAt: now,
      })
      .run();
  }

  const existingEnt = db
    .select({ id: organizationEntitlements.id })
    .from(organizationEntitlements)
    .where(
      and(
        eq(organizationEntitlements.organizationId, personalOrgId),
        eq(organizationEntitlements.entitlementKey, "twin"),
      ),
    )
    .limit(1)
    .all()[0];

  if (!existingEnt) {
    db.insert(organizationEntitlements)
      .values({
        id: crypto.randomUUID(),
        organizationId: personalOrgId,
        entitlementKey: "twin",
        enabled: true,
        sourceModule: "twin",
        updatedAt: now,
      })
      .run();
  }

  return personalOrgId;
}
