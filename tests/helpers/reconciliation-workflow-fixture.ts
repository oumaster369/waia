import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  auditLogs,
  traderInvoices,
  traderSettlementApplications,
  traderSettlementReconciliationCases,
  traderSettlementReconciliationEvents,
  traderSettlements,
} from "@/db/schema";
import { createSqlitePaymentAddressService } from "@/lib/waia-core/payment-addresses";
import { createSqlitePaymentService } from "@/lib/waia-core/payments";
import { buildSettlementEvidence } from "@/lib/waia-core/payment-watcher/build-settlement-evidence";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  createSqliteAccountStatusRepository,
  createSqliteInvoiceSettlementRepository,
} from "@/lib/trader/settlement/account-status-repository-sqlite";
import { claimCase } from "@/lib/trader/settlement/reconciliation/commands/claim-case";
import { executeResolution } from "@/lib/trader/settlement/reconciliation/commands/execute-resolution";
import { proposeResolution } from "@/lib/trader/settlement/reconciliation/commands/propose-resolution";
import { startReview } from "@/lib/trader/settlement/reconciliation/commands/start-review";
import { createSqliteReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository-sqlite";
import type { ReconciliationCaseView } from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { createSqliteSettlementService } from "@/lib/trader/settlement/settlement-service";
import { createSqliteSettlementApplicationsRepository } from "@/lib/trader/settlement/settlement-applications-repository-sqlite";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

export const RECON_FIXTURE_USER = "00000000-0000-4000-8000-0000000s3cb";
export const RECON_FIXTURE_EXCHANGE = "htx-recon-s3cb";
export const RECON_FIXTURE_VALUED_AMOUNT = "150.000000";

const TRANSFER_BASE = {
  transferIndex: 0,
  toAddress: "TReconS3CBDeposit",
  fromAddress: "TSenderS3CB",
  contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  amountRaw: "150000000",
  amountDecimal: RECON_FIXTURE_VALUED_AMOUNT,
  blockHeight: "200",
  blockTimestamp: new Date("2026-06-26T10:00:00.000Z"),
  confirmationsObserved: 21,
};

export type ReconciliationWorkflowFixture = {
  organizationId: string;
  operatorId: string;
  addressId: string;
  targetInvoiceId: string;
  settlementId: string;
  caseId: string;
  context: ReturnType<typeof requireOrgContext>;
  caseRepository: ReturnType<typeof createSqliteReconciliationCaseRepository>;
  writeAudit: (input: Parameters<typeof writeTraderAuditLogSqlite>[1]) => string;
  db: ReturnType<typeof getDb>;
};

export function initReconciliationWorkflowSqliteDb(): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-recon-s3cb-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "recon-s3cb.sqlite")}`;
  migrateDatabaseFromEnv();
  baseSeedCache.delete(process.env.DATABASE_URL);
}

type BaseSeed = {
  organizationId: string;
  addressId: string;
  context: ReturnType<typeof requireOrgContext>;
  db: ReturnType<typeof getDb>;
};

const baseSeedCache = new Map<string, Promise<BaseSeed>>();

async function ensureBaseSeed(): Promise<BaseSeed> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL must be set — call initReconciliationWorkflowSqliteDb() first");
  }

  let pending = baseSeedCache.get(dbUrl);
  if (!pending) {
    pending = (async () => {
      const db = getDb();
      insertEmailPasswordUser(db, {
        id: RECON_FIXTURE_USER,
        email: "recon-s3cb@waia.invalid",
        password: "password123",
        identityLabel: "Recon S3CB User",
      });
      const organizationId = ensureUserCoreSeedSqlite(db, {
        userId: RECON_FIXTURE_USER,
        displayName: "Recon S3CB User",
      });
      const context = requireOrgContext(organizationId);

      const addressService = createSqlitePaymentAddressService(db);
      const wallet = await addressService.createWallet(context, {
        walletKind: "DEPOSIT",
        custodyModel: "ORGANIZATION",
        controlModel: "2-of-3",
        status: "active",
      });
      const generated = await addressService.generateAddress(context, {
        walletId: wallet.id,
        network: "TRC-20",
        address: TRANSFER_BASE.toAddress,
      });
      await addressService.assignAddress(context, {
        addressId: generated.addressId,
        subjectModule: "trader",
        subjectRef: RECON_FIXTURE_EXCHANGE,
      });
      await addressService.activateAddress(context, { addressId: generated.addressId });

      return { organizationId, addressId: generated.addressId, context, db };
    })();
    baseSeedCache.set(dbUrl, pending);
  }

  return pending;
}

function insertIssuedInvoice(
  db: ReturnType<typeof getDb>,
  orgId: string,
  fee: string,
  exchangeAccountId = RECON_FIXTURE_EXCHANGE,
) {
  const id = crypto.randomUUID();
  const now = new Date("2026-06-26T09:00:00.000Z");
  db.insert(traderInvoices)
    .values({
      id,
      organizationId: orgId,
      exchangeAccountId,
      reportingPeriodId: `period-${id.slice(0, 8)}`,
      feeArtifactDigest: "artifact-digest-recon-s3cb",
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
      recordContentDigest: "digest-recon-s3cb",
      issuanceApprovedAt: now,
      issuanceApprovedBy: RECON_FIXTURE_USER,
      coolingOffUntil: new Date("2026-06-25T00:00:00.000Z"),
      issuedAt: now,
      issuedBy: RECON_FIXTURE_USER,
      settledAmount: "0",
      paidAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

async function createConfirmedPayment(
  orgId: string,
  addressId: string,
  txHash: string,
): Promise<{ paymentId: string; updatedAt: Date }> {
  const db = getDb();
  const paymentService = createSqlitePaymentService(db);
  const context = requireOrgContext(orgId);
  const detected = await paymentService.detectPayment(context, {
    idempotencyKey: `TRC-20:${txHash}:0`,
    subjectModule: "trader",
    paymentAddressId: addressId,
  });
  const transfer = { ...TRANSFER_BASE, txHash };
  const confirmed = await paymentService.confirmPayment(context, {
    paymentId: detected.paymentId,
    settlement: buildSettlementEvidence(transfer, 20, new Date("2026-06-26T10:05:00.000Z")),
    paymentAddressId: addressId,
  });
  return { paymentId: confirmed.paymentId, updatedAt: confirmed.updatedAt };
}

export async function seedReconciliationWorkflowFixture(): Promise<ReconciliationWorkflowFixture> {
  const base = await ensureBaseSeed();
  const { organizationId, addressId, context, db } = base;

  insertIssuedInvoice(db, organizationId, "200.000000");

  const txHash = `recon-s3cb-${crypto.randomUUID()}`;
  const payment = await createConfirmedPayment(organizationId, addressId, txHash);
  const settlementService = createSqliteSettlementService(db);
  const settlement = await settlementService.applySettlementForPayment(context, {
    paymentId: payment.paymentId,
    organizationId,
    subjectModule: "trader",
    settlementNetwork: "TRC-20",
    settlementAsset: "USDT",
    settlementAmount: RECON_FIXTURE_VALUED_AMOUNT,
    settlementTxHash: txHash,
    transferIndex: 0,
    blockHeight: TRANSFER_BASE.blockHeight,
    paymentAddressId: addressId,
    exchangeAccountId: RECON_FIXTURE_EXCHANGE,
    updatedAt: payment.updatedAt,
  });

  const targetInvoiceId = insertIssuedInvoice(db, organizationId, RECON_FIXTURE_VALUED_AMOUNT);

  const caseRow = db
    .select()
    .from(traderSettlementReconciliationCases)
    .where(eq(traderSettlementReconciliationCases.settlementId, settlement.id))
    .get();
  if (!caseRow) {
    throw new Error("expected reconciliation case for EXCEPTION settlement");
  }

  return {
    organizationId,
    operatorId: RECON_FIXTURE_USER,
    addressId,
    targetInvoiceId,
    settlementId: settlement.id,
    caseId: caseRow.id,
    context,
    caseRepository: createSqliteReconciliationCaseRepository(db),
    writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
    db,
  };
}

export async function advanceCaseToDecisionPending(
  fixture: ReconciliationWorkflowFixture,
  options: { coolingOffMs?: number; now?: Date } = {},
): Promise<{ caseView: ReconciliationCaseView; decisionId: string }> {
  const operator = { actorType: "user" as const, actorId: fixture.operatorId };
  const now = options.now ?? new Date("2026-06-26T12:00:00.000Z");

  let current = await fixture.caseRepository.findById(fixture.context, fixture.caseId);
  if (!current) {
    throw new Error("case missing");
  }

  const suffix = crypto.randomUUID().slice(0, 8);

  const claimed = await claimCase(
    { caseRepository: fixture.caseRepository, writeAudit: fixture.writeAudit, now: () => now },
    fixture.context,
    operator,
    {
      caseId: fixture.caseId,
      expectedLastEventSeq: current.lastEventSeq,
      idempotencyKey: `fixture-claim-${suffix}`,
    },
  );
  current = claimed.case;

  const reviewed = await startReview(
    { caseRepository: fixture.caseRepository, writeAudit: fixture.writeAudit },
    fixture.context,
    operator,
    {
      caseId: fixture.caseId,
      expectedLastEventSeq: current.lastEventSeq,
      idempotencyKey: `fixture-review-${suffix}`,
    },
  );
  current = reviewed.case;

  const proposed = await proposeResolution(
    {
      caseRepository: fixture.caseRepository,
      invoiceSettlementRepository: createSqliteInvoiceSettlementRepository(fixture.db),
      writeAudit: fixture.writeAudit,
      now: () => now,
    },
    fixture.context,
    operator,
    {
      caseId: fixture.caseId,
      expectedLastEventSeq: current.lastEventSeq,
      idempotencyKey: `fixture-propose-${suffix}`,
      resolutionType: "MANUAL_APPLY",
      targetInvoiceId: fixture.targetInvoiceId,
      rationale: "Operator confirms manual apply after review.",
      coolingOffMs: options.coolingOffMs ?? 0,
    },
  );

  const decisionId = proposed.case.currentDecisionId;
  if (!decisionId) {
    throw new Error("expected decisionId after propose");
  }

  return { caseView: proposed.case, decisionId };
}

export async function executeManualApply(
  fixture: ReconciliationWorkflowFixture,
  input: {
    caseView: ReconciliationCaseView;
    decisionId: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const operator = { actorType: "user" as const, actorId: fixture.operatorId };
  const now = input.now ?? new Date("2026-06-26T13:00:00.000Z");

  return executeResolution(
    {
      caseRepository: fixture.caseRepository,
      settlementApplicationsRepository: createSqliteSettlementApplicationsRepository(fixture.db),
      invoiceSettlementRepository: createSqliteInvoiceSettlementRepository(fixture.db),
      accountStatusRepository: createSqliteAccountStatusRepository(fixture.db),
      writeAudit: fixture.writeAudit,
      now: () => now,
    },
    fixture.context,
    operator,
    {
      caseId: fixture.caseId,
      expectedLastEventSeq: input.caseView.lastEventSeq,
      idempotencyKey: input.idempotencyKey,
      decisionId: input.decisionId,
      confirmToken: "confirm-manual-apply",
    },
  );
}

export function countEvents(db: ReturnType<typeof getDb>, caseId: string): number {
  return db
    .select()
    .from(traderSettlementReconciliationEvents)
    .where(eq(traderSettlementReconciliationEvents.caseId, caseId))
    .all().length;
}

export function countAuditsForCase(db: ReturnType<typeof getDb>, caseId: string): number {
  return db.select().from(auditLogs).where(eq(auditLogs.entityId, caseId)).all().length;
}

export function countApplicationsForSettlement(
  db: ReturnType<typeof getDb>,
  settlementId: string,
): number {
  return db
    .select()
    .from(traderSettlementApplications)
    .where(eq(traderSettlementApplications.settlementId, settlementId))
    .all().length;
}

export function getSettlementOutcome(db: ReturnType<typeof getDb>, settlementId: string) {
  return db.select().from(traderSettlements).where(eq(traderSettlements.id, settlementId)).get()
    ?.outcome;
}
