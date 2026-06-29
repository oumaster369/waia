import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderInvoices } from "@/db/schema";
import {
  createSqliteDraftInvoiceService,
  createSqliteHwmLedgerService,
  createSqliteReportingPeriodLifecycleService,
} from "@/lib/trader/billing";
import { listInvoicesByAccountSqlite } from "@/lib/trader/billing/invoice-repository-adapters";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000310h";
const EXCHANGE_ACCOUNT_ID = "htx-paper-310-hook";

describe("reporting period close draft hook (AT-E11 S5 runtime)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-rp-draft-hook-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "rp-draft-hook.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "rp-draft-hook@waia.invalid",
      password: "password123",
      identityLabel: "RP Draft Hook User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "RP Draft Hook User",
    });
  });

  async function bootstrapZeroHwm() {
    const db = getDb();
    const hwmService = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const existing = await hwmService.getCurrentHwm(context, EXCHANGE_ACCOUNT_ID);
    if (existing) {
      return;
    }

    await hwmService.bootstrapHwm(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      initialHwm: "0",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  }

  async function openAndClosePeriod(realizedPnl: string) {
    const db = getDb();
    const lifecycle = createSqliteReportingPeriodLifecycleService(db);
    const context = requireOrgContext(organizationId);
    const suffix = crypto.randomUUID().slice(0, 8);

    await lifecycle.openReportingPeriod(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      startingEquity: "10000.00",
      openPositionsSnapshotRef: `paper-positions:${suffix}`,
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt: new Date("2026-03-01T00:05:00.000Z"),
    });

    return lifecycle.closeReportingPeriod(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      periodEnd: new Date("2026-03-28T23:59:59.000Z"),
      endingEquity: "10100.00",
      endingSnapshotAt: new Date("2026-03-28T23:55:00.000Z"),
      realizedPnl,
      unrealizedPnl: "0",
    });
  }

  it("creates DRAFT and trader.invoice.draft_generated on billable period close", async () => {
    const db = getDb();
    await bootstrapZeroHwm();

    const closed = await openAndClosePeriod("100.00");
    const context = requireOrgContext(organizationId);

    const invoices = listInvoicesByAccountSqlite(db, context, EXCHANGE_ACCOUNT_ID);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.status).toBe("DRAFT");
    expect(invoices[0]?.billable).toBe(true);
    expect(invoices[0]?.reportingPeriodId).toBe(closed.id);

    const draftAudits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.invoiceDraftGenerated))
      .all();
    expect(draftAudits.length).toBeGreaterThanOrEqual(1);
  });

  it("creates no invoice on non-billable period close", async () => {
    const db = getDb();
    await bootstrapZeroHwm();

    const accountId = `${EXCHANGE_ACCOUNT_ID}-non-billable`;
    const hwm = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);
    await hwm.bootstrapHwm(context, {
      exchangeAccountId: accountId,
      initialHwm: "0",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    const lifecycle = createSqliteReportingPeriodLifecycleService(db);
    await lifecycle.openReportingPeriod(context, {
      exchangeAccountId: accountId,
      periodStart: new Date("2026-02-01T00:00:00.000Z"),
      startingEquity: "10000.00",
      openPositionsSnapshotRef: "paper-positions:non-billable",
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt: new Date("2026-02-01T00:05:00.000Z"),
    });
    await lifecycle.closeReportingPeriod(context, {
      exchangeAccountId: accountId,
      periodEnd: new Date("2026-02-28T23:59:59.000Z"),
      endingEquity: "10000.00",
      endingSnapshotAt: new Date("2026-02-28T23:55:00.000Z"),
      realizedPnl: "0",
      unrealizedPnl: "0",
    });

    const invoices = listInvoicesByAccountSqlite(db, context, accountId);
    expect(invoices).toHaveLength(0);
  });

  it("is idempotent when draft generation is invoked again for the same period", async () => {
    const db = getDb();
    await bootstrapZeroHwm();

    const closed = await openAndClosePeriod("120.00");
    const context = requireOrgContext(organizationId);
    const draftService = createSqliteDraftInvoiceService(db);

    const first = listInvoicesByAccountSqlite(db, context, EXCHANGE_ACCOUNT_ID).find(
      (row) => row.reportingPeriodId === closed.id,
    );
    expect(first).toBeDefined();

    const second = await draftService.generateDraftInvoice(context, {
      periodId: closed.id,
      computedAt: closed.periodEnd!,
    });

    expect(second.id).toBe(first!.id);

    const invoiceRows = db.select().from(traderInvoices).all();
    const forPeriod = invoiceRows.filter((row) => row.reportingPeriodId === closed.id);
    expect(forPeriod).toHaveLength(1);
  });
});
