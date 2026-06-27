import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import {
  traderInvoices,
  traderSettlementApplications,
  traderSettlements,
  payments,
} from "@/db/schema";
import { ReconciliationApplicationAlreadyExistsError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import { createSqliteSettlementApplicationsRepository } from "@/lib/trader/settlement/settlement-applications-repository-sqlite";
import { buildSettlementApplicationPayload } from "@/lib/trader/settlement/serialize-settlement";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { initReconciliationWorkflowSqliteDb } from "@/tests/helpers/reconciliation-workflow-fixture";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000s3cbuni";

function insertBarePayment(db: ReturnType<typeof getDb>, orgId: string, paymentId: string) {
  const now = new Date("2026-06-26T10:00:00.000Z");
  db.insert(payments)
    .values({
      paymentId,
      organizationId: orgId,
      status: "CONFIRMED",
      direction: "INBOUND",
      subjectModule: "trader",
      settlementNetwork: "TRC-20",
      settlementAsset: "USDT",
      settlementAmount: "150.000000",
      settlementTxHash: `uniq-${paymentId.slice(0, 8)}`,
      transferIndex: 0,
      lastEventSeq: 1,
      lastEventDigest: "digest-payment-uniq",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function insertBareSettlement(
  db: ReturnType<typeof getDb>,
  orgId: string,
  settlementId: string,
  paymentId: string,
) {
  const now = new Date("2026-06-26T10:00:00.000Z");
  db.insert(traderSettlements)
    .values({
      id: settlementId,
      organizationId: orgId,
      exchangeAccountId: "htx-uniq",
      paymentId,
      settlementNetwork: "TRC-20",
      settlementTxHash: `uniq-${settlementId.slice(0, 8)}`,
      transferIndex: 0,
      blockHeight: "1",
      asset: "USDT",
      onChainAmount: "150.000000",
      valuedAmount: "150.000000",
      valuationCurrency: "USD",
      valuationBasis: "stablecoin_par",
      outcome: "EXCEPTION",
      exceptionReason: "AMOUNT_MISMATCH",
      schemaVersion: "waia.trader.settlement.v1",
      recordContentDigest: `digest-${settlementId.slice(0, 8)}`,
      createdAt: now,
    })
    .run();
}

function insertBareInvoice(db: ReturnType<typeof getDb>, orgId: string, invoiceId: string) {
  const now = new Date("2026-06-26T09:00:00.000Z");
  db.insert(traderInvoices)
    .values({
      id: invoiceId,
      organizationId: orgId,
      exchangeAccountId: "htx-uniq",
      reportingPeriodId: `period-${invoiceId.slice(0, 8)}`,
      feeArtifactDigest: "artifact-uniq",
      status: "ISSUED",
      currency: "USD",
      periodRealizedStrategyProfit: "500.00",
      cumulativeRealizedStrategyProfit: "500.00",
      previousHighWaterMark: "0",
      newProfitAboveHwm: "500.00",
      feeRate: "0.30",
      performanceFee: "150.000000",
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
      recordContentDigest: "digest-uniq",
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
}

describe("settlement application uniqueness (sqlite integration)", () => {
  let organizationId: string;

  beforeAll(() => {
    initReconciliationWorkflowSqliteDb();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "uniq-s3cb@waia.invalid",
      password: "password123",
      identityLabel: "Uniq S3CB User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Uniq S3CB User",
    });
  });

  it("allows at most one application per settlement (DB-enforced)", async () => {
    const db = getDb();
    const settlementId = crypto.randomUUID();
    const invoiceId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    insertBarePayment(db, organizationId, paymentId);
    insertBareSettlement(db, organizationId, settlementId, paymentId);
    insertBareInvoice(db, organizationId, invoiceId);

    const repo = createSqliteSettlementApplicationsRepository(db);
    const context = requireOrgContext(organizationId);
    const payload = buildSettlementApplicationPayload({
      settlementId,
      organizationId,
      invoiceId,
      appliedAmount: "150.000000",
      invoiceStatusAfter: "PAID",
    });

    const first = await repo.insertApplication(context, { payload, applicationSource: "AUTO" });
    expect(first.settlementId).toBe(settlementId);

    let duplicateError: unknown;
    try {
      await repo.insertApplication(context, {
        payload,
        applicationSource: "MANUAL",
        decisionId: crypto.randomUUID(),
      });
    } catch (error) {
      duplicateError = error;
    }
    expect(duplicateError).toBeInstanceOf(ReconciliationApplicationAlreadyExistsError);

    expect(
      db
        .select()
        .from(traderSettlementApplications)
        .where(eq(traderSettlementApplications.settlementId, settlementId))
        .all(),
    ).toHaveLength(1);
  });

  it("concurrent AUTO+MANUAL insert attempts yield exactly one application", async () => {
    const db = getDb();
    const settlementId = crypto.randomUUID();
    const invoiceId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    insertBarePayment(db, organizationId, paymentId);
    insertBareSettlement(db, organizationId, settlementId, paymentId);
    insertBareInvoice(db, organizationId, invoiceId);

    const repo = createSqliteSettlementApplicationsRepository(db);
    const context = requireOrgContext(organizationId);
    const payload = buildSettlementApplicationPayload({
      settlementId,
      organizationId,
      invoiceId,
      appliedAmount: "150.000000",
      invoiceStatusAfter: "PAID",
    });

    const results = await Promise.allSettled([
      repo.insertApplication(context, { payload, applicationSource: "AUTO" }),
      (async () => {
        await Promise.resolve();
        return repo.insertApplication(context, {
          payload,
          applicationSource: "MANUAL",
          decisionId: crypto.randomUUID(),
        });
      })(),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status === "rejected" && rejected[0].reason).toBeInstanceOf(
      ReconciliationApplicationAlreadyExistsError,
    );
    expect(
      db
        .select()
        .from(traderSettlementApplications)
        .where(eq(traderSettlementApplications.settlementId, settlementId))
        .all(),
    ).toHaveLength(1);
  });
});
