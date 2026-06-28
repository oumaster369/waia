import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { userPlatformRoles } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { eq } from "drizzle-orm";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { handleAdminRuntimeHealth } from "@/lib/trader/runtime-health/admin-route-handler";
import { handleAdminAuditList } from "@/lib/waia-core/audit/admin-route-handler";
import { handleAdminOrganizationsList } from "@/lib/waia-core/permissions/admin-route-handler";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000d801";
const ADMIN_ID = "00000000-0000-4000-8000-00000000d802";

function createDeps(getUserId: () => Promise<string | null>): AdminRouteHandlerDeps {
  return {
    getUserId,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}

describe("trader admin route auth", () => {
  let db: WaiaDb;
  let userOrgId: string;
  let adminOrgId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-trader-admin-auth-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "admin-auth.sqlite")}`;
    migrateDatabaseFromEnv();
    db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "admin-route-user@waia.invalid",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: ADMIN_ID,
      email: "admin-route-admin@waia.invalid",
      password: "password123",
    });

    userOrgId = ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "Route User" });
    ensureUserCoreSeedSqlite(db, { userId: ADMIN_ID, displayName: "Route Admin" });
    adminOrgId = personalOrganizationIdFromUserId(ADMIN_ID);

    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_ID))
      .run();
  });

  it("returns 401 when unauthenticated for organizations list", async () => {
    const result = await handleAdminOrganizationsList(createDeps(async () => null));
    expect(result.status).toBe(401);
  });

  it("returns 403 for non-admin audit read", async () => {
    const result = await handleAdminAuditList(
      new Request(`http://localhost/api/trader/admin/audit?organization_id=${userOrgId}`),
      createDeps(async () => USER_ID),
    );
    expect(result.status).toBe(403);
  });

  it("allows admin audit read via resolvePermission", async () => {
    const result = await handleAdminAuditList(
      new Request(`http://localhost/api/trader/admin/audit?organization_id=${userOrgId}`),
      createDeps(async () => ADMIN_ID),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ auditLogs: expect.any(Array) });
  });

  it("allows admin runtime health read", async () => {
    const result = await handleAdminRuntimeHealth(
      new Request(`http://localhost/api/trader/admin/runtime-health?organization_id=${adminOrgId}`),
      createDeps(async () => ADMIN_ID),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      executionHostHealthy: expect.any(Boolean),
      executionHostConfigured: expect.any(Boolean),
    });
  });

  it("returns 403 for non-admin organizations list", async () => {
    const result = await handleAdminOrganizationsList(createDeps(async () => USER_ID));
    expect(result.status).toBe(403);
  });

  it("allows admin organizations list", async () => {
    const result = await handleAdminOrganizationsList(createDeps(async () => ADMIN_ID));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ organizations: expect.any(Array) });
  });
});
