import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { traderReportingPeriods, userPlatformRoles } from "@/db/schema";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { filterAuditRows } from "@/lib/waia-core/audit/audit-log-filter";
import { handleAdminReportingPeriodsGet } from "@/lib/trader/billing/reporting-periods-read";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000a961";
const ADMIN_ID = "00000000-0000-4000-8000-00000000a962";

describe("audit page filter", () => {
  const rows = [
    {
      actorType: "user",
      actorId: "admin-1",
      action: "invoice.issued",
      entityType: "trader_invoice",
      entityId: "inv-1",
    },
    {
      actorType: "system",
      actorId: null,
      action: "period.closed",
      entityType: "trader_reporting_period",
      entityId: "period-1",
    },
  ];

  it("filters the fetched page by actor, action, and entity", () => {
    expect(filterAuditRows(rows, { actor: "admin-1" })).toHaveLength(1);
    expect(filterAuditRows(rows, { action: "PERIOD" })[0]?.entityId).toBe("period-1");
    expect(filterAuditRows(rows, { entity: "invoice" })[0]?.action).toBe("invoice.issued");
    expect(filterAuditRows(rows, { actor: "missing" })).toEqual([]);
    expect(filterAuditRows(rows, {})).toHaveLength(2);
  });
});

describe("closed reporting periods", () => {
  let organizationId = "";

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-closed-periods-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "periods.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "periods-user@waia.invalid",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: ADMIN_ID,
      email: "periods-admin@waia.invalid",
      password: "password123",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: ADMIN_ID,
      displayName: "Periods Admin",
    });
    ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "Periods User" });
    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_ID))
      .run();
    const base = {
      organizationId,
      exchangeAccountId: "acct-1",
      startingEquity: "1000",
      openPositionsSnapshotRef: "",
      valuationSource: "stored",
      startingSnapshotAt: new Date("2026-08-01T00:00:00.000Z"),
      recordContentDigest: "a".repeat(64),
      schemaVersion: "v1",
    };
    db.insert(traderReportingPeriods)
      .values([
        {
          ...base,
          id: "00000000-0000-4000-8000-00000000b001",
          status: "OPEN",
          periodStart: new Date("2026-09-01T00:00:00.000Z"),
          periodEnd: null,
          realizedPnl: null,
          unrealizedPnl: null,
          endingEquity: null,
        },
        {
          ...base,
          id: "00000000-0000-4000-8000-00000000b002",
          status: "CLOSED",
          periodStart: new Date("2026-08-01T00:00:00.000Z"),
          periodEnd: new Date("2026-09-01T00:00:00.000Z"),
          realizedPnl: "12.50",
          unrealizedPnl: "0",
          endingEquity: "1012.50",
        },
      ])
      .run();
  });

  function deps(userId: string | null): AdminRouteHandlerDeps {
    return {
      getUserId: async () => userId,
      getRuntimeDb: getWaiaRuntimeDb,
      disposeRuntimeDb: disposeWaiaRuntimeDb,
    };
  }

  it("returns only closed periods and keeps amounts as text", async () => {
    const result = await handleAdminReportingPeriodsGet(
      new Request(
        `http://localhost/api/trader/admin/reporting-periods?organization_id=${organizationId}`,
      ),
      deps(ADMIN_ID),
    );
    expect(result.status).toBe(200);
    const body = result.body as { reportingPeriods: { id: string; realizedPnl: string | null }[] };
    expect(body.reportingPeriods.map((row) => row.id)).toEqual([
      "00000000-0000-4000-8000-00000000b002",
    ]);
    expect(body.reportingPeriods[0]?.realizedPnl).toBe("12.50");
  });
});
