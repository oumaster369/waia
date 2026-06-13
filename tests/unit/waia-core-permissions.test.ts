import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { userPlatformRoles } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { eq } from "drizzle-orm";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { resolvePermissionSqlite } from "@/lib/waia-core/permissions/resolve";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000c0e3";
const ADMIN_ID = "00000000-0000-4000-8000-00000000c0e4";

describe("WAIA Core permissions (WC-E3)", () => {
  let db: WaiaDb;
  let orgId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-core-perm-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "perm.sqlite")}`;
    migrateDatabaseFromEnv();
    db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "perm-user@waia.invalid",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: ADMIN_ID,
      email: "perm-admin@waia.invalid",
      password: "password123",
    });

    orgId = ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "Perm User" });
    ensureUserCoreSeedSqlite(db, { userId: ADMIN_ID, displayName: "Perm Admin" });
    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_ID))
      .run();
  });

  it("default user role can read org member data in own org", () => {
    const result = resolvePermissionSqlite(db, {
      userId: USER_ID,
      organizationId: orgId,
      permission: "org.member.read",
    });
    expect(result.allowed).toBe(true);
    expect(result.role).toBe("user");
  });

  it("default user role cannot perform admin audit read", () => {
    const result = resolvePermissionSqlite(db, {
      userId: USER_ID,
      organizationId: orgId,
      permission: "admin.audit.read",
    });
    expect(result.allowed).toBe(false);
  });

  it("admin role can perform admin audit read", () => {
    const adminOrg = personalOrganizationIdFromUserId(ADMIN_ID);
    const result = resolvePermissionSqlite(db, {
      userId: ADMIN_ID,
      organizationId: adminOrg,
      permission: "admin.audit.read",
    });
    expect(result.allowed).toBe(true);
    expect(result.role).toBe("admin");
  });
});
