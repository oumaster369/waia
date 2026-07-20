import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  auditLogs,
  traderHwmLedger,
  traderInvoiceCorrections,
  traderInvoiceDisputeEvents,
  traderInvoiceDisputes,
} from "@/db/schema";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { createSqliteHwmLedgerService } from "@/lib/trader/billing/hwm-ledger-service";
import {
  createSqliteBillingGovernanceService,
  verifyInvoiceCorrectionDigest,
  verifyInvoiceDisputeEventDigest,
} from "@/lib/trader/billing/governance";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { insertIssuedInvoiceWithDigest } from "@/tests/helpers/billing-governance-invoice-fixture";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000003215";
const EXCHANGE_ACCOUNT_ID = "htx-billing-governance";
const OPERATOR_ID = "00000000-0000-4000-8000-00000009999";
const BOOTSTRAP_AT = new Date("2026-06-01T00:00:00.000Z");
const ISSUED_AT = new Date("2026-06-15T00:00:00.000Z");
const CORRECTION_AT = new Date("2026-06-28T10:00:00.000Z");

let organizationId: string;
let invoiceId: string;
let reportingPeriodId: string;

describe("billing governance service (sqlite)", () => {
  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-billing-gov-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "billing-gov.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "billing-gov@waia.invalid",
      password: "password123",
      identityLabel: "Billing Governance User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Billing Governance User",
    });
    reportingPeriodId = `period-governance-main`;
    invoiceId = insertIssuedInvoiceWithDigest(db, organizationId, EXCHANGE_ACCOUNT_ID, ISSUED_AT, {
      periodId: reportingPeriodId,
      issuedBy: USER_ID,
    });

    const hwmService = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);
    await hwmService.bootstrapHwm(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      initialHwm: "10000.00",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: BOOTSTRAP_AT,
    });
    await hwmService.recordHwmRatchet(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      newHwm: "10500.00",
      sourcePeriodId: reportingPeriodId,
      sourceInvoiceId: invoiceId,
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: ISSUED_AT,
    });
  });

  it("proves dispute freeze, append-only correction, and HWM rollback", async () => {
    const db = getDb();
    const context = requireOrgContext(organizationId);
    const service = createSqliteBillingGovernanceService(db, {
      writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
    });

    const dispute = await service.openInvoiceDispute(context, {
      invoiceId,
      reason: "Client disputes fee calculation",
      openedBy: OPERATOR_ID,
      now: CORRECTION_AT,
    });
    expect(dispute.status).toBe("OPEN");

    const eventsAfterOpen = db
      .select()
      .from(traderInvoiceDisputeEvents)
      .where(eq(traderInvoiceDisputeEvents.disputeId, dispute.id))
      .all();
    expect(eventsAfterOpen).toHaveLength(1);
    expect(eventsAfterOpen[0]?.eventType).toBe("OPENED");
    verifyInvoiceDisputeEventDigest({
      ...eventsAfterOpen[0]!,
      schemaVersion: eventsAfterOpen[0]!.schemaVersion as "waia.trader.invoice-dispute-event.v1",
    });

    const result = await service.applyOverchargeCorrection(context, {
      invoiceId,
      correctionType: "CREDIT",
      amount: "30.000000",
      restoredHwm: "10000.00",
      reason: "Overcharge remediation per Billing §11.4",
      actorId: OPERATOR_ID,
      now: CORRECTION_AT,
    });

    expect(result.dispute.status).toBe("RESOLVED_CORRECTED");
    expect(result.correction.correctionType).toBe("CREDIT");
    expect(result.correction.amount).toBe("30.000000");
    expect(result.correction.restoredHwm).toBe("10000.00");
    verifyInvoiceCorrectionDigest(result.correction);

    const corrections = db
      .select()
      .from(traderInvoiceCorrections)
      .where(eq(traderInvoiceCorrections.invoiceId, invoiceId))
      .all();
    expect(corrections).toHaveLength(1);

    const hwmEntries = db
      .select()
      .from(traderHwmLedger)
      .where(
        and(
          eq(traderHwmLedger.organizationId, organizationId),
          eq(traderHwmLedger.exchangeAccountId, EXCHANGE_ACCOUNT_ID),
        ),
      )
      .all();
    expect(hwmEntries.some((entry) => entry.entryType === "ROLLBACK")).toBe(true);
    const rollback = hwmEntries.find((entry) => entry.entryType === "ROLLBACK");
    expect(rollback?.highWaterMark).toBe("10000.00");

    const disputeProjection = db
      .select()
      .from(traderInvoiceDisputes)
      .where(eq(traderInvoiceDisputes.id, dispute.id))
      .get();
    expect(disputeProjection?.status).toBe("RESOLVED_CORRECTED");

    const audits = db.select().from(auditLogs).all();
    expect(audits.some((row) => row.action === traderAuditActions.invoiceDisputeOpened)).toBe(true);
    expect(audits.some((row) => row.action === traderAuditActions.invoiceCorrectionApplied)).toBe(
      true,
    );
    expect(
      audits.some((row) => row.action === traderAuditActions.invoiceDisputeResolvedCorrected),
    ).toBe(true);
    expect(audits.some((row) => row.action === traderAuditActions.hwmRolledBack)).toBe(true);
  });

  it("resolves upheld disputes without correction", async () => {
    const db = getDb();
    const context = requireOrgContext(organizationId);
    const service = createSqliteBillingGovernanceService(db);
    const upheldInvoiceId = insertIssuedInvoiceWithDigest(
      db,
      organizationId,
      EXCHANGE_ACCOUNT_ID,
      ISSUED_AT,
      { issuedBy: USER_ID },
    );

    const dispute = await service.openInvoiceDispute(context, {
      invoiceId: upheldInvoiceId,
      reason: "Client questioned fee",
      openedBy: OPERATOR_ID,
    });

    const resolved = await service.resolveInvoiceDisputeUpheld(context, {
      disputeId: dispute.id,
      resolutionReason: "Invoice math verified; dispute upheld",
      actorId: OPERATOR_ID,
    });

    expect(resolved.status).toBe("RESOLVED_UPHELD");
    expect(
      db
        .select()
        .from(traderInvoiceCorrections)
        .where(eq(traderInvoiceCorrections.invoiceId, upheldInvoiceId))
        .all(),
    ).toHaveLength(0);
  });
});
