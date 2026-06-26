import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { organizationEntitlements, traderOrgProfiles } from "@/db/schema";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { ensureTraderRuntimeForUser } from "@/lib/trader/runtime-provisioning";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000d3310";

function grantTraderEntitlementSqlite(db: ReturnType<typeof getDb>, userId: string): string {
  const organizationId = personalOrganizationIdFromUserId(userId);
  const now = new Date();
  db.insert(organizationEntitlements)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      entitlementKey: "trader",
      enabled: true,
      sourceModule: "trader",
      updatedAt: now,
    })
    .run();
  return organizationId;
}

describe("trader runtime provisioning (DEE-331 / NEW-4)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-trader-runtime-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "runtime.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "trader-runtime@waia.invalid",
      password: "password123",
      identityLabel: "Trader Runtime User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Trader Runtime User",
    });
    grantTraderEntitlementSqlite(db, USER_ID);
  });

  it("returns false without trader entitlement", async () => {
    const db = getDb();
    db.delete(organizationEntitlements)
      .where(eq(organizationEntitlements.organizationId, organizationId))
      .run();

    await expect(ensureTraderRuntimeForUser(USER_ID)).resolves.toBe(false);

    const rows = db
      .select({ id: traderOrgProfiles.id })
      .from(traderOrgProfiles)
      .where(eq(traderOrgProfiles.organizationId, organizationId))
      .all();
    expect(rows).toHaveLength(0);

    grantTraderEntitlementSqlite(db, USER_ID);
  });

  it("creates trader_org_profiles on first entitled access", async () => {
    const db = getDb();
    const before = db
      .select({ id: traderOrgProfiles.id })
      .from(traderOrgProfiles)
      .where(eq(traderOrgProfiles.organizationId, organizationId))
      .all();
    expect(before).toHaveLength(0);

    await expect(ensureTraderRuntimeForUser(USER_ID)).resolves.toBe(true);

    const after = db
      .select({ id: traderOrgProfiles.id })
      .from(traderOrgProfiles)
      .where(eq(traderOrgProfiles.organizationId, organizationId))
      .all();
    expect(after).toHaveLength(1);
  });

  it("is idempotent on subsequent calls", async () => {
    await expect(ensureTraderRuntimeForUser(USER_ID)).resolves.toBe(true);

    const db = getDb();
    const rows = db
      .select({ id: traderOrgProfiles.id })
      .from(traderOrgProfiles)
      .where(eq(traderOrgProfiles.organizationId, organizationId))
      .all();
    expect(rows).toHaveLength(1);
  });
});
