/**
 * AT-E12 S3-C-B — settlement reconciliation workflow Postgres parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { createPostgresPaymentService } from "@/lib/waia-core/payments";
import { buildSettlementEvidence } from "@/lib/waia-core/payment-watcher/build-settlement-evidence";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import {
  createPostgresAccountStatusRepository,
  createPostgresInvoiceSettlementRepository,
} from "@/lib/trader/settlement/account-status-repository-postgres";
import { claimCase } from "@/lib/trader/settlement/reconciliation/commands/claim-case";
import { executeResolution } from "@/lib/trader/settlement/reconciliation/commands/execute-resolution";
import { proposeResolution } from "@/lib/trader/settlement/reconciliation/commands/propose-resolution";
import { startReview } from "@/lib/trader/settlement/reconciliation/commands/start-review";
import { createPostgresReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository-postgres";
import { effectiveOutcome } from "@/lib/trader/settlement/reconciliation/effective-outcome";
import { createPostgresSettlementService } from "@/lib/trader/settlement/settlement-service";
import { createPostgresSettlementApplicationsRepository } from "@/lib/trader/settlement/settlement-applications-repository-postgres";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import { ensureAuthUsersSeed } from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8022-00000003cb001";
const EXCHANGE = "htx-recon-s3cb-pg";
const VALUED = "150.000000";

describe.skipIf(!integrationEnabled || !url)(
  "postgres reconciliation workflow parity (AT-E12 S3-C-B)",
  () => {
    let orgA: string;

    async function cleanup(): Promise<void> {
      const orgId = personalOrganizationIdFromUserId(USER_A);
      const sql = postgres(url!, { max: 1 });
      try {
        await sql.unsafe(
          `DELETE FROM trader_settlement_reconciliation_events WHERE organization_id = $1`,
          [orgId],
        );
        await sql.unsafe(
          `DELETE FROM trader_settlement_reconciliation_cases WHERE organization_id = $1`,
          [orgId],
        );
        await sql.unsafe(`DELETE FROM trader_settlement_applications WHERE organization_id = $1`, [
          orgId,
        ]);
        await sql.unsafe(`DELETE FROM trader_settlements WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM trader_invoices WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM payment_events WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM payments WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM audit_logs WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM users WHERE id = $1`, [USER_A]);
        await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [USER_A]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    async function insertIssuedInvoice(db: ReturnType<typeof getPostgresDrizzle>, fee: string) {
      const id = crypto.randomUUID();
      const now = new Date("2026-06-26T09:00:00.000Z");
      await db.insert(pgSchema.traderInvoices).values({
        id,
        organizationId: orgA,
        exchangeAccountId: EXCHANGE,
        reportingPeriodId: `period-${id.slice(0, 8)}`,
        feeArtifactDigest: "artifact-digest-pg-recon",
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
        recordContentDigest: "digest-pg-recon",
        issuanceApprovedAt: now,
        issuanceApprovedBy: USER_A,
        coolingOffUntil: new Date("2026-06-25T00:00:00.000Z"),
        issuedAt: now,
        issuedBy: USER_A,
        settledAmount: "0",
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    }

    beforeAll(async () => {
      await verifyHtrPostgresConnectionIdentity();
      await cleanup();
      await ensureAuthUsersSeed(url!, [USER_A]);

      const db = getPostgresDrizzle();
      orgA = await ensureUserCoreSeedPostgres(db, {
        userId: USER_A,
        displayName: "Recon PG Parity",
      });
    });

    afterAll(async () => {
      await cleanup();
      resetPostgresSingletonForTests();
    });

    it("runs OPEN -> RESOLVED MANUAL_APPLY with invoice PAID and derived effectiveOutcome", async () => {
      const db = getPostgresDrizzle();
      const context = requireOrgContext(orgA);
      const operator = { actorType: "user" as const, actorId: USER_A };
      const txHash = `pg-recon-${crypto.randomUUID()}`;

      await insertIssuedInvoice(db, "200.000000");
      const targetInvoiceId = await insertIssuedInvoice(db, VALUED);

      const paymentService = createPostgresPaymentService(db, {}, db);
      const detected = await paymentService.detectPayment(context, {
        idempotencyKey: `pg-recon-${txHash}`,
        subjectModule: "trader",
      });
      const transfer = {
        txHash,
        transferIndex: 0,
        toAddress: "TPgReconDeposit",
        fromAddress: "TSenderPgRecon",
        contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        amountRaw: "150000000",
        amountDecimal: VALUED,
        blockHeight: "200",
        blockTimestamp: new Date("2026-06-26T10:00:00.000Z"),
        confirmationsObserved: 21,
      };
      const confirmed = await paymentService.confirmPayment(context, {
        paymentId: detected.paymentId,
        settlement: buildSettlementEvidence(transfer, 20, new Date("2026-06-26T10:05:00.000Z")),
      });

      const settlementService = createPostgresSettlementService(db, {}, db);
      const settlement = await settlementService.applySettlementForPayment(context, {
        paymentId: confirmed.paymentId,
        organizationId: orgA,
        subjectModule: "trader",
        settlementNetwork: confirmed.settlementNetwork,
        settlementAsset: confirmed.settlementAsset,
        settlementAmount: confirmed.settlementAmount,
        settlementTxHash: confirmed.settlementTxHash,
        transferIndex: confirmed.transferIndex,
        blockHeight: transfer.blockHeight,
        paymentAddressId: null,
        exchangeAccountId: EXCHANGE,
        updatedAt: confirmed.updatedAt,
      });
      expect(settlement.outcome).toBe("EXCEPTION");

      const caseRow = await db
        .select()
        .from(pgSchema.traderSettlementReconciliationCases)
        .where(eq(pgSchema.traderSettlementReconciliationCases.settlementId, settlement.id))
        .limit(1);
      const caseId = caseRow[0]?.id;
      expect(caseId).toBeTruthy();

      const caseRepository = createPostgresReconciliationCaseRepository(db);
      const writeAudit = (input: Parameters<typeof writeTraderAuditLogPostgres>[1]) =>
        writeTraderAuditLogPostgres(db, input);
      const now = () => new Date("2026-06-26T12:00:00.000Z");

      const current = await caseRepository.findById(context, caseId!);
      expect(current).not.toBeNull();

      const claimed = await claimCase({ caseRepository, writeAudit, now }, context, operator, {
        caseId: caseId!,
        expectedLastEventSeq: current!.lastEventSeq,
        idempotencyKey: "pg-claim",
      });
      const reviewed = await startReview({ caseRepository, writeAudit }, context, operator, {
        caseId: caseId!,
        expectedLastEventSeq: claimed.case.lastEventSeq,
        idempotencyKey: "pg-review",
      });
      const proposed = await proposeResolution(
        {
          caseRepository,
          invoiceSettlementRepository: createPostgresInvoiceSettlementRepository(db),
          writeAudit,
          now,
        },
        context,
        operator,
        {
          caseId: caseId!,
          expectedLastEventSeq: reviewed.case.lastEventSeq,
          idempotencyKey: "pg-propose",
          resolutionType: "MANUAL_APPLY",
          targetInvoiceId,
          rationale: "PG parity manual apply",
          coolingOffMs: 0,
        },
      );

      const decisionId = proposed.case.currentDecisionId!;

      await runWaiaPostgresTransaction(db, async (tx) =>
        executeResolution(
          {
            caseRepository: createPostgresReconciliationCaseRepository(tx),
            settlementApplicationsRepository: createPostgresSettlementApplicationsRepository(tx),
            invoiceSettlementRepository: createPostgresInvoiceSettlementRepository(tx),
            accountStatusRepository: createPostgresAccountStatusRepository(tx),
            writeAudit: (input) => writeTraderAuditLogPostgres(tx, input),
          },
          context,
          operator,
          {
            caseId: caseId!,
            expectedLastEventSeq: proposed.case.lastEventSeq,
            idempotencyKey: "pg-execute",
            decisionId,
            confirmToken: "confirm-pg",
          },
        ),
      );

      const applications = await db
        .select()
        .from(pgSchema.traderSettlementApplications)
        .where(eq(pgSchema.traderSettlementApplications.settlementId, settlement.id));
      expect(applications).toHaveLength(1);

      const invoice = await db
        .select()
        .from(pgSchema.traderInvoices)
        .where(eq(pgSchema.traderInvoices.id, targetInvoiceId))
        .limit(1);
      expect(invoice[0]?.status).toBe("PAID");

      const resolvedCase = await caseRepository.findById(context, caseId!);
      expect(resolvedCase?.status).toBe("RESOLVED");
      expect(
        effectiveOutcome({
          applications: applications.map((row) => ({
            id: row.id,
            schemaVersion: row.schemaVersion as "waia.trader.settlement-application.v1",
            settlementId: row.settlementId,
            organizationId: row.organizationId,
            invoiceId: row.invoiceId,
            appliedAmount: row.appliedAmount,
            invoiceStatusAfter: row.invoiceStatusAfter as "PAID",
            recordContentDigest: row.recordContentDigest,
            createdAt: row.createdAt,
          })),
          case: resolvedCase!,
        }),
      ).toBe("FINANCIALLY_APPLIED");
    });

    it("rolls back financial effects when appendEvent fails inside postgres transaction", async () => {
      const db = getPostgresDrizzle();
      const context = requireOrgContext(orgA);
      const operator = { actorType: "user" as const, actorId: USER_A };
      const txHash = `pg-recon-fault-${crypto.randomUUID()}`;

      await insertIssuedInvoice(db, "200.000000");
      const targetInvoiceId = await insertIssuedInvoice(db, VALUED);

      const paymentService = createPostgresPaymentService(db, {}, db);
      const detected = await paymentService.detectPayment(context, {
        idempotencyKey: `pg-fault-${txHash}`,
        subjectModule: "trader",
      });
      const transfer = {
        txHash,
        transferIndex: 0,
        toAddress: "TPgReconFault",
        fromAddress: "TSenderPgFault",
        contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        amountRaw: "150000000",
        amountDecimal: VALUED,
        blockHeight: "201",
        blockTimestamp: new Date("2026-06-26T11:00:00.000Z"),
        confirmationsObserved: 21,
      };
      const confirmed = await paymentService.confirmPayment(context, {
        paymentId: detected.paymentId,
        settlement: buildSettlementEvidence(transfer, 20, new Date("2026-06-26T11:05:00.000Z")),
      });

      const settlementService = createPostgresSettlementService(db, {}, db);
      const settlement = await settlementService.applySettlementForPayment(context, {
        paymentId: confirmed.paymentId,
        organizationId: orgA,
        subjectModule: "trader",
        settlementNetwork: confirmed.settlementNetwork,
        settlementAsset: confirmed.settlementAsset,
        settlementAmount: confirmed.settlementAmount,
        settlementTxHash: confirmed.settlementTxHash,
        transferIndex: confirmed.transferIndex,
        blockHeight: transfer.blockHeight,
        paymentAddressId: null,
        exchangeAccountId: EXCHANGE,
        updatedAt: confirmed.updatedAt,
      });

      const caseRepository = createPostgresReconciliationCaseRepository(db);
      const writeAudit = (input: Parameters<typeof writeTraderAuditLogPostgres>[1]) =>
        writeTraderAuditLogPostgres(db, input);
      const now = () => new Date("2026-06-26T12:00:00.000Z");

      const caseRow = await db
        .select()
        .from(pgSchema.traderSettlementReconciliationCases)
        .where(eq(pgSchema.traderSettlementReconciliationCases.settlementId, settlement.id))
        .limit(1);
      const caseId = caseRow[0]!.id;

      const current = await caseRepository.findById(context, caseId);
      const claimed = await claimCase({ caseRepository, writeAudit, now }, context, operator, {
        caseId,
        expectedLastEventSeq: current!.lastEventSeq,
        idempotencyKey: "pg-fault-claim",
      });
      const reviewed = await startReview({ caseRepository, writeAudit }, context, operator, {
        caseId,
        expectedLastEventSeq: claimed.case.lastEventSeq,
        idempotencyKey: "pg-fault-review",
      });
      const proposed = await proposeResolution(
        {
          caseRepository,
          invoiceSettlementRepository: createPostgresInvoiceSettlementRepository(db),
          writeAudit,
          now,
        },
        context,
        operator,
        {
          caseId,
          expectedLastEventSeq: reviewed.case.lastEventSeq,
          idempotencyKey: "pg-fault-propose",
          resolutionType: "MANUAL_APPLY",
          targetInvoiceId,
          rationale: "Fault injection path",
          coolingOffMs: 0,
        },
      );

      const decisionId = proposed.case.currentDecisionId!;

      await expect(
        runWaiaPostgresTransaction(db, async (tx) => {
          const txRepo = createPostgresReconciliationCaseRepository(tx);
          return executeResolution(
            {
              caseRepository: {
                ...txRepo,
                appendEvent: async () => {
                  throw new Error("injected postgres fault");
                },
              },
              settlementApplicationsRepository: createPostgresSettlementApplicationsRepository(tx),
              invoiceSettlementRepository: createPostgresInvoiceSettlementRepository(tx),
              accountStatusRepository: createPostgresAccountStatusRepository(tx),
              writeAudit: (input) => writeTraderAuditLogPostgres(tx, input),
            },
            context,
            operator,
            {
              caseId,
              expectedLastEventSeq: proposed.case.lastEventSeq,
              idempotencyKey: "pg-fault-execute",
              decisionId,
              confirmToken: "confirm-fault",
            },
          );
        }),
      ).rejects.toThrow("injected postgres fault");

      const applications = await db
        .select()
        .from(pgSchema.traderSettlementApplications)
        .where(eq(pgSchema.traderSettlementApplications.settlementId, settlement.id));
      expect(applications).toHaveLength(0);

      const invoice = await db
        .select()
        .from(pgSchema.traderInvoices)
        .where(eq(pgSchema.traderInvoices.id, targetInvoiceId))
        .limit(1);
      expect(invoice[0]?.status).toBe("ISSUED");

      const events = await db
        .select()
        .from(pgSchema.traderSettlementReconciliationEvents)
        .where(eq(pgSchema.traderSettlementReconciliationEvents.caseId, caseId));
      expect(events.some((row) => row.eventType === "RESOLUTION_EXECUTED")).toBe(false);
    });
  },
);
