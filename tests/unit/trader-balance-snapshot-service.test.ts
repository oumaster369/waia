import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { createSqliteBalanceSnapshotService } from "@/lib/trader/balances/balance-snapshot-service";
import { insertCredentialRowSqlite } from "@/lib/trader/credentials/repository-sqlite";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000d237";

describe("trader balance snapshot service (DEE-237)", () => {
  let organizationId: string;
  let credentialId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-balance-snap-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "balance-snapshots.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "balance-snap@waia.invalid",
      password: "password123",
      identityLabel: "Balance Snapshot User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Balance Snapshot User",
    });

    const credential = insertCredentialRowSqlite(db, requireOrgContext(organizationId), {
      venue: "htx",
      exchangeAccountId: "spot-237",
    });
    credentialId = credential.id;
  });

  it("recordSnapshot inserts row and emits audit", async () => {
    const db = getDb();
    const service = createSqliteBalanceSnapshotService(db);
    const syncedAt = new Date("2026-06-14T10:00:00.000Z");
    const balances = [
      { asset: "BTC", free: "1.5", locked: "0", total: "1.5" },
      { asset: "USDT", free: "1000", locked: "0", total: "1000" },
    ];

    const snapshot = await service.recordSnapshot(requireOrgContext(organizationId), {
      credentialId,
      venue: "htx",
      exchangeAccountId: "spot-237",
      balances,
      syncedAt,
      actorType: "user",
      actorId: USER_ID,
    });

    expect(snapshot.id).toBeTruthy();
    expect(snapshot.credentialId).toBe(credentialId);
    expect(snapshot.balances).toEqual(balances);
    expect(snapshot.assetCount).toBe(2);
    expect(snapshot.syncedAt).toEqual(syncedAt);

    const audits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.balanceSnapshotCreated))
      .all();
    const audit = audits.find((row) => row.entityId === snapshot.id);
    expect(audit).toBeDefined();
    expect(audit?.entityType).toBe(traderEntityTypes.balanceSnapshot);
    expect(JSON.stringify(audit?.metadataJson ?? {})).not.toContain("1.5");
  });

  it("listSnapshots returns latest-first", async () => {
    const db = getDb();
    const service = createSqliteBalanceSnapshotService(db);

    await service.recordSnapshot(requireOrgContext(organizationId), {
      credentialId,
      venue: "htx",
      exchangeAccountId: "spot-237",
      balances: [{ asset: "ETH", free: "2", locked: "0", total: "2" }],
      syncedAt: new Date("2026-06-14T11:00:00.000Z"),
    });
    await service.recordSnapshot(requireOrgContext(organizationId), {
      credentialId,
      venue: "htx",
      exchangeAccountId: "spot-237",
      balances: [{ asset: "ETH", free: "3", locked: "0", total: "3" }],
      syncedAt: new Date("2026-06-14T12:00:00.000Z"),
    });

    const snapshots = await service.listSnapshots(requireOrgContext(organizationId));
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    expect(snapshots[0]!.syncedAt.getTime()).toBeGreaterThanOrEqual(
      snapshots[1]!.syncedAt.getTime(),
    );
  });

  it("listSnapshots filters by credentialId", async () => {
    const db = getDb();
    const service = createSqliteBalanceSnapshotService(db);
    const otherCredential = insertCredentialRowSqlite(db, requireOrgContext(organizationId), {
      venue: "htx",
      exchangeAccountId: "spot-other",
    });

    await service.recordSnapshot(requireOrgContext(organizationId), {
      credentialId: otherCredential.id,
      venue: "htx",
      exchangeAccountId: "spot-other",
      balances: [{ asset: "SOL", free: "10", locked: "0", total: "10" }],
      syncedAt: new Date("2026-06-14T13:00:00.000Z"),
    });

    const filtered = await service.listSnapshots(requireOrgContext(organizationId), {
      credentialId: otherCredential.id,
    });
    expect(filtered.every((row) => row.credentialId === otherCredential.id)).toBe(true);
  });

  it("listSnapshots honors limit", async () => {
    const db = getDb();
    const service = createSqliteBalanceSnapshotService(db);
    const limited = await service.listSnapshots(requireOrgContext(organizationId), { limit: 2 });
    expect(limited).toHaveLength(2);
  });
});
