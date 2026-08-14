import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { userPlatformRoles } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { eq } from "drizzle-orm";
import type { AdminRouteHandlerDeps } from "@/lib/waia-core/permissions/admin-http";
import { handleTreasuryOrganizationsGet } from "@/lib/waia-core/treasury/admin/handlers";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000d811";
const ADMIN_ID = "00000000-0000-4000-8000-00000000d812";

function createDeps(getUserId: () => Promise<string | null>): AdminRouteHandlerDeps {
  return {
    getUserId,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}

describe("DEE-615 WP-4 treasury organizations sqlite", () => {
  let db: WaiaDb;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-treasury-orgs-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "treasury-orgs.sqlite")}`;
    migrateDatabaseFromEnv();
    db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "treasury-org-user@waia.invalid",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: ADMIN_ID,
      email: "treasury-org-admin@waia.invalid",
      password: "password123",
    });
    ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "Treasury User" });
    ensureUserCoreSeedSqlite(db, { userId: ADMIN_ID, displayName: "Treasury Admin" });
    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_ID))
      .run();
  });

  it("returns 401 when unauthenticated", async () => {
    const result = await handleTreasuryOrganizationsGet(
      new Request("http://localhost/api/admin/treasury/organizations"),
      createDeps(async () => null),
    );
    expect(result.status).toBe(401);
  });

  it("returns 403 for a non-admin user", async () => {
    const result = await handleTreasuryOrganizationsGet(
      new Request("http://localhost/api/admin/treasury/organizations"),
      createDeps(async () => USER_ID),
    );
    expect(result.status).toBe(403);
  });

  it("returns organizations for a platform admin with treasury read", async () => {
    const result = await handleTreasuryOrganizationsGet(
      new Request("http://localhost/api/admin/treasury/organizations"),
      createDeps(async () => ADMIN_ID),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ organizations: expect.any(Array) });
    const rows = (result.body as { organizations: { id: string }[] }).organizations;
    expect(rows.length).toBeGreaterThan(0);
  });
});
