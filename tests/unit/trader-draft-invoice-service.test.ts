import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderHwmLedger, traderInvoices, traderReportingPeriods } from "@/db/schema";
import {
  DraftInvoiceNotBillableError,
  createReportingPeriodLifecycleService,
  createSqliteDraftInvoiceService,
  createSqliteHwmLedgerService,
  createSqliteReportingPeriodRepository,
} from "@/lib/trader/billing";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { listInvoicesByAccountSqlite } from "@/lib/trader/billing/invoice-repository-adapters";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000310";
const EXCHANGE_ACCOUNT_ID = "htx-paper-310-service";
const FIXED_AT = new Date("2026-06-30T12:00:00.000Z");

describe("draft invoice service (DEE-310 S5)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-draft-invoice-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "draft-invoice.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "draft-invoice@waia.invalid",
      password: "password123",
      identityLabel: "Draft Invoice User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Draft Invoice User",
    });
  });

  async function bootstrapZeroHwm(exchangeAccountId = EXCHANGE_ACCOUNT_ID) {
    const db = getDb();
    const hwmService = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);

    const existing = await hwmService.getCurrentHwm(context, exchangeAccountId);
    if (existing) {
      return;
    }

    await hwmService.bootstrapHwm(context, {
      exchangeAccountId,
      initialHwm: "0",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  }

  async function openAndClosePeriod(
    exchangeAccountId: string,
    options: {
      month: number;
      realizedPnl: string;
      unrealizedPnl?: string;
    },
  ) {
    const db = getDb();
    const lifecycle = createReportingPeriodLifecycleService({
      repository: createSqliteReportingPeriodRepository(db),
      writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
    });
    const context = requireOrgContext(organizationId);

    const month = String(options.month).padStart(2, "0");
    const periodStart = new Date(`2026-${month}-01T00:00:00.000Z`);
    const periodEnd = new Date(`2026-${month}-28T23:59:59.000Z`);

    await lifecycle.openReportingPeriod(context, {
      exchangeAccountId,
      periodStart,
      startingEquity: "10000.00",
      openPositionsSnapshotRef: `paper-positions:${periodStart.toISOString()}`,
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt: new Date(`2026-${month}-01T00:05:00.000Z`),
    });

    return lifecycle.closeReportingPeriod(context, {
      exchangeAccountId,
      periodEnd,
      endingEquity: "10100.00",
      endingSnapshotAt: new Date(`2026-${month}-28T23:55:00.000Z`),
      realizedPnl: options.realizedPnl,
      unrealizedPnl: options.unrealizedPnl ?? "0",
    });
  }

  it("persists one DRAFT invoice with full snapshot and digests for a billable period", async () => {
    const db = getDb();
    await bootstrapZeroHwm();

    const closed = await openAndClosePeriod(EXCHANGE_ACCOUNT_ID, {
      month: 1,
      realizedPnl: "100.00",
      unrealizedPnl: "-20.00",
    });

    const service = createSqliteDraftInvoiceService(db);
    const context = requireOrgContext(organizationId);

    const invoice = await service.generateDraftInvoice(context, {
      periodId: closed.id,
      computedAt: FIXED_AT,
      realizedFillFinality: false,
    });

    expect(invoice.status).toBe("DRAFT");
    expect(invoice.currency).toBe("USD");
    expect(invoice.reportingPeriodId).toBe(closed.id);
    expect(invoice.periodRealizedStrategyProfit).toBe("100.00");
    expect(invoice.performanceFee).toBe("30");
    expect(invoice.unrealizedPnl).toBe("-20.00");
    expect(invoice.startingEquity).toBe("10000.00");
    expect(invoice.endingEquity).toBe("10100.00");
    expect(invoice.feeArtifactDigest).toHaveLength(64);
    expect(invoice.recordContentDigest).toHaveLength(64);
    expect(invoice.schemaVersion).toBe("waia.trader.invoice.v1");

    const auditRows = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.invoiceDraftGenerated))
      .all();
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]?.entityId).toBe(invoice.id);
  });

  it("returns existing invoice on idempotent replay without duplicate rows or audit", async () => {
    const db = getDb();
    await bootstrapZeroHwm("htx-paper-310-idempotent");

    const closed = await openAndClosePeriod("htx-paper-310-idempotent", {
      month: 2,
      realizedPnl: "88.00",
    });

    const service = createSqliteDraftInvoiceService(db);
    const context = requireOrgContext(organizationId);
    const input = { periodId: closed.id, computedAt: FIXED_AT };

    const first = await service.generateDraftInvoice(context, input);
    const auditCountAfterFirst = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.invoiceDraftGenerated))
      .all().length;

    const second = await service.generateDraftInvoice(context, input);

    expect(second.id).toBe(first.id);
    expect(second.recordContentDigest).toBe(first.recordContentDigest);
    expect(listInvoicesByAccountSqlite(db, context, "htx-paper-310-idempotent").length).toBe(1);

    const auditCountAfterSecond = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.invoiceDraftGenerated))
      .all().length;
    expect(auditCountAfterSecond).toBe(auditCountAfterFirst);
  });

  it("fails closed for non-billable periods without persisting an invoice", async () => {
    const db = getDb();
    await bootstrapZeroHwm("htx-paper-310-nonbillable");

    const closed = await openAndClosePeriod("htx-paper-310-nonbillable", {
      month: 3,
      realizedPnl: "10.00",
    });

    const service = createSqliteDraftInvoiceService(db);
    const context = requireOrgContext(organizationId);

    await expect(
      service.generateDraftInvoice(context, { periodId: closed.id, computedAt: FIXED_AT }),
    ).rejects.toBeInstanceOf(DraftInvoiceNotBillableError);

    expect(listInvoicesByAccountSqlite(db, context, "htx-paper-310-nonbillable").length).toBe(0);
  });

  it("does not mutate reporting periods or HWM ledger during generation", async () => {
    const db = getDb();
    await bootstrapZeroHwm("htx-paper-310-side-effects");

    const closed = await openAndClosePeriod("htx-paper-310-side-effects", {
      month: 4,
      realizedPnl: "120.00",
    });

    const periodCountBefore = db.select().from(traderReportingPeriods).all().length;
    const hwmCountBefore = db.select().from(traderHwmLedger).all().length;

    const service = createSqliteDraftInvoiceService(db);
    const context = requireOrgContext(organizationId);

    await service.generateDraftInvoice(context, { periodId: closed.id, computedAt: FIXED_AT });

    expect(db.select().from(traderReportingPeriods).all().length).toBe(periodCountBefore);
    expect(db.select().from(traderHwmLedger).all().length).toBe(hwmCountBefore);
    expect(db.select().from(traderInvoices).all().length).toBeGreaterThan(0);
  });

  it("exposes getDraftInvoiceByPeriod for read access", async () => {
    const db = getDb();
    await bootstrapZeroHwm("htx-paper-310-read");

    const closed = await openAndClosePeriod("htx-paper-310-read", {
      month: 5,
      realizedPnl: "150.00",
    });

    const service = createSqliteDraftInvoiceService(db);
    const context = requireOrgContext(organizationId);

    const generated = await service.generateDraftInvoice(context, {
      periodId: closed.id,
      computedAt: FIXED_AT,
    });

    const fetched = await service.getDraftInvoiceByPeriod(context, "htx-paper-310-read", closed.id);

    expect(fetched?.id).toBe(generated.id);
  });
});
