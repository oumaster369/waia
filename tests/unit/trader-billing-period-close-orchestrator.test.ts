import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs } from "@/db/schema";
import {
  createSqliteBillingPeriodCloseOrchestrator,
  createSqliteHwmLedgerService,
  createReportingPeriodLifecycleService,
  createSqliteReportingPeriodRepository,
} from "@/lib/trader/billing";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000310o";
const EXCHANGE_ACCOUNT_ID = "htx-spot-1-drill";

describe("billing period close orchestrator (BP-10 L2 unblock)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-billing-orch-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "billing-orch.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "billing-orch@waia.invalid",
      password: "password123",
      identityLabel: "Billing Orch User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Billing Orch User",
    });
  });

  it("close-and-materialize returns billable DRAFT prefixes and audit action names", async () => {
    const db = getDb();
    const orchestrator = createSqliteBillingPeriodCloseOrchestrator(db);
    const context = requireOrgContext(organizationId);

    const result = await orchestrator.closeAndMaterialize(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      periodEnd: new Date("2026-05-31T23:59:59.000Z"),
      startingEquity: "10000.00",
      endingEquity: "10100.00",
      startingSnapshotAt: new Date("2026-05-01T00:05:00.000Z"),
      endingSnapshotAt: new Date("2026-05-31T23:55:00.000Z"),
      openPositionsSnapshotRef: "admin-drill:positions",
      valuationSource: "admin.attested_close.v1",
      realizedPnl: "100.00",
      unrealizedPnl: "0",
    });

    expect(result.reportingPeriodIdPrefix).toHaveLength(8);
    expect(result.invoiceIdPrefix).toHaveLength(8);
    expect(result.invoiceStatus).toBe("DRAFT");
    expect(result.billable).toBe(true);
    expect(result.auditActions).toContain(traderAuditActions.reportingPeriodClosed);
    expect(result.auditActions).toContain(traderAuditActions.invoiceDraftGenerated);
    expect(result.auditActions).toContain(traderAuditActions.hwmBootstrapped);
  });

  it("materialize-draft creates draft for an orphan CLOSED period", async () => {
    const db = getDb();
    const lifecycle = createReportingPeriodLifecycleService({
      repository: createSqliteReportingPeriodRepository(db),
      writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
    });
    const orchestrator = createSqliteBillingPeriodCloseOrchestrator(db);
    const context = requireOrgContext(organizationId);
    const accountId = `${EXCHANGE_ACCOUNT_ID}-orphan`;

    const hwm = createSqliteHwmLedgerService(db);
    await hwm.bootstrapHwm(context, {
      exchangeAccountId: accountId,
      initialHwm: "0",
      valuationSource: "admin.attested_close.v1",
      effectiveAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    await lifecycle.openReportingPeriod(context, {
      exchangeAccountId: accountId,
      periodStart: new Date("2026-04-01T00:00:00.000Z"),
      startingEquity: "5000.00",
      openPositionsSnapshotRef: "orphan:positions",
      valuationSource: "admin.attested_close.v1",
      startingSnapshotAt: new Date("2026-04-01T00:05:00.000Z"),
    });

    const closed = await lifecycle.closeReportingPeriod(context, {
      exchangeAccountId: accountId,
      periodEnd: new Date("2026-04-30T23:59:59.000Z"),
      endingEquity: "5100.00",
      endingSnapshotAt: new Date("2026-04-30T23:55:00.000Z"),
      realizedPnl: "50.00",
      unrealizedPnl: "0",
    });

    const result = await orchestrator.materializeDraft(context, {
      exchangeAccountId: accountId,
      periodId: closed.id,
    });

    expect(result.invoiceStatus).toBe("DRAFT");
    expect(result.billable).toBe(true);
    expect(result.auditActions).toContain(traderAuditActions.invoiceDraftGenerated);

    const draftAudits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.invoiceDraftGenerated))
      .all();
    expect(draftAudits.length).toBeGreaterThanOrEqual(1);
  });
});
