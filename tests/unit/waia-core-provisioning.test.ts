import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
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
import { backfillCoreForAllUsersSqlite } from "@/lib/waia-core/backfill/sqlite";
import {
  getProfileForUserSqlite,
  updateProfileForUserSqlite,
} from "@/lib/waia-core/profiles/sqlite";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { ensureUserTwinSeed } from "@/lib/twin-persistence/user-twin-seed";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import type { WaiaDb } from "@/db/types";

const TEST_USER_ID = "00000000-0000-4000-8000-00000000c0e1";

describe("WAIA Core provisioning (WC-E1…E4)", () => {
  let db: WaiaDb;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-core-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "core.sqlite")}`;
    migrateDatabaseFromEnv();
    db = getDb();
    insertEmailPasswordUser(db, {
      id: TEST_USER_ID,
      email: "core-user@waia.invalid",
      password: "password123",
      identityLabel: "Core User",
    });
  });

  it("ensureUserCoreSeedSqlite is idempotent and provisions profile + personal org + membership + role + twin entitlement", () => {
    const orgId1 = ensureUserCoreSeedSqlite(db, {
      userId: TEST_USER_ID,
      displayName: "Core User",
    });
    const orgId2 = ensureUserCoreSeedSqlite(db, {
      userId: TEST_USER_ID,
      displayName: "Core User",
    });

    expect(orgId1).toBe(personalOrganizationIdFromUserId(TEST_USER_ID));
    expect(orgId2).toBe(orgId1);

    const profile = getProfileForUserSqlite(db, TEST_USER_ID);
    expect(profile?.displayName).toBe("Core User");
    expect(profile?.locale).toBe("en");

    const org = db.select().from(organizations).where(eq(organizations.id, orgId1)).all()[0];
    expect(org?.kind).toBe("personal");
    expect(org?.ownerUserId).toBe(TEST_USER_ID);

    const member = db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId1),
          eq(organizationMembers.userId, TEST_USER_ID),
        ),
      )
      .all()[0];
    expect(member?.memberRole).toBe("owner");

    const role = db
      .select()
      .from(userPlatformRoles)
      .where(eq(userPlatformRoles.userId, TEST_USER_ID))
      .all()[0];
    expect(role?.role).toBe("user");

    const sub = db
      .select()
      .from(organizationSubscriptions)
      .where(
        and(
          eq(organizationSubscriptions.organizationId, orgId1),
          eq(organizationSubscriptions.module, "twin"),
        ),
      )
      .all()[0];
    expect(sub?.status).toBe("active");

    const ent = db
      .select()
      .from(organizationEntitlements)
      .where(
        and(
          eq(organizationEntitlements.organizationId, orgId1),
          eq(organizationEntitlements.entitlementKey, "twin"),
        ),
      )
      .all()[0];
    expect(ent?.enabled).toBe(true);
  });

  it("twin seed path also provisions core rows (continuity)", () => {
    const freshUserId = "00000000-0000-4000-8000-00000000c0e2";
    db.insert(users)
      .values({
        id: freshUserId,
        email: "fresh@waia.invalid",
        identityLabel: "Fresh",
        passwordHash: null,
      })
      .run();

    ensureUserTwinSeed(db, freshUserId);

    const profile = db.select().from(profiles).where(eq(profiles.userId, freshUserId)).all()[0];
    expect(profile).toBeTruthy();
  });

  it("profile update preserves user linkage", () => {
    const updated = updateProfileForUserSqlite(db, TEST_USER_ID, {
      displayName: "Updated Core User",
      locale: "uk",
    });
    expect(updated?.displayName).toBe("Updated Core User");
    expect(updated?.locale).toBe("uk");
  });

  it("backfillCoreForAllUsersSqlite converges existing users", () => {
    const count = backfillCoreForAllUsersSqlite(db);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("backfill is safe to re-run (idempotent — no duplicate orgs/profiles)", () => {
    backfillCoreForAllUsersSqlite(db);
    const first = {
      orgs: db.select().from(organizations).all().length,
      profiles: db.select().from(profiles).all().length,
      members: db.select().from(organizationMembers).all().length,
    };

    backfillCoreForAllUsersSqlite(db);
    const second = {
      orgs: db.select().from(organizations).all().length,
      profiles: db.select().from(profiles).all().length,
      members: db.select().from(organizationMembers).all().length,
    };

    expect(second).toEqual(first);
    // Exactly one personal org per user.
    const userCount = db.select({ id: users.id }).from(users).all().length;
    expect(second.orgs).toBe(userCount);
    expect(second.profiles).toBe(userCount);
  });
});
