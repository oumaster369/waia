import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import {
  auditLogs,
  organizationEntitlements,
  organizationMembers,
  organizations,
  traderOrgLiveEnable,
  userPlatformRoles,
  users,
} from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import { ensureTraderSelfServiceAccessSqlite } from "@/lib/trader/self-service-access";
import { traderAuditActions } from "@/lib/trader/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";

const NEW_USER = "00000000-0000-4000-8000-00000000a001";
const SEEDED_USER = "00000000-0000-4000-8000-00000000a002";
const ENTITLED_USER = "00000000-0000-4000-8000-00000000a003";
const DISABLED_USER = "00000000-0000-4000-8000-00000000a004";
const NEIGHBOUR_USER = "00000000-0000-4000-8000-00000000a005";
const SQUATTED_USER = "00000000-0000-4000-8000-00000000a006";
const UNADMITTED_USER = "00000000-0000-4000-8000-00000000a007";

let db: WaiaDb;

/** Raw user row only — deliberately skips the twin seed so the user has no membership at all. */
function insertBareUser(userId: string, label: string): void {
  db.insert(users)
    .values({
      id: userId,
      email: `${label}@waia.invalid`,
      identityLabel: label,
      passwordHash: bcrypt.hashSync("password123", 4),
    })
    .run();
}

function orgRows(organizationId: string) {
  return db.select().from(organizations).where(eq(organizations.id, organizationId)).all();
}

function memberRows(organizationId: string) {
  return db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId))
    .all();
}

function entitlementRows(organizationId: string, key?: string) {
  return db
    .select()
    .from(organizationEntitlements)
    .where(
      key
        ? and(
            eq(organizationEntitlements.organizationId, organizationId),
            eq(organizationEntitlements.entitlementKey, key),
          )
        : eq(organizationEntitlements.organizationId, organizationId),
    )
    .all();
}

function selfServiceAuditRows(organizationId: string) {
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, organizationId),
        eq(auditLogs.action, traderAuditActions.moduleEntitlementSelfServiceGranted),
      ),
    )
    .all();
}

function grantTraderEntitlement(organizationId: string, enabled: boolean): void {
  db.insert(organizationEntitlements)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      entitlementKey: "trader",
      enabled,
      sourceModule: "trader",
      updatedAt: new Date(),
    })
    .run();
}

