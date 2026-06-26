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
  traderSettlementApplications,
  traderSettlements,
} from "@/db/schema";
import { createSqlitePaymentAddressService } from "@/lib/waia-core/payment-addresses";
import { createSqlitePaymentService } from "@/lib/waia-core/payments";
import { buildSettlementEvidence } from "@/lib/waia-core/payment-watcher/build-settlement-evidence";
import { createSqliteConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader-sqlite";
import { runSettlementCycle } from "@/lib/trader/settlement/run-settlement-cycle";
import { createSqliteSettlementService } from "@/lib/trader/settlement/settlement-service";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000321b";
const EXCHANGE_ACCOUNT_ID = "htx-settlement-s3b";
const DEPOSIT_ADDRESS = "TSettlementS3BDeposit";
const PERFORMANCE_FEE = "150.000000";

const TRANSFER = {
  txHash: "settlement-s3b-tx",
  transferIndex: 0,
  toAddress: DEPOSIT_ADDRESS,
  fromAddress: "TSenderS3B",
  contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  amountRaw: "150000000",
  amountDecimal: PERFORMANCE_FEE,
  blockHeight: "200",
  blockTimestamp: new Date("2026-06-26T10:00:00.000Z"),
  confirmationsObserved: 21,
};

let organizationId: string;
let addressId: string;
let invoiceId: string;

function insertIssuedInvoice(db: ReturnType<typeof getDb>, orgId: string, fee: string) {
  const id = crypto.randomUUID();
  const now = new Date("2026-06-26T09:00:00.000Z");
  db.insert(traderInvoices)
    .values({
      id,
      organizationId: orgId,
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      reportingPeriodId: `period-${id.slice(0, 8)}`,
      feeArtifactDigest: "artifact-digest-settlement-test",
      status: "ISSUED",
      currency: "USD",
      periodRealizedStrategyProfit: "500.00",
      cumulativeRealizedStrategyProfit: "500.00",
      previousHighWaterMark: "0",
      newProfitAboveHwm: "500.00",
      feeRate: "0.30",
      performanceFee: fee,
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
      feeComputedAt: now,
      schemaVersion: "waia.trader.invoice.v1",
      recordContentDigest: "digest-settlement-test",
      issuanceApprovedAt: now,
      issuanceApprovedBy: USER_ID,
      coolingOffUntil: new Date("2026-06-25T00:00:00.000Z"),
      issuedAt: now,
      issuedBy: USER_ID,
      settledAmount: "0",
      paidAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

async function createConfirmedPayment(orgId: string, addrId: string, txHash: string) {
  const db = getDb();
  const paymentService = createSqlitePaymentService(db);
  const context = requireOrgContext(orgId);
  const detected = await paymentService.detectPayment(context, {
    idempotencyKey: `TRC-20:${txHash}:0`,
    subjectModule: "trader",
    paymentAddressId: addrId,
  });
  const transfer = { ...TRANSFER, txHash };
  const settlement = buildSettlementEvidence(transfer, 20, new Date("2026-06-26T10:05:00.000Z"));
  return paymentService.confirmPayment(context, {
    paymentId: detected.paymentId,
    settlement,
    paymentAddressId: addrId,
  });
}

describe("settlement service + cycle (sqlite)", () => {
  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-settlement-s3b-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "settlement-s3b.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "settlement-s3b@waia.invalid",
      password: "password123",
      identityLabel: "Settlement S3B User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Settlement S3B User",
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
    invoiceId = insertIssuedInvoice(db, organizationId, PERFORMANCE_FEE);
  });

  it("applies settlement exactly once and marks invoice PAID", async () => {
    const db = getDb();
    const payment = await createConfirmedPayment(organizationId, addressId, "settlement-s3b-tx-1");
    const service = createSqliteSettlementService(db);
    const context = requireOrgContext(organizationId);

    const paymentView = {
      paymentId: payment.paymentId,
      organizationId,
      subjectModule: "trader" as const,
      settlementNetwork: payment.settlementNetwork,
      settlementAsset: payment.settlementAsset,
      settlementAmount: payment.settlementAmount,
      settlementTxHash: payment.settlementTxHash,
      transferIndex: payment.transferIndex,
      blockHeight: TRANSFER.blockHeight,
      paymentAddressId: addressId,
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      updatedAt: payment.updatedAt,
    };

    const first = await service.applySettlementForPayment(context, paymentView);
    const second = await service.applySettlementForPayment(context, paymentView);

    expect(first.id).toBe(second.id);
    expect(first.outcome).toBe("APPLIED");

    const settlements = db
      .select()
      .from(traderSettlements)
      .where(eq(traderSettlements.paymentId, payment.paymentId))
      .all();
    expect(settlements).toHaveLength(1);

    const applications = db.select().from(traderSettlementApplications).all();
    expect(applications).toHaveLength(1);
    expect(applications[0]?.invoiceId).toBe(invoiceId);

    const invoice = db.select().from(traderInvoices).where(eq(traderInvoices.id, invoiceId)).get();
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.settledAmount).toBe(PERFORMANCE_FEE);
    expect(invoice?.paidAt).not.toBeNull();

    const audits = db.select().from(auditLogs).where(eq(auditLogs.entityId, first.id)).all();
    expect(audits.some((row) => row.action === traderAuditActions.settlementApplied)).toBe(true);
  });

  it("records EXCEPTION for amount mismatch without mutating invoice", async () => {
    const db = getDb();
    const mismatchInvoiceId = insertIssuedInvoice(db, organizationId, "200.000000");
    const payment = await createConfirmedPayment(organizationId, addressId, "settlement-s3b-tx-2");
    const service = createSqliteSettlementService(db);
    const context = requireOrgContext(organizationId);

    const settlement = await service.applySettlementForPayment(context, {
      paymentId: payment.paymentId,
      organizationId,
      subjectModule: "trader",
      settlementNetwork: payment.settlementNetwork,
      settlementAsset: payment.settlementAsset,
      settlementAmount: payment.settlementAmount,
      settlementTxHash: payment.settlementTxHash,
      transferIndex: payment.transferIndex,
      blockHeight: TRANSFER.blockHeight,
      paymentAddressId: addressId,
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      updatedAt: payment.updatedAt,
    });

    expect(settlement.outcome).toBe("EXCEPTION");

    const invoice = db
      .select()
      .from(traderInvoices)
      .where(eq(traderInvoices.id, mismatchInvoiceId))
      .get();
    expect(invoice?.status).toBe("ISSUED");

    const applications = db
      .select()
      .from(traderSettlementApplications)
      .where(eq(traderSettlementApplications.settlementId, settlement.id))
      .all();
    expect(applications).toHaveLength(0);
  });

  it("reactivates a suspended account on APPLIED settlement", async () => {
    const db = getDb();
    const account = "htx-settlement-reactivate";
    db.insert(traderAccountStatus)
      .values({
        organizationId,
        exchangeAccountId: account,
        status: "SUSPENDED",
        reason: "overdue",
        lastEventSeq: 1,
        lastEventDigest: "seed-digest",
        createdAt: new Date("2026-06-20T00:00:00.000Z"),
        updatedAt: new Date("2026-06-20T00:00:00.000Z"),
      })
      .run();

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
      address: "TReactivateDepositS3B",
    });
    await addressService.assignAddress(context, {
      addressId: generated.addressId,
      subjectModule: "trader",
      subjectRef: account,
    });
    await addressService.activateAddress(context, { addressId: generated.addressId });

    const reactivateInvoiceId = insertIssuedInvoice(db, organizationId, PERFORMANCE_FEE);
    db.update(traderInvoices)
      .set({ exchangeAccountId: account })
      .where(eq(traderInvoices.id, reactivateInvoiceId))
      .run();

    const paymentService = createSqlitePaymentService(db);
    const detected = await paymentService.detectPayment(context, {
      idempotencyKey: "TRC-20:reactivate-tx:0",
      subjectModule: "trader",
      paymentAddressId: generated.addressId,
    });
    const transfer = {
      ...TRANSFER,
      txHash: "reactivate-tx",
      toAddress: "TReactivateDepositS3B",
    };
    const confirmed = await paymentService.confirmPayment(context, {
      paymentId: detected.paymentId,
      settlement: buildSettlementEvidence(transfer, 20, new Date("2026-06-26T11:00:00.000Z")),
      paymentAddressId: generated.addressId,
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
      blockHeight: transfer.blockHeight,
      paymentAddressId: generated.addressId,
      exchangeAccountId: account,
      updatedAt: confirmed.updatedAt,
    });

    const status = db
      .select()
      .from(traderAccountStatus)
      .where(
        and(
          eq(traderAccountStatus.organizationId, organizationId),
          eq(traderAccountStatus.exchangeAccountId, account),
        ),
      )
      .get();
    expect(status?.status).toBe("ACTIVE");

    const events = db
      .select()
      .from(traderAccountStatusEvents)
      .where(
        and(
          eq(traderAccountStatusEvents.organizationId, organizationId),
          eq(traderAccountStatusEvents.exchangeAccountId, account),
        ),
      )
      .all();
    expect(events.some((event) => event.eventType === "REACTIVATED")).toBe(true);
  });

  it("does not settle invoices belonging to another organization", async () => {
    const db = getDb();
    const USER_B = "00000000-0000-4000-8000-0000000321c";
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "settlement-s3b-orgb@waia.invalid",
      password: "password123",
      identityLabel: "Settlement Org B",
    });
    const orgB = ensureUserCoreSeedSqlite(db, {
      userId: USER_B,
      displayName: "Settlement Org B",
    });
    const orgBInvoiceId = insertIssuedInvoice(db, orgB, PERFORMANCE_FEE);

    const payment = await createConfirmedPayment(
      organizationId,
      addressId,
      "settlement-s3b-tx-tenant",
    );
    const service = createSqliteSettlementService(db);
    const context = requireOrgContext(organizationId);

    await service.applySettlementForPayment(context, {
      paymentId: payment.paymentId,
      organizationId,
      subjectModule: "trader",
      settlementNetwork: payment.settlementNetwork,
      settlementAsset: payment.settlementAsset,
      settlementAmount: payment.settlementAmount,
      settlementTxHash: payment.settlementTxHash,
      transferIndex: payment.transferIndex,
      blockHeight: TRANSFER.blockHeight,
      paymentAddressId: addressId,
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      updatedAt: payment.updatedAt,
    });

    const orgBInvoice = db
      .select()
      .from(traderInvoices)
      .where(eq(traderInvoices.id, orgBInvoiceId))
      .get();
    expect(orgBInvoice?.status).toBe("ISSUED");
    expect(orgBInvoice?.settledAmount).toBe("0");
  });

  it("concurrent duplicate apply yields exactly one settlement row", async () => {
    const db = getDb();
    insertIssuedInvoice(db, organizationId, PERFORMANCE_FEE);
    const payment = await createConfirmedPayment(
      organizationId,
      addressId,
      "settlement-s3b-tx-race",
    );
    const service = createSqliteSettlementService(db);
    const context = requireOrgContext(organizationId);
    const paymentView = {
      paymentId: payment.paymentId,
      organizationId,
      subjectModule: "trader" as const,
      settlementNetwork: payment.settlementNetwork,
      settlementAsset: payment.settlementAsset,
      settlementAmount: payment.settlementAmount,
      settlementTxHash: payment.settlementTxHash,
      transferIndex: payment.transferIndex,
      blockHeight: TRANSFER.blockHeight,
      paymentAddressId: addressId,
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      updatedAt: payment.updatedAt,
    };

    const [first, second] = await Promise.all([
      service.applySettlementForPayment(context, paymentView),
      service.applySettlementForPayment(context, paymentView),
    ]);

    expect(first.id).toBe(second.id);
    const rows = db
      .select()
      .from(traderSettlements)
      .where(eq(traderSettlements.paymentId, payment.paymentId))
      .all();
    expect(rows).toHaveLength(1);
  });

  it("runs settlement cycle over unsettled confirmed payments", async () => {
    const db = getDb();
    const cycleInvoiceId = insertIssuedInvoice(db, organizationId, PERFORMANCE_FEE);
    void cycleInvoiceId;
    await createConfirmedPayment(organizationId, addressId, "settlement-s3b-tx-4");

    const report = await runSettlementCycle({
      settlementService: createSqliteSettlementService(db),
      confirmedPaymentsReader: createSqliteConfirmedPaymentsReader(db),
      logger: { log: () => undefined },
      maxPaymentsPerCycle: 10,
    });

    expect(report.processed).toBeGreaterThan(0);
    expect(report.applied + report.exception).toBeGreaterThan(0);
  });
});
