import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  auditLogs,
  traderAccountStatus,
  traderAccountStatusEvents,
  traderInvoices,
} from "@/db/schema";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { createSqlitePaymentAddressService } from "@/lib/waia-core/payment-addresses";
import { createSqlitePaymentService } from "@/lib/waia-core/payments";
import { buildSettlementEvidence } from "@/lib/waia-core/payment-watcher/build-settlement-evidence";
import { createSqliteAccountStatusRepository } from "@/lib/trader/settlement/account-status-repository-sqlite";
import { DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS } from "@/lib/trader/settlement/account-status-policy";
import { createSqliteOverdueInvoicesReader } from "@/lib/trader/settlement/overdue-invoices-reader-sqlite";
import { runOverdueSuspensionCycle } from "@/lib/trader/settlement/run-overdue-suspension-cycle";
import { createSqliteSettlementService } from "@/lib/trader/settlement/settlement-service";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000321d";
const EXCHANGE_ACCOUNT_ID = "htx-overdue-lifecycle";
const DEPOSIT_ADDRESS = "TOverdueLifecycleDeposit";
const PERFORMANCE_FEE = "150.000000";
const CYCLE_NOW = new Date("2026-06-27T12:00:00.000Z");
const OVERDUE_ISSUED_AT = new Date(
  CYCLE_NOW.getTime() - DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS - 24 * 60 * 60 * 1000,
);

const TRANSFER = {
  txHash: "overdue-lifecycle-tx",
  transferIndex: 0,
  toAddress: DEPOSIT_ADDRESS,
  fromAddress: "TSenderOverdue",
  contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  amountRaw: "150000000",
  amountDecimal: PERFORMANCE_FEE,
  blockHeight: "200",
  blockTimestamp: new Date("2026-06-27T13:00:00.000Z"),
  confirmationsObserved: 21,
};

let organizationId: string;
let addressId: string;
let overdueInvoiceId: string;

function insertIssuedInvoice(
  db: ReturnType<typeof getDb>,
  orgId: string,
  issuedAt: Date,
  exchangeAccountId = EXCHANGE_ACCOUNT_ID,
) {
  const id = crypto.randomUUID();
  db.insert(traderInvoices)
    .values({
      id,
      organizationId: orgId,
      exchangeAccountId,
      reportingPeriodId: `period-${id.slice(0, 8)}`,
      feeArtifactDigest: "artifact-digest-overdue-test",
      status: "ISSUED",
      currency: "USD",
      periodRealizedStrategyProfit: "500.00",
      cumulativeRealizedStrategyProfit: "500.00",
      previousHighWaterMark: "0",
      newProfitAboveHwm: "500.00",
      feeRate: "0.30",
      performanceFee: PERFORMANCE_FEE,
      proposedNewHighWaterMark: "500.00",
      billable: true,
      unrealizedPnl: "0",
      realizedFillFinality: true,
      startingEquity: "10000.00",
      endingEquity: "10500.00",
      netDeposits: "0",
      netWithdrawals: "0",
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEnd: new Date("2026-06-28T23:59:59.000Z"),
      valuationSource: "paper_pnl_read_model.v1",
      feeComputedAt: issuedAt,
      schemaVersion: "waia.trader.invoice.v1",
      recordContentDigest: "digest-overdue-test",
      issuanceApprovedAt: issuedAt,
      issuanceApprovedBy: USER_ID,
      coolingOffUntil: new Date(issuedAt.getTime() - 24 * 60 * 60 * 1000),
      issuedAt,
      issuedBy: USER_ID,
      settledAmount: "0",
      paidAt: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    })
    .run();
  return id;
}

