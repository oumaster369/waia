import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { userPlatformRoles } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { handleAdminAccountStatusGet } from "@/lib/trader/settlement/admin-route-handler";
import { handleAdminAuditList } from "@/lib/waia-core/audit/admin-route-handler";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const ADMIN_USER = "00000000-0000-4000-8000-00000000d811";

function createDeps(userId: string): AdminRouteHandlerDeps {
  return {
    getUserId: async () => userId,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}

describe("trader admin tenant isolation", () => {
  let db: WaiaDb;
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-trader-admin-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "admin-iso.sqlite")}`;
    migrateDatabaseFromEnv();
    db = getDb();

    insertEmailPasswordUser(db, {
      id: ADMIN_USER,
      email: "admin-tenant@waia.invalid",
      password: "password123",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: ADMIN_USER, displayName: "Admin Tenant A" });

    const otherUserId = "00000000-0000-4000-8000-00000000d812";
    insertEmailPasswordUser(db, {
      id: otherUserId,
      email: "admin-tenant-b@waia.invalid",
      password: "password123",
    });
    orgB = ensureUserCoreSeedSqlite(db, { userId: otherUserId, displayName: "Tenant B" });

    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_USER))
      .run();
  });

  it("admin audit read is scoped to requested organization_id", async () => {
    const orgAResult = await handleAdminAuditList(
      new Request(`http://localhost/api/trader/admin/audit?organization_id=${orgA}`),
      createDeps(ADMIN_USER),
    );
    expect(orgAResult.status).toBe(200);

    const orgBResult = await handleAdminAuditList(
      new Request(`http://localhost/api/trader/admin/audit?organization_id=${orgB}`),
      createDeps(ADMIN_USER),
    );
    expect(orgBResult.status).toBe(200);

    const orgABody = orgAResult.body as { auditLogs: Array<{ organizationId: string | null }> };
    const orgBBody = orgBResult.body as { auditLogs: Array<{ organizationId: string | null }> };

    for (const row of orgABody.auditLogs) {
      expect(row.organizationId === orgA || row.organizationId === null).toBe(true);
    }
    for (const row of orgBBody.auditLogs) {
      expect(row.organizationId === orgB || row.organizationId === null).toBe(true);
    }
  });

  it("account status read requires exchange_account_id and org context", async () => {
    const missingAccount = await handleAdminAccountStatusGet(
      new Request(`http://localhost/api/trader/admin/account-status?organization_id=${orgA}`),
      createDeps(ADMIN_USER),
    );
    expect(missingAccount.status).toBe(400);

    const crossOrg = await handleAdminAccountStatusGet(
      new Request(
        `http://localhost/api/trader/admin/account-status?organization_id=${orgB}&exchange_account_id=acct-1`,
      ),
      createDeps(ADMIN_USER),
    );
    expect(crossOrg.status).toBe(200);
    expect(crossOrg.body).toMatchObject({
      projection: null,
      events: [],
    });
  });

  it("rejects invalid organization_id", async () => {
    const result = await handleAdminAuditList(
      new Request("http://localhost/api/trader/admin/audit?organization_id=%20"),
      createDeps(ADMIN_USER),
    );
    expect(result.status).toBe(400);
  });
});
