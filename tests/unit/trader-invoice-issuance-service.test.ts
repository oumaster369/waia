import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs, traderHwmLedger, traderInvoices } from "@/db/schema";
import {
  IssuanceAlreadyIssuedError,
  IssuanceApprovalExpiredError,
  IssuanceAttestationIncompleteError,
  IssuanceCoolingOffNotElapsedError,
  createSqliteDraftInvoiceService,
  createSqliteHwmLedgerService,
  createSqliteInvoiceIssuanceService,
  createSqliteReportingPeriodLifecycleService,
} from "@/lib/trader/billing";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000311";
const OPERATOR_CONTEXT = () => ({ ...requireOrgContext(organizationId), userId: USER_ID });
const EXCHANGE_ACCOUNT_ID = "htx-paper-311-service";
const FIXED_AT = new Date("2026-06-30T12:00:00.000Z");
const COMPLETE_ATTESTATIONS = {
  depositsVerified: true,
  withdrawalsVerified: true,
  balanceSnapshotsVerified: true,
  reconciliationVerified: true,
  exchangeSyncVerified: true,
  realizedFillFinalityVerified: true,
};

let organizationId: string;

describe("invoice issuance service (DEE-311 S6)", () => {
  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-invoice-issuance-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "invoice-issuance.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "invoice-issuance@waia.invalid",
      password: "password123",
      identityLabel: "Invoice Issuance User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Invoice Issuance User",
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
    options: { month: number; realizedPnl: string; unrealizedPnl?: string },
  ) {
    const db = getDb();
    const lifecycle = createSqliteReportingPeriodLifecycleService(db);
    const context = requireOrgContext(organizationId);
    const month = String(options.month).padStart(2, "0");

    await lifecycle.openReportingPeriod(context, {
      exchangeAccountId,
      periodStart: new Date(`2026-${month}-01T00:00:00.000Z`),
      startingEquity: "10000.00",
      openPositionsSnapshotRef: `paper-positions:${month}`,
      valuationSource: "paper_pnl_read_model.v1",
      startingSnapshotAt: new Date(`2026-${month}-01T00:05:00.000Z`),
    });

    return lifecycle.closeReportingPeriod(context, {
      exchangeAccountId,
      periodEnd: new Date(`2026-${month}-28T23:59:59.000Z`),
      endingEquity: "10100.00",
      endingSnapshotAt: new Date(`2026-${month}-28T23:55:00.000Z`),
      realizedPnl: options.realizedPnl,
      unrealizedPnl: options.unrealizedPnl ?? "0",
    });
  }

  async function createDraftInvoice(exchangeAccountId: string, month: number, realizedPnl: string) {
    await bootstrapZeroHwm(exchangeAccountId);
    const closed = await openAndClosePeriod(exchangeAccountId, { month, realizedPnl });
    const draftService = createSqliteDraftInvoiceService(getDb());
    return draftService.generateDraftInvoice(requireOrgContext(organizationId), {
      periodId: closed.id,
      computedAt: FIXED_AT,
      realizedFillFinality: false,
    });
  }

  it("approves issuance without mutating status or HWM", async () => {
    const db = getDb();
    const invoice = await createDraftInvoice("htx-paper-311-approve", 1, "100.00");
    const hwmBefore = db.select().from(traderHwmLedger).all().length;

    const service = createSqliteInvoiceIssuanceService(db, {
      now: () => FIXED_AT,
    });

    const approved = await service.approveInvoiceIssuance(OPERATOR_CONTEXT(), {
      invoiceId: invoice.id,
      attestations: COMPLETE_ATTESTATIONS,
      coolingOffMs: 60_000,
      approvedAt: FIXED_AT,
    });

    expect(approved.status).toBe("DRAFT");
    expect(approved.issuanceApprovedBy).toBe(USER_ID);
    expect(approved.coolingOffUntil?.toISOString()).toBe(
      new Date(FIXED_AT.getTime() + 60_000).toISOString(),
    );
    expect(db.select().from(traderHwmLedger).all().length).toBe(hwmBefore);

    const approvalAudits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.invoiceIssuanceApproved))
      .all();
    expect(approvalAudits.length).toBe(1);
    expect(approvalAudits[0]?.entityId).toBe(invoice.id);
  });

  it("rejects approval when attestations are incomplete", async () => {
    const db = getDb();
    const invoice = await createDraftInvoice("htx-paper-311-attest", 2, "100.00");
    const service = createSqliteInvoiceIssuanceService(db, { now: () => FIXED_AT });

    await expect(
      service.approveInvoiceIssuance(OPERATOR_CONTEXT(), {
        invoiceId: invoice.id,
        attestations: { ...COMPLETE_ATTESTATIONS, depositsVerified: false },
      }),
    ).rejects.toBeInstanceOf(IssuanceAttestationIncompleteError);
  });

  it("blocks issuance before cooling-off elapses", async () => {
    const db = getDb();
    const invoice = await createDraftInvoice("htx-paper-311-cooling", 3, "100.00");
    const approvedAt = FIXED_AT;
    const service = createSqliteInvoiceIssuanceService(db, {
      now: () => new Date(approvedAt.getTime() + 30_000),
    });

    await service.approveInvoiceIssuance(OPERATOR_CONTEXT(), {
      invoiceId: invoice.id,
      attestations: COMPLETE_ATTESTATIONS,
      coolingOffMs: 60_000,
      approvedAt,
    });

    await expect(
      service.issueInvoice(OPERATOR_CONTEXT(), { invoiceId: invoice.id }),
    ).rejects.toBeInstanceOf(IssuanceCoolingOffNotElapsedError);
  });

  it("issues exactly once with HWM ratchet and audit after cooling-off", async () => {
    const db = getDb();
    const invoice = await createDraftInvoice("htx-paper-311-issue", 4, "100.00");
    const approvedAt = FIXED_AT;
    const issueAt = new Date(approvedAt.getTime() + 120_000);
    const service = createSqliteInvoiceIssuanceService(db, {
      now: () => issueAt,
    });

    await service.approveInvoiceIssuance(OPERATOR_CONTEXT(), {
      invoiceId: invoice.id,
      attestations: COMPLETE_ATTESTATIONS,
      coolingOffMs: 60_000,
      approvedAt,
    });

    const issued = await service.issueInvoice(OPERATOR_CONTEXT(), { invoiceId: invoice.id });

    expect(issued.status).toBe("ISSUED");
    expect(issued.issuedBy).toBe(USER_ID);
    expect(issued.proposedNewHighWaterMark).toBe("100");

    const ratchets = db
      .select()
      .from(traderHwmLedger)
      .where(eq(traderHwmLedger.sourceInvoiceId, invoice.id))
      .all();
    expect(ratchets.length).toBe(1);
    expect(ratchets[0]?.entryType).toBe("RATCHET_UP");
    expect(ratchets[0]?.highWaterMark).toBe("100");

    const issuedAudits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.invoiceIssued))
      .all();
    expect(issuedAudits.length).toBe(1);
    expect(issuedAudits[0]?.entityId).toBe(invoice.id);
  });

  it("is idempotent when re-issuing an already ISSUED invoice", async () => {
    const db = getDb();
    const invoice = await createDraftInvoice("htx-paper-311-idempotent", 5, "88.00");
    const approvedAt = FIXED_AT;
    const issueAt = new Date(approvedAt.getTime() + 120_000);
    const service = createSqliteInvoiceIssuanceService(db, {
      now: () => issueAt,
    });

    await service.approveInvoiceIssuance(OPERATOR_CONTEXT(), {
      invoiceId: invoice.id,
      attestations: COMPLETE_ATTESTATIONS,
      coolingOffMs: 0,
      approvedAt,
    });

    const first = await service.issueInvoice(OPERATOR_CONTEXT(), { invoiceId: invoice.id });
    const ratchetCountAfterFirst = db
      .select()
      .from(traderHwmLedger)
      .where(eq(traderHwmLedger.sourceInvoiceId, invoice.id))
      .all().length;
    const issuedAuditCountAfterFirst = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.invoiceIssued))
      .all().length;

    const second = await service.issueInvoice(OPERATOR_CONTEXT(), { invoiceId: invoice.id });

    expect(second.id).toBe(first.id);
    expect(
      db.select().from(traderHwmLedger).where(eq(traderHwmLedger.sourceInvoiceId, invoice.id)).all()
        .length,
    ).toBe(ratchetCountAfterFirst);
    expect(
      db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, traderAuditActions.invoiceIssued))
        .all().length,
    ).toBe(issuedAuditCountAfterFirst);
  });

  it("clears pending approval during cooling-off and requires re-approval", async () => {
    const db = getDb();
    const invoice = await createDraftInvoice("htx-paper-311-cancel", 6, "100.00");
    const approvedAt = FIXED_AT;
    const service = createSqliteInvoiceIssuanceService(db, {
      now: () => new Date(approvedAt.getTime() + 30_000),
    });

    await service.approveInvoiceIssuance(OPERATOR_CONTEXT(), {
      invoiceId: invoice.id,
      attestations: COMPLETE_ATTESTATIONS,
      coolingOffMs: 60_000,
      approvedAt,
    });

    const cleared = await service.cancelPendingIssuance(OPERATOR_CONTEXT(), {
      invoiceId: invoice.id,
      reason: "operator reconsidered",
    });

    expect(cleared.status).toBe("DRAFT");
    expect(cleared.coolingOffUntil).toBeNull();

    const cancelAudits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.invoiceIssuanceCancelled))
      .all();
    expect(cancelAudits.length).toBe(1);

    await expect(
      service.issueInvoice(OPERATOR_CONTEXT(), { invoiceId: invoice.id }),
    ).rejects.toMatchObject({ code: "ISSUANCE_APPROVAL_REQUIRED" });
  });

  it("rejects issuance after approval expires", async () => {
    const db = getDb();
    const invoice = await createDraftInvoice("htx-paper-311-expired", 7, "100.00");
    const approvedAt = FIXED_AT;
    const expiredAt = new Date(approvedAt.getTime() + 86_400_001);
    const service = createSqliteInvoiceIssuanceService(db, {
      now: () => expiredAt,
    });

    await service.approveInvoiceIssuance(OPERATOR_CONTEXT(), {
      invoiceId: invoice.id,
      attestations: COMPLETE_ATTESTATIONS,
      coolingOffMs: 0,
      approvedAt,
    });

    await expect(
      service.issueInvoice(OPERATOR_CONTEXT(), { invoiceId: invoice.id }),
    ).rejects.toBeInstanceOf(IssuanceApprovalExpiredError);
  });

  it("fails closed on digest drift and clears stale approval", async () => {
    const db = getDb();
    const invoice = await createDraftInvoice("htx-paper-311-drift", 8, "100.00");
    const approvedAt = FIXED_AT;
    const issueAt = new Date(approvedAt.getTime() + 120_000);
    const service = createSqliteInvoiceIssuanceService(db, {
      now: () => issueAt,
    });

    await service.approveInvoiceIssuance(OPERATOR_CONTEXT(), {
      invoiceId: invoice.id,
      attestations: COMPLETE_ATTESTATIONS,
      coolingOffMs: 60_000,
      approvedAt,
    });

    db.update(traderInvoices)
      .set({ performanceFee: "999.00" })
      .where(eq(traderInvoices.id, invoice.id))
      .run();

    await expect(
      service.issueInvoice(OPERATOR_CONTEXT(), { invoiceId: invoice.id }),
    ).rejects.toMatchObject({ code: "INVOICE_RECORD_DIGEST_MISMATCH" });

    const row = db.select().from(traderInvoices).where(eq(traderInvoices.id, invoice.id)).all()[0];
    expect(row?.status).toBe("DRAFT");
    expect(row?.coolingOffUntil).toBeNull();
    expect(
      db.select().from(traderHwmLedger).where(eq(traderHwmLedger.sourceInvoiceId, invoice.id)).all()
        .length,
    ).toBe(0);
  });

  it("rejects cancel after issuance", async () => {
    const db = getDb();
    const invoice = await createDraftInvoice("htx-paper-311-no-cancel", 9, "100.00");
    const approvedAt = FIXED_AT;
    const issueAt = new Date(approvedAt.getTime() + 120_000);
    const service = createSqliteInvoiceIssuanceService(db, {
      now: () => issueAt,
    });

    await service.approveInvoiceIssuance(OPERATOR_CONTEXT(), {
      invoiceId: invoice.id,
      attestations: COMPLETE_ATTESTATIONS,
      coolingOffMs: 0,
      approvedAt,
    });
    await service.issueInvoice(OPERATOR_CONTEXT(), { invoiceId: invoice.id });

    await expect(
      service.cancelPendingIssuance(OPERATOR_CONTEXT(), {
        invoiceId: invoice.id,
        reason: "too late",
      }),
    ).rejects.toBeInstanceOf(IssuanceAlreadyIssuedError);
  });
});
