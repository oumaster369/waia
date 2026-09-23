import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { userPlatformRoles } from "@/db/schema";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { handleAdminConsoleTimeGet } from "@/lib/trader/admin-console/handlers/time";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a951";
const ADMIN_ID = "00000000-0000-4000-8000-00000000a952";

describe("admin console routes on sqlite", () => {
  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-admin-console-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "console.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "console-user@waia.invalid",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: ADMIN_ID,
      email: "console-admin@waia.invalid",
      password: "password123",
    });
    ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "Console User" });
    ensureUserCoreSeedSqlite(db, { userId: ADMIN_ID, displayName: "Console Admin" });
    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_ID))
      .run();
  });

  function deps(userId: string | null): AdminRouteHandlerDeps {
    return {
      getUserId: async () => userId,
      getRuntimeDb: getWaiaRuntimeDb,
      disposeRuntimeDb: disposeWaiaRuntimeDb,
    };
  }

  it("requires a signed-in admin and returns POSTGRES_REQUIRED on sqlite", async () => {
    const request = new Request("http://localhost/api/trader/admin/console/time");
    const anonymous = await handleAdminConsoleTimeGet(request, deps(null));
    expect(anonymous.status).toBe(401);
    const forbidden = await handleAdminConsoleTimeGet(request, deps(USER_ID));
    expect(forbidden.status).toBe(403);
    const allowed = await handleAdminConsoleTimeGet(request, deps(ADMIN_ID));
    expect(allowed.status).toBe(200);
    expect(JSON.stringify(allowed.body)).toContain("POSTGRES_REQUIRED");
  });

  it("returns POSTGRES_REQUIRED for client and invoice reads on sqlite", async () => {
    const { handleAdminConsoleClientsGet } =
      await import("@/lib/trader/admin-console/handlers/clients");
    const { handleAdminConsoleInvoicesGet } =
      await import("@/lib/trader/admin-console/handlers/invoices");
    const clients = await handleAdminConsoleClientsGet(
      new Request("http://localhost/api/trader/admin/console/clients"),
      deps(ADMIN_ID),
    );
    const invoices = await handleAdminConsoleInvoicesGet(
      new Request("http://localhost/api/trader/admin/console/invoices"),
      deps(ADMIN_ID),
    );
    expect(clients.status).toBe(200);
    expect(invoices.status).toBe(200);
    expect(JSON.stringify(clients.body)).toContain("POSTGRES_REQUIRED");
    expect(JSON.stringify(invoices.body)).toContain("POSTGRES_REQUIRED");
  });
});
