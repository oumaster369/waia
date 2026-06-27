/**
 * Seeds a deterministic validation org for DEE-337 paper replay (SQLite only).
 * Prints organization UUID to stdout (last line).
 *
 * Usage:
 *   DATABASE_URL=file:./replay.db pnpm trader:replay:seed-org
 */

import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
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
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";

const DEFAULT_USER_ID = "00000000-0000-4000-8000-0000000337";
const DEFAULT_EMAIL = "dee-337@waia.invalid";

function seedReplayOrg(userId: string, email: string, displayName: string): string {
  resetWaiaSqliteSingleton();
  migrateDatabaseFromEnv();
  const db = getDb();
  const now = new Date();
  const personalOrgId = personalOrganizationIdFromUserId(userId);

  const existingUser = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .all()[0];

  if (!existingUser) {
    db.insert(users)
      .values({
        id: userId,
        email: email.trim().toLowerCase(),
        identityLabel: displayName,
        passwordHash: bcrypt.hashSync("password123", 10),
      })
      .run();
    ensureUserTwinSeed(db, userId);
  }

  const existingProfile = db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)
    .all()[0];

  if (!existingProfile) {
    db.insert(profiles)
      .values({
        id: crypto.randomUUID(),
        userId,
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
        ownerUserId: userId,
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
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1)
    .all()[0];

  if (!existingMember) {
    db.insert(organizationMembers)
      .values({
        id: crypto.randomUUID(),
        organizationId: personalOrgId,
        userId,
        memberRole: "owner",
      })
      .run();
  }

  const existingRole = db
    .select({ userId: userPlatformRoles.userId })
    .from(userPlatformRoles)
    .where(eq(userPlatformRoles.userId, userId))
    .limit(1)
    .all()[0];

  if (!existingRole) {
    db.insert(userPlatformRoles).values({ userId, role: "user" }).run();
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

function main(): void {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    throw new Error("[trader:replay:seed-org] WAIA_TRADER_CLI=1 is required");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("[trader:replay:seed-org] DATABASE_URL is required");
  }

  const orgId = seedReplayOrg(DEFAULT_USER_ID, DEFAULT_EMAIL, "DEE-337");
  console.log(orgId);
}

main();
