import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { ensureTraderOrgProfileSqlite } from "@/lib/trader/provisioning/sqlite";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000d194";

describe("trader audit wiring (DEE-193)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-trader-audit-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "audit.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "trader-audit@waia.invalid",
      password: "password123",
      identityLabel: "Trader Audit User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Trader Audit User",
    });
  });

  it("writeTraderAuditLogSqlite persists Core audit row with trader entity types", () => {
    const db = getDb();
    const auditId = writeTraderAuditLogSqlite(db, {
      actorType: "service",
      actorId: "trader-test",
      action: traderAuditActions.orgProfileCreated,
      entityType: traderEntityTypes.orgProfile,
      entityId: "profile-test-id",
      organizationId,
      metadata: { source: "unit-test" },
    });

    const row = db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        organizationId: auditLogs.organizationId,
      })
      .from(auditLogs)
      .where(eq(auditLogs.id, auditId))
      .all()[0];

    expect(row).toMatchObject({
      action: traderAuditActions.orgProfileCreated,
      entityType: traderEntityTypes.orgProfile,
      organizationId,
    });
  });

  it("ensureTraderOrgProfile writes trader.org_profile.created on first create", () => {
    const db = getDb();
    const result = ensureTraderOrgProfileSqlite(db, {
      organizationId,
      actorType: "user",
      actorId: USER_ID,
    });
    expect(result.created).toBe(true);

    const auditRow = db
      .select({
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        organizationId: auditLogs.organizationId,
        actorType: auditLogs.actorType,
        actorId: auditLogs.actorId,
      })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, result.profileId))
      .all()[0];

    expect(auditRow).toMatchObject({
      action: traderAuditActions.orgProfileCreated,
      entityType: traderEntityTypes.orgProfile,
      entityId: result.profileId,
      organizationId,
      actorType: "user",
      actorId: USER_ID,
    });
  });

  it("does not duplicate audit rows on idempotent ensure", () => {
    const db = getDb();
    const beforeCount = db.select({ id: auditLogs.id }).from(auditLogs).all().length;
    ensureTraderOrgProfileSqlite(db, { organizationId });
    const afterCount = db.select({ id: auditLogs.id }).from(auditLogs).all().length;
    expect(afterCount).toBe(beforeCount);
  });
});