describe("DEE-1019 trader self-service admission (SQLite)", () => {
  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-trader-self-service-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "self-service.sqlite")}`;
    process.env.WAIA_DB_BACKEND = "sqlite";
    migrateDatabaseFromEnv();
    db = getDb();

    for (const [userId, label] of [
      [NEW_USER, "new-partner"],
      [SEEDED_USER, "seeded-partner"],
      [ENTITLED_USER, "entitled-partner"],
      [DISABLED_USER, "disabled-partner"],
      [NEIGHBOUR_USER, "neighbour-partner"],
      [SQUATTED_USER, "squatted-partner"],
      [UNADMITTED_USER, "unadmitted-partner"],
    ] as const) {
      insertBareUser(userId, label);
    }

    for (const userId of [SEEDED_USER, ENTITLED_USER, DISABLED_USER, NEIGHBOUR_USER]) {
      ensureUserCoreSeedSqlite(db, { userId, displayName: "" });
    }
    grantTraderEntitlement(personalOrganizationIdFromUserId(ENTITLED_USER), true);
    grantTraderEntitlement(personalOrganizationIdFromUserId(DISABLED_USER), false);
    grantTraderEntitlement(personalOrganizationIdFromUserId(NEIGHBOUR_USER), true);

    // A foreign owner already holds the deterministic personal-organization id.
    db.insert(organizations)
      .values({
        id: personalOrganizationIdFromUserId(SQUATTED_USER),
        ownerUserId: NEIGHBOUR_USER,
        kind: "personal",
        name: "Foreign workspace",
      })
      .run();
  });

  it("creates exactly one personal organization, owner membership and trader entitlement", async () => {
    const organizationId = personalOrganizationIdFromUserId(NEW_USER);
    expect(orgRows(organizationId)).toHaveLength(0);

    const result = ensureTraderSelfServiceAccessSqlite(db, { userId: NEW_USER });

    expect(result).toMatchObject({
      organizationId,
      outcome: "ORGANIZATION_AND_ENTITLEMENT_CREATED",
      entitled: true,
    });

    const orgs = orgRows(organizationId);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ ownerUserId: NEW_USER, kind: "personal" });

    const members = memberRows(organizationId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: NEW_USER, memberRole: "owner" });

    const trader = entitlementRows(organizationId, "trader");
    expect(trader).toHaveLength(1);
    expect(trader[0]).toMatchObject({ enabled: true, sourceModule: "trader" });

    await expect(hasTraderAccessForUser(NEW_USER)).resolves.toBe(true);
  });

  it("is idempotent across repeated invocation", () => {
    const organizationId = personalOrganizationIdFromUserId(NEW_USER);
    const auditBefore = selfServiceAuditRows(organizationId);
    expect(auditBefore).toHaveLength(1);

    for (let attempt = 0; attempt < 3; attempt++) {
      expect(ensureTraderSelfServiceAccessSqlite(db, { userId: NEW_USER })).toMatchObject({
        outcome: "ALREADY_ENTITLED",
        entitled: true,
      });
    }

    expect(orgRows(organizationId)).toHaveLength(1);
    expect(memberRows(organizationId)).toHaveLength(1);
    expect(entitlementRows(organizationId, "trader")).toHaveLength(1);
    expect(selfServiceAuditRows(organizationId)).toHaveLength(1);
  });

  it("adds only the trader entitlement when the personal organization already exists", () => {
    const organizationId = personalOrganizationIdFromUserId(SEEDED_USER);
    const orgBefore = orgRows(organizationId)[0];
    const membersBefore = memberRows(organizationId);
    const twinBefore = entitlementRows(organizationId, "twin")[0];
    expect(entitlementRows(organizationId, "trader")).toHaveLength(0);

    expect(ensureTraderSelfServiceAccessSqlite(db, { userId: SEEDED_USER })).toMatchObject({
      outcome: "ENTITLEMENT_CREATED",
      entitled: true,
    });

    expect(orgRows(organizationId)[0]).toStrictEqual(orgBefore);
    expect(memberRows(organizationId)).toStrictEqual(membersBefore);
    expect(entitlementRows(organizationId, "twin")[0]).toStrictEqual(twinBefore);
    expect(entitlementRows(organizationId, "trader")).toHaveLength(1);
  });

  it("leaves an already entitled organization byte-identical and writes no audit entry", () => {
    const organizationId = personalOrganizationIdFromUserId(ENTITLED_USER);
    const entitlementsBefore = entitlementRows(organizationId);
    const orgBefore = orgRows(organizationId)[0];

    expect(ensureTraderSelfServiceAccessSqlite(db, { userId: ENTITLED_USER })).toMatchObject({
      outcome: "ALREADY_ENTITLED",
      entitled: true,
    });

    expect(entitlementRows(organizationId)).toStrictEqual(entitlementsBefore);
    expect(orgRows(organizationId)[0]).toStrictEqual(orgBefore);
    expect(selfServiceAuditRows(organizationId)).toHaveLength(0);
  });

  it("re-enables a disabled entitlement in place instead of creating a second row", () => {
    const organizationId = personalOrganizationIdFromUserId(DISABLED_USER);
    const before = entitlementRows(organizationId, "trader");
    expect(before).toHaveLength(1);
    expect(before[0]?.enabled).toBe(false);

    expect(ensureTraderSelfServiceAccessSqlite(db, { userId: DISABLED_USER })).toMatchObject({
      outcome: "ENTITLEMENT_ENABLED",
      entitled: true,
    });

    const after = entitlementRows(organizationId, "trader");
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.enabled).toBe(true);
  });

  it("never mutates an unrelated tenant", () => {
    const neighbourOrg = personalOrganizationIdFromUserId(NEIGHBOUR_USER);
    const neighbourBefore = {
      org: orgRows(neighbourOrg),
      members: memberRows(neighbourOrg),
      entitlements: entitlementRows(neighbourOrg),
    };
    const totalOrgsBefore = db.select().from(organizations).all().length;

    ensureTraderSelfServiceAccessSqlite(db, { userId: UNADMITTED_USER });

    expect(orgRows(neighbourOrg)).toStrictEqual(neighbourBefore.org);
    expect(memberRows(neighbourOrg)).toStrictEqual(neighbourBefore.members);
    expect(entitlementRows(neighbourOrg)).toStrictEqual(neighbourBefore.entitlements);
    expect(memberRows(neighbourOrg).some((row) => row.userId === UNADMITTED_USER)).toBe(false);
    expect(db.select().from(organizations).all().length).toBe(totalOrgsBefore + 1);
  });

  it("refuses admission when the personal organization id is owned by another user", () => {
    const organizationId = personalOrganizationIdFromUserId(SQUATTED_USER);

    expect(ensureTraderSelfServiceAccessSqlite(db, { userId: SQUATTED_USER })).toMatchObject({
      outcome: "DENIED_FOREIGN_ORGANIZATION",
      entitled: false,
    });

    expect(orgRows(organizationId)[0]?.ownerUserId).toBe(NEIGHBOUR_USER);
    expect(entitlementRows(organizationId, "trader")).toHaveLength(0);
    expect(memberRows(organizationId)).toHaveLength(0);
    expect(selfServiceAuditRows(organizationId)).toHaveLength(0);
  });

  it("grants module access only: no role elevation and no live-trading authority", () => {
    const organizationId = personalOrganizationIdFromUserId(NEW_USER);

    const roles = db
      .select()
      .from(userPlatformRoles)
      .where(eq(userPlatformRoles.userId, NEW_USER))
      .all();
    expect(roles).toHaveLength(1);
    expect(roles[0]?.role).toBe("user");

    expect(
      entitlementRows(organizationId)
        .map((row) => row.entitlementKey)
        .sort(),
    ).toStrictEqual(["trader", "twin"]);

    expect(
      db
        .select()
        .from(traderOrgLiveEnable)
        .where(eq(traderOrgLiveEnable.organizationId, organizationId))
        .all(),
    ).toHaveLength(0);
  });

  it("does not self-grant through the protected API gate", async () => {
    const organizationId = personalOrganizationIdFromUserId(UNADMITTED_USER);
    db.delete(organizationEntitlements)
      .where(eq(organizationEntitlements.organizationId, organizationId))
      .run();

    await expect(hasTraderAccessForUser(UNADMITTED_USER)).resolves.toBe(false);
    expect(entitlementRows(organizationId, "trader")).toHaveLength(0);
  });
});