describe("account status overdue suspension cycle (sqlite)", () => {
  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-overdue-cycle-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "overdue-cycle.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "overdue-cycle@waia.invalid",
      password: "password123",
      identityLabel: "Overdue Cycle User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Overdue Cycle User",
    });

    const addressService = createSqlitePaymentAddressService(db);
    const context = requireOrgContext(organizationId);
    const wallet = await addressService.createWallet(context, {
      walletKind: "DEPOSIT",
      custodyModel: "ORGANIZATION",
      controlModel: "2-of-3",
      status: "active",
    });
    const generated = await addressService.generateAddress(context, {
      walletId: wallet.id,
      network: "TRC-20",
      address: DEPOSIT_ADDRESS,
    });
    await addressService.assignAddress(context, {
      addressId: generated.addressId,
      subjectModule: "trader",
      subjectRef: EXCHANGE_ACCOUNT_ID,
    });
    await addressService.activateAddress(context, { addressId: generated.addressId });
    addressId = generated.addressId;
    overdueInvoiceId = insertIssuedInvoice(db, organizationId, OVERDUE_ISSUED_AT);
  });

  it("proves unpaid → suspended → paid → reactivated lifecycle", async () => {
    const db = getDb();
    const context = requireOrgContext(organizationId);

    const suspensionReport = await runOverdueSuspensionCycle({
      overdueInvoicesReader: createSqliteOverdueInvoicesReader(db),
      accountStatusRepository: createSqliteAccountStatusRepository(db),
      writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
      logger: { log: () => undefined },
      now: () => CYCLE_NOW,
    });

    expect(suspensionReport.suspended).toBe(1);

    const suspendedStatus = db
      .select()
      .from(traderAccountStatus)
      .where(
        and(
          eq(traderAccountStatus.organizationId, organizationId),
          eq(traderAccountStatus.exchangeAccountId, EXCHANGE_ACCOUNT_ID),
        ),
      )
      .get();
    expect(suspendedStatus?.status).toBe("SUSPENDED");
    expect(suspendedStatus?.reason).toBe("overdue_invoice");

    const suspensionEvents = db
      .select()
      .from(traderAccountStatusEvents)
      .where(
        and(
          eq(traderAccountStatusEvents.organizationId, organizationId),
          eq(traderAccountStatusEvents.exchangeAccountId, EXCHANGE_ACCOUNT_ID),
        ),
      )
      .all();
    expect(suspensionEvents.some((event) => event.eventType === "SUSPENDED")).toBe(true);
    expect(
      suspensionEvents.some(
        (event) => event.eventType === "SUSPENDED" && event.sourceInvoiceId === overdueInvoiceId,
      ),
    ).toBe(true);

    const suspensionAudits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, EXCHANGE_ACCOUNT_ID))
      .all();
    expect(suspensionAudits.some((row) => row.action === traderAuditActions.accountSuspended)).toBe(
      true,
    );

    const duplicateReport = await runOverdueSuspensionCycle({
      overdueInvoicesReader: createSqliteOverdueInvoicesReader(db),
      accountStatusRepository: createSqliteAccountStatusRepository(db),
      writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
      logger: { log: () => undefined },
      now: () => CYCLE_NOW,
    });
    expect(duplicateReport.suspended).toBe(0);

    const paymentService = createSqlitePaymentService(db);
    const detected = await paymentService.detectPayment(context, {
      idempotencyKey: "TRC-20:overdue-lifecycle-tx:0",
      subjectModule: "trader",
      paymentAddressId: addressId,
    });
    const confirmed = await paymentService.confirmPayment(context, {
      paymentId: detected.paymentId,
      settlement: buildSettlementEvidence(TRANSFER, 20, new Date("2026-06-27T13:05:00.000Z")),
      paymentAddressId: addressId,
    });

    const service = createSqliteSettlementService(db);
    await service.applySettlementForPayment(context, {
      paymentId: confirmed.paymentId,
      organizationId,
      subjectModule: "trader",
      settlementNetwork: confirmed.settlementNetwork,
      settlementAsset: confirmed.settlementAsset,
      settlementAmount: confirmed.settlementAmount,
      settlementTxHash: confirmed.settlementTxHash,
      transferIndex: confirmed.transferIndex,
      blockHeight: TRANSFER.blockHeight,
      paymentAddressId: addressId,
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      updatedAt: confirmed.updatedAt,
    });

    const reactivatedStatus = db
      .select()
      .from(traderAccountStatus)
      .where(
        and(
          eq(traderAccountStatus.organizationId, organizationId),
          eq(traderAccountStatus.exchangeAccountId, EXCHANGE_ACCOUNT_ID),
        ),
      )
      .get();
    expect(reactivatedStatus?.status).toBe("ACTIVE");

    const allEvents = db
      .select()
      .from(traderAccountStatusEvents)
      .where(
        and(
          eq(traderAccountStatusEvents.organizationId, organizationId),
          eq(traderAccountStatusEvents.exchangeAccountId, EXCHANGE_ACCOUNT_ID),
        ),
      )
      .all();
    expect(allEvents.some((event) => event.eventType === "REACTIVATED")).toBe(true);

    const invoice = db
      .select()
      .from(traderInvoices)
      .where(eq(traderInvoices.id, overdueInvoiceId))
      .get();
    expect(invoice?.status).toBe("PAID");
  });
});
