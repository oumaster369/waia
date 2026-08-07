import "server-only";

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import { organizationMembers, organizations, userPlatformRoles, users } from "@/db/schema";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/loader";

const FHV_RESEARCH_USER_PASSWORD = "fhv-research-seed-not-for-auth";

function deterministicFhvResearchUserId(organizationId: string, slot: number): string {
  return `00000000-0000-4000-8000-${String(slot).padStart(12, "0")}`;
}

/** Production-owned deterministic org/user seed for FHV historical execution sessions. */
export function seedFhvSqliteResearchOrganization(input: {
  db: WaiaDb;
  organizationId: string;
  operatorId: string;
  slot?: number;
}): { userId: string; organizationId: string } {
  const slot = input.slot ?? 436;
  const userId = deterministicFhvResearchUserId(input.organizationId, slot);
  const email = `fhv-research-${input.operatorId}-${slot}@waia.invalid`.toLowerCase();
  const db = input.db;

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
        email,
        identityLabel: "FHV Historical Execution",
        passwordHash: bcrypt.hashSync(FHV_RESEARCH_USER_PASSWORD, 10),
      })
      .run();
    ensureUserTwinSeed(db, userId);
  }

  const existingOrg = db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1)
    .all()[0];

  if (!existingOrg) {
    db.insert(organizations)
      .values({
        id: input.organizationId,
        ownerUserId: userId,
        kind: "business",
        name: "FHV Historical Validation",
      })
      .run();
  }

  const existingMember = db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1)
    .all()[0];

  if (!existingMember) {
    db.insert(organizationMembers)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
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
    db.insert(userPlatformRoles)
      .values({
        userId,
        role: "user",
      })
      .run();
  }

  return { userId, organizationId: input.organizationId };
}
