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
import {
  NAKED_REALIZED_PNL_REFUSED,
  billingPeriodReportingScopeIdV2,
  buildClosedTradeSettlementV2,
  buildRealizedStrategyProfitReceiptV2,
  type ClosedTradeSettlementV2,
} from "@/lib/trader/billing/v2";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { billingV2PeriodCloseEvidence } from "@/tests/helpers/billing-v2-period-close-evidence";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000310o";
const EXCHANGE_ACCOUNT_ID = "htx-spot-1-drill";
const HEX = {
  frontier: "1".repeat(64),
  open: "a".repeat(64),
  close: "b".repeat(64),
};

function profitEvidence(input: {
  organizationId: string;
  accountId: string;
  amount: string;
  lifecycleId: string;
  cashDigest: string;
  periodStart: Date;
  periodEnd: Date;
}): {
  settlement: ClosedTradeSettlementV2;
  receipt: ReturnType<typeof buildRealizedStrategyProfitReceiptV2>;
} {
  const settlement = buildClosedTradeSettlementV2({
    organizationId: input.organizationId,
    accountId: input.accountId,
    strategyId: "strat-638-period-close",
    symbol: "BTCUSDT",
    lifecycleId: input.lifecycleId,
    lifecycleState: "FULLY_CLOSED",
    remainingQuantity: "0",
    realityFrontierDigestHex: HEX.frontier,
    openingFillTruthRecordDigests: [HEX.open],
    closingFillTruthRecordDigests: [HEX.close],
    partialFillTruthRecordDigests: [],
    cashflowFacts: [
      {
        truthRecordDigestHex: input.cashDigest,
        amount: input.amount,
        cause: "STRATEGY_REALIZED",
      },
    ],
    costFacts: [],
    supersedesSettlementDigestHex: null,
  });
  const receipt = buildRealizedStrategyProfitReceiptV2({
    organizationId: input.organizationId,
    accountId: input.accountId,
    strategyId: "strat-638-period-close",
    reportingScopeId: billingPeriodReportingScopeIdV2({
      organizationId: input.organizationId,
      accountId: input.accountId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    }),
    realityFrontierDigestHex: HEX.frontier,
    settlements: [settlement],
  });
  return { settlement, receipt };
}

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

  it("close-and-materialize returns billable DRAFT prefixes from a realized-profit receipt", async () => {
    const db = getDb();
    const orchestrator = createSqliteBillingPeriodCloseOrchestrator(db);
    const context = requireOrgContext(organizationId);
    const periodStart = new Date("2026-05-01T00:00:00.000Z");
    const periodEnd = new Date("2026-05-31T23:59:59.000Z");
    const { settlement, receipt } = profitEvidence({
      organizationId,
      accountId: EXCHANGE_ACCOUNT_ID,
      amount: "100.00",
      lifecycleId: "lc-close-100",
      cashDigest: "c".repeat(64),
      periodStart,
      periodEnd,
    });

    const result = await orchestrator.closeAndMaterialize(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      periodStart,
      periodEnd,
      startingEquity: "10000.00",
      endingEquity: "10100.00",
      startingSnapshotAt: new Date("2026-05-01T00:05:00.000Z"),
      endingSnapshotAt: new Date("2026-05-31T23:55:00.000Z"),
      openPositionsSnapshotRef: "admin-drill:positions",
      valuationSource: "admin.attested_close.v1",
      realizedStrategyProfitReceipt: receipt,
      closedTradeSettlements: [settlement],
      unrealizedPnl: "0",
    });

    expect(result.reportingPeriodIdPrefix).toHaveLength(8);
    expect(result.invoiceIdPrefix).toHaveLength(8);
    expect(result.invoiceStatus).toBe("DRAFT");
    expect(result.billable).toBe(true);
    expect(result.realizedStrategyProfitReceiptDigestHex).toBe(receipt.contentDigestHex);
    expect(result.auditActions).toContain(traderAuditActions.reportingPeriodClosed);
    expect(result.auditActions).toContain(traderAuditActions.invoiceDraftGenerated);
    expect(result.auditActions).toContain(traderAuditActions.hwmBootstrapped);
  });

  it("refuses a naked realizedPnl before any HWM write", async () => {
    const db = getDb();
    const orchestrator = createSqliteBillingPeriodCloseOrchestrator(db);
    const hwm = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);
    const accountId = `${EXCHANGE_ACCOUNT_ID}-naked`;

    await expect(
      orchestrator.closeAndMaterialize(context, {
        exchangeAccountId: accountId,
        periodStart: new Date("2026-06-01T00:00:00.000Z"),
        periodEnd: new Date("2026-06-30T23:59:59.000Z"),
        startingEquity: "10000.00",
        endingEquity: "10100.00",
        startingSnapshotAt: new Date("2026-06-01T00:05:00.000Z"),
        endingSnapshotAt: new Date("2026-06-30T23:55:00.000Z"),
        openPositionsSnapshotRef: "naked:positions",
        valuationSource: "admin.attested_close.v1",
        realizedPnl: "100.00",
        unrealizedPnl: "0",
      } as never),
    ).rejects.toMatchObject({
      code: NAKED_REALIZED_PNL_REFUSED,
      name: NAKED_REALIZED_PNL_REFUSED,
    });

    expect(await hwm.getCurrentHwm(context, accountId)).toBeNull();
  });

  it("refuses a receipt whose reporting scope is not this period", async () => {
    const db = getDb();
    const orchestrator = createSqliteBillingPeriodCloseOrchestrator(db);
    const hwm = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);
    const accountId = `${EXCHANGE_ACCOUNT_ID}-scope`;
    const { settlement, receipt } = profitEvidence({
      organizationId,
      accountId,
      amount: "100.00",
      lifecycleId: "lc-scope",
      cashDigest: "e".repeat(64),
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-01-31T23:59:59.000Z"),
    });

    await expect(
      orchestrator.closeAndMaterialize(context, {
        exchangeAccountId: accountId,
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T23:59:59.000Z"),
        startingEquity: "10000.00",
        endingEquity: "10100.00",
        startingSnapshotAt: new Date("2026-07-01T00:05:00.000Z"),
        endingSnapshotAt: new Date("2026-07-31T23:55:00.000Z"),
        openPositionsSnapshotRef: "scope:positions",
        valuationSource: "admin.attested_close.v1",
        realizedStrategyProfitReceipt: receipt,
        closedTradeSettlements: [settlement],
        unrealizedPnl: "0",
      }),
    ).rejects.toMatchObject({ code: "RECEIPT_REPORTING_SCOPE_MISMATCH" });

    expect(await hwm.getCurrentHwm(context, accountId)).toBeNull();
  });

  it("refuses replaying the same period window after a receipt-backed close", async () => {
    const db = getDb();
    const orchestrator = createSqliteBillingPeriodCloseOrchestrator(db);
    const context = requireOrgContext(organizationId);
    const accountId = `${EXCHANGE_ACCOUNT_ID}-dup`;
    const periodStart = new Date("2026-08-01T00:00:00.000Z");
    const periodEnd = new Date("2026-08-31T23:59:59.000Z");
    const first = profitEvidence({
      organizationId,
      accountId,
      amount: "100.00",
      lifecycleId: "lc-dup-1",
      cashDigest: "2".repeat(64),
      periodStart,
      periodEnd,
    });

    await orchestrator.closeAndMaterialize(context, {
      exchangeAccountId: accountId,
      periodStart,
      periodEnd,
      startingEquity: "10000.00",
      endingEquity: "10100.00",
      startingSnapshotAt: new Date("2026-08-01T00:05:00.000Z"),
      endingSnapshotAt: new Date("2026-08-31T23:55:00.000Z"),
      openPositionsSnapshotRef: "dup:positions",
      valuationSource: "admin.attested_close.v1",
      realizedStrategyProfitReceipt: first.receipt,
      closedTradeSettlements: [first.settlement],
      unrealizedPnl: "0",
    });

    const replay = profitEvidence({
      organizationId,
      accountId,
      amount: "100.00",
      lifecycleId: "lc-dup-2",
      cashDigest: "3".repeat(64),
      periodStart,
      periodEnd: new Date("2026-08-31T23:59:58.000Z"),
    });

    await expect(
      orchestrator.closeAndMaterialize(context, {
        exchangeAccountId: accountId,
        periodStart,
        periodEnd: new Date("2026-08-31T23:59:58.000Z"),
        startingEquity: "10000.00",
        endingEquity: "10200.00",
        startingSnapshotAt: new Date("2026-08-01T00:05:00.000Z"),
        endingSnapshotAt: new Date("2026-08-31T23:55:00.000Z"),
        openPositionsSnapshotRef: "dup:positions",
        valuationSource: "admin.attested_close.v1",
        realizedStrategyProfitReceipt: replay.receipt,
        closedTradeSettlements: [replay.settlement],
        unrealizedPnl: "0",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_BILLING_PERIOD_SCOPE" });
  });

  it("refuses writing a later-start receipt into an already-open earlier period", async () => {
    const db = getDb();
    const lifecycle = createReportingPeriodLifecycleService({
      repository: createSqliteReportingPeriodRepository(db),
      writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
    });
    const orchestrator = createSqliteBillingPeriodCloseOrchestrator(db);
    const hwm = createSqliteHwmLedgerService(db);
    const context = requireOrgContext(organizationId);
    const accountId = `${EXCHANGE_ACCOUNT_ID}-open-start`;
    const claimedStart = new Date("2026-09-01T00:00:00.000Z");
    const claimedEnd = new Date("2026-09-30T23:59:59.000Z");
    const { settlement, receipt } = profitEvidence({
      organizationId,
      accountId,
      amount: "500.00",
      lifecycleId: "lc-open-start",
      cashDigest: "4".repeat(64),
      periodStart: claimedStart,
      periodEnd: claimedEnd,
    });

    await lifecycle.openReportingPeriod(context, {
      exchangeAccountId: accountId,
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      startingEquity: "5000.00",
      openPositionsSnapshotRef: "open-start:positions",
      valuationSource: "admin.attested_close.v1",
      startingSnapshotAt: new Date("2026-01-01T00:05:00.000Z"),
    });

    await expect(
      orchestrator.closeAndMaterialize(context, {
        exchangeAccountId: accountId,
        periodStart: claimedStart,
        periodEnd: claimedEnd,
        startingEquity: "5000.00",
        endingEquity: "5500.00",
        startingSnapshotAt: new Date("2026-09-01T00:05:00.000Z"),
        endingSnapshotAt: new Date("2026-09-30T23:55:00.000Z"),
        openPositionsSnapshotRef: "open-start:positions",
        valuationSource: "admin.attested_close.v1",
        realizedStrategyProfitReceipt: receipt,
        closedTradeSettlements: [settlement],
        unrealizedPnl: "0",
      }),
    ).rejects.toMatchObject({ code: "PERIOD_START_MISMATCH" });

    expect(await hwm.getCurrentHwm(context, accountId)).toBeNull();
  });

  it("materialize-draft does not treat a minted receipt as authority for a legacy close", async () => {
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
      ...billingV2PeriodCloseEvidence({
        organizationId,
        accountId,
        periodStart: new Date("2026-04-01T00:00:00.000Z"),
        periodEnd: new Date("2026-04-30T23:59:59.000Z"),
        realizedPnl: "50.00",
        unrealizedPnl: "0",
        endingEquity: "5100.00",
        endingSnapshotAt: new Date("2026-04-30T23:55:00.000Z"),
      }),
    });

    const result = await orchestrator.materializeDraft(context, {
      exchangeAccountId: accountId,
      periodId: closed.id,
    });

    expect(result.invoiceStatus).toBe("DRAFT");
    expect(result.billable).toBe(true);
    expect(result.realizedStrategyProfitReceiptDigestHex).toBeNull();
    expect(result.auditActions).toContain(traderAuditActions.invoiceDraftGenerated);

    const draftAudits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.invoiceDraftGenerated))
      .all();
    expect(draftAudits.length).toBeGreaterThanOrEqual(1);
  });
});
