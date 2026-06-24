import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderReportingPeriods } from "@/db/schema";
import {
  computeReportingPeriodRecordDigest,
  createSqliteReportingPeriodLifecycleService,
  ReportingPeriodAlreadyOpenError,
  ReportingPeriodDigestMismatchError,
  ReportingPeriodInvalidTransitionError,
  ReportingPeriodNotOpenError,
  verifyReportingPeriodRecordDigest,
} from "@/lib/trader/billing";
import { assertAllowedReportingPeriodTransition } from "@/lib/trader/billing/reporting-period-lifecycle.transitions";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000306";
const EXCHANGE_ACCOUNT_ID = "htx-paper-306";

const PERIOD_START = new Date("2026-06-01T00:00:00.000Z");
const STARTING_SNAPSHOT_AT = new Date("2026-06-01T00:05:00.000Z");
const PERIOD_END = new Date("2026-06-30T23:59:59.000Z");
const ENDING_SNAPSHOT_AT = new Date("2026-06-30T23:55:00.000Z");

describe("reporting period lifecycle service (DEE-306 S2)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-reporting-period-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "reporting-period.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "reporting-period@waia.invalid",
      password: "password123",
      identityLabel: "Reporting Period User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Reporting Period User",
    });
  });

  function openInput() {
    return {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      periodStart: PERIOD_START,
      startingEquity: "10000.00",
      openPositionsSnapshotRef: "paper-positions:2026-06-01T00:05:00.000Z",
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt: STARTING_SNAPSHOT_AT,
    };
  }

  function closeInput() {
    return {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      periodEnd: PERIOD_END,
      endingEquity: "11250.00",
      endingSnapshotAt: ENDING_SNAPSHOT_AT,
      realizedPnl: "800.00",
      unrealizedPnl: "450.00",
    };
  }

  it("opens a reporting period with digest and audit", async () => {
    const db = getDb();
    const service = createSqliteReportingPeriodLifecycleService(db);
    const context = requireOrgContext(organizationId);

    const open = await service.openReportingPeriod(context, openInput());

    expect(open.status).toBe("OPEN");
    expect(open.periodEnd).toBeNull();
    expect(open.endingEquity).toBeNull();
    expect(open.startingEquity).toBe("10000.00");
    expect(open.recordContentDigest).toMatch(/^[a-f0-9]{64}$/);
    verifyReportingPeriodRecordDigest(open);

    const audits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.reportingPeriodOpened))
      .all();
    const audit = audits.find((row) => row.entityId === open.id);
    expect(audit).toBeDefined();
    expect(audit?.entityType).toBe(traderEntityTypes.reportingPeriod);
  });

  it("rejects a second OPEN for the same account", async () => {
    const db = getDb();
    const service = createSqliteReportingPeriodLifecycleService(db);
    const context = requireOrgContext(organizationId);

    await expect(service.openReportingPeriod(context, openInput())).rejects.toThrow(
      ReportingPeriodAlreadyOpenError,
    );
  });

  it("closes the OPEN period, recomputes digest, and writes audit", async () => {
    const db = getDb();
    const service = createSqliteReportingPeriodLifecycleService(db);
    const context = requireOrgContext(organizationId);

    const open = await service.findOpenPeriod(context, EXCHANGE_ACCOUNT_ID);
    expect(open).not.toBeNull();
    const openDigest = open!.recordContentDigest;

    const closed = await service.closeReportingPeriod(context, closeInput());

    expect(closed.status).toBe("CLOSED");
    expect(closed.periodEnd).toEqual(PERIOD_END);
    expect(closed.endingEquity).toBe("11250.00");
    expect(closed.realizedPnl).toBe("800.00");
    expect(closed.unrealizedPnl).toBe("450.00");
    expect(closed.recordContentDigest).not.toBe(openDigest);
    verifyReportingPeriodRecordDigest(closed);

    const audits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.reportingPeriodClosed))
      .all();
    const audit = audits.find((row) => row.entityId === closed.id);
    expect(audit).toBeDefined();
  });

  it("rejects close when no OPEN period exists", async () => {
    const db = getDb();
    const service = createSqliteReportingPeriodLifecycleService(db);
    const context = requireOrgContext(organizationId);

    await expect(service.closeReportingPeriod(context, closeInput())).rejects.toThrow(
      ReportingPeriodNotOpenError,
    );
  });

  it("lists closed periods for the account", async () => {
    const db = getDb();
    const service = createSqliteReportingPeriodLifecycleService(db);
    const context = requireOrgContext(organizationId);

    const closed = await service.listClosedPeriods(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
    });

    expect(closed).toHaveLength(1);
    expect(closed[0]?.status).toBe("CLOSED");
  });

  it("rejects illegal transition from CLOSED to CLOSED", () => {
    expect(() => assertAllowedReportingPeriodTransition("CLOSED", "CLOSED")).toThrow(
      ReportingPeriodInvalidTransitionError,
    );
  });

  it("changes digest when ending equity changes", () => {
    const base = {
      organizationId,
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      startingEquity: "10000.00",
      endingEquity: "11250.00",
      openPositionsSnapshotRef: "paper-positions:2026-06-01T00:05:00.000Z",
      realizedPnl: "800.00",
      unrealizedPnl: "450.00",
      netDeposits: "0",
      netWithdrawals: "0",
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt: STARTING_SNAPSHOT_AT,
      endingSnapshotAt: ENDING_SNAPSHOT_AT,
      status: "CLOSED" as const,
    };

    const digestA = computeReportingPeriodRecordDigest(base);
    const digestB = computeReportingPeriodRecordDigest({
      ...base,
      endingEquity: "11251.00",
    });

    expect(digestA).not.toBe(digestB);
  });

  it("rejects tampered persisted digest on read", async () => {
    const db = getDb();
    const service = createSqliteReportingPeriodLifecycleService(db);
    const context = requireOrgContext(organizationId);

    await service.openReportingPeriod(context, {
      ...openInput(),
      exchangeAccountId: "htx-paper-306-tamper",
    });

    const open = await service.findOpenPeriod(context, "htx-paper-306-tamper");
    expect(open).not.toBeNull();

    db.update(traderReportingPeriods)
      .set({ recordContentDigest: "deadbeef" })
      .where(eq(traderReportingPeriods.id, open!.id))
      .run();

    await expect(service.getReportingPeriodById(context, open!.id)).rejects.toThrow(
      ReportingPeriodDigestMismatchError,
    );
  });
});
