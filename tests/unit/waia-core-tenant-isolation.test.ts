import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  auditLogs,
  organizationEntitlements,
  organizationMembers,
  organizations,
  userPlatformRoles,
} from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { writeAuditLogSqlite } from "@/lib/waia-core/audit/write";
import { listAuditLogsForAdminSqlite } from "@/lib/waia-core/audit/read";
import { checkEntitlementSqlite } from "@/lib/waia-core/entitlements/resolve";
import { resolvePermissionSqlite } from "@/lib/waia-core/permissions/resolve";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import {
  assertOrgMembershipSqlite,
  OrgScopeError,
  requireOrgContext,
} from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000c0a1";
const USER_B = "00000000-0000-4000-8000-00000000c0b1";
const ADMIN_USER = "00000000-0000-4000-8000-00000000c0ad";

describe("WAIA Core tenant isolation gate (WC-E6)", () => {
  let db: WaiaDb;
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-core-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "iso.sqlite")}`;
    migrateDatabaseFromEnv();
    db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "user-a@waia.invalid",
      password: "password123",
      identityLabel: "User A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "user-b@waia.invalid",
      password: "password123",
      identityLabel: "User B",
    });
    insertEmailPasswordUser(db, {
      id: ADMIN_USER,
      email: "admin@waia.invalid",
      password: "password123",
      identityLabel: "Admin",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "User A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "User B" });
    ensureUserCoreSeedSqlite(db, { userId: ADMIN_USER, displayName: "Admin" });

    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_USER))
      .run();
  });

  it("requireOrgContext rejects missing organization id", () => {
    expect(() => requireOrgContext(undefined)).toThrow(OrgScopeError);
  });

  it("cross-org membership is denied for non-member", () => {
    expect(() => assertOrgMembershipSqlite(db, { organizationId: orgB, userId: USER_A })).toThrow(
      OrgScopeError,
    );
  });

  it("user A cannot resolve org B member permissions", () => {
    const result = resolvePermissionSqlite(db, {
      userId: USER_A,
      organizationId: orgB,
      permission: "org.member.read",
    });
    expect(result.allowed).toBe(false);
  });

  it("admin can read audit logs; regular user cannot", () => {
    const auditId = writeAuditLogSqlite(db, {
      actorType: "user",
      actorId: USER_A,
      action: "test.action",
      entityType: "fixture",
      entityId: "1",
      organizationId: orgA,
      metadata: { ok: true },
    });

    const adminRows = listAuditLogsForAdminSqlite(db, { adminUserId: ADMIN_USER, limit: 10 });
    expect(adminRows.some((r) => r.id === auditId)).toBe(true);

    const userRows = listAuditLogsForAdminSqlite(db, { adminUserId: USER_A, limit: 10 });
    expect(userRows.length).toBe(0);
  });

  it("audit logs are append-only — real UPDATE is rejected at the DB level", () => {
    const auditId = writeAuditLogSqlite(db, {
      actorType: "system",
      action: "immutable.update.test",
      entityType: "fixture",
      organizationId: orgA,
    });

    expect(() =>
      db.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.id, auditId)).run(),
    ).toThrow(/append-only/i);

    const row = db.select().from(auditLogs).where(eq(auditLogs.id, auditId)).all()[0];
    expect(row?.action).toBe("immutable.update.test");
  });

  it("audit logs are append-only — real DELETE is rejected at the DB level", () => {
    const auditId = writeAuditLogSqlite(db, {
      actorType: "system",
      action: "immutable.delete.test",
      entityType: "fixture",
      organizationId: orgA,
    });

    expect(() => db.delete(auditLogs).where(eq(auditLogs.id, auditId)).run()).toThrow(
      /append-only/i,
    );

    const row = db.select().from(auditLogs).where(eq(auditLogs.id, auditId)).all()[0];
    expect(row?.id).toBe(auditId);
  });

  it("entitlement shadow mode allows twin access for all personal orgs", () => {
    process.env.WAIA_CORE_ENFORCEMENT = "0";
    process.env.WAIA_CORE_SHADOW = "1";

    const a = checkEntitlementSqlite(db, {
      organizationId: orgA,
      entitlementKey: "twin",
      actorUserId: USER_A,
    });
    const b = checkEntitlementSqlite(db, {
      organizationId: orgB,
      entitlementKey: "twin",
      actorUserId: USER_B,
    });

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  it("cross-org entitlement rows remain isolated", () => {
    const orgBEnt = db
      .select()
      .from(organizationEntitlements)
      .where(eq(organizationEntitlements.organizationId, orgB))
      .all();
    expect(orgBEnt.every((row) => row.organizationId === orgB)).toBe(true);

    const aMembershipInB = db
      .select()
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.organizationId, orgB), eq(organizationMembers.userId, USER_A)),
      )
      .all();
    expect(aMembershipInB.length).toBe(0);
  });

  it("organizations remain distinct per user", () => {
    const rowA = db.select().from(organizations).where(eq(organizations.id, orgA)).all()[0];
    const rowB = db.select().from(organizations).where(eq(organizations.id, orgB)).all()[0];
    expect(rowA?.ownerUserId).toBe(USER_A);
    expect(rowB?.ownerUserId).toBe(USER_B);
    expect(orgA).not.toBe(orgB);
  });
});
