/**
 * AT-E12 S3-C-A — settlement reconciliation Postgres parity (opt-in).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { createPostgresPaymentService } from "@/lib/waia-core/payments";
import { buildSettlementEvidence } from "@/lib/waia-core/payment-watcher/build-settlement-evidence";
import { backfillExceptionCases } from "@/lib/trader/settlement/reconciliation/backfill-exception-cases";
import { createPostgresReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository-postgres";
import { createPostgresReconciliationEvidenceReader } from "@/lib/trader/settlement/reconciliation/reconciliation-evidence-postgres";
import { createPostgresReconciliationReader } from "@/lib/trader/settlement/reconciliation/reconciliation-reader-postgres";
import { createPostgresSettlementService } from "@/lib/trader/settlement/settlement-service";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { writeTraderAuditLogPostgres } from "@/lib/trader/audit/write";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import {
  deleteHtrPostgresSettlementDomainForOrg,
  seedHtrPostgresUser,
} from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8022-000000032101";
const EXCHANGE_ACCOUNT_ID = "htx-reconciliation-s3ca-pg";
const PERFORMANCE_FEE = "200.000000";

describe.skipIf(!integrationEnabled || !url)(
  "postgres settlement reconciliation parity (S3-C-A)",
  () => {
    let orgA: string;

    async function cleanup(): Promise<void> {
      const orgId = personalOrganizationIdFromUserId(USER_A);
      await deleteHtrPostgresSettlementDomainForOrg(url!, orgId);
      const sql = postgres(url!, { max: 1 });
      try {
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

    beforeAll(async () => {
      await verifyHtrPostgresConnectionIdentity();
      await cleanup();
      orgA = await seedHtrPostgresUser(url!, USER_A, "Reconciliation Postgres Parity");

      getPostgresDrizzle();
    });

    afterAll(async () => {
      await cleanup();
      resetPostgresSingletonForTests();
    });

    it("EXCEPTION settlement via hook creates exactly one reconciliation case", async () => {
      const db = getPostgresDrizzle();
      const context = requireOrgContext(orgA);
      const paymentService = createPostgresPaymentService(db, {}, db);
      const settlementService = createPostgresSettlementService(db, {}, db);

      const detected = await paymentService.detectPayment(context, {
        idempotencyKey: "pg-reconciliation-exception",
        subjectModule: "trader",
        subjectInvoiceId: "invoice-reconciliation-exception-pg",
      });
      const transfer = {
        txHash: "pg-reconciliation-exception-tx",
        transferIndex: 0,
        toAddress: "TPgReconciliation",
        fromAddress: "TSenderPg",
        contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        amountRaw: "200000000",
        amountDecimal: PERFORMANCE_FEE,
        blockHeight: "200",
        blockTimestamp: new Date("2026-06-26T10:00:00.000Z"),
        confirmationsObserved: 21,
      };
      const confirmed = await paymentService.confirmPayment(context, {
        paymentId: detected.paymentId,
        settlement: buildSettlementEvidence(transfer, 20, new Date("2026-06-26T10:05:00.000Z")),
      });

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
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        updatedAt: confirmed.updatedAt,
      });

      expect(settlement.outcome).toBe("EXCEPTION");

      const cases = await db
        .select()
        .from(pgSchema.traderSettlementReconciliationCases)
        .where(eq(pgSchema.traderSettlementReconciliationCases.settlementId, settlement.id));
      expect(cases).toHaveLength(1);

      const events = await db
        .select()
        .from(pgSchema.traderSettlementReconciliationEvents)
        .where(eq(pgSchema.traderSettlementReconciliationEvents.caseId, cases[0]!.id));
      expect(events).toHaveLength(1);
      expect(events[0]?.eventType).toBe("CASE_OPENED");
    });

    it("reconciliation events are append-only", async () => {
      const db = getPostgresDrizzle();
      const event = await db.select().from(pgSchema.traderSettlementReconciliationEvents).limit(1);
      const row = event[0];
      if (!row) {
        return;
      }
      await expect(
        db
          .update(pgSchema.traderSettlementReconciliationEvents)
          .set({ eventType: "TAMPERED" })
          .where(eq(pgSchema.traderSettlementReconciliationEvents.id, row.id)),
      ).rejects.toThrow(/append-only/i);
    });

    it("backfill maintains one-case-per-EXCEPTION invariant", async () => {
      const db = getPostgresDrizzle();
      const context = requireOrgContext(orgA);
      const reader = createPostgresReconciliationReader(db);
      const caseRepository = createPostgresReconciliationCaseRepository(db);
      const evidenceReader = createPostgresReconciliationEvidenceReader(db);

      const result = await backfillExceptionCases(
        {
          caseRepository,
          evidenceReader,
          writeAudit: (input) => writeTraderAuditLogPostgres(db, input),
          reader,
        },
        context,
      );

      expect(result.processed).toBe(0);

      const exceptionCount = await db
        .select({ count: pgSchema.traderSettlements.id })
        .from(pgSchema.traderSettlements)
        .where(
          and(
            eq(pgSchema.traderSettlements.organizationId, orgA),
            eq(pgSchema.traderSettlements.outcome, "EXCEPTION"),
          ),
        );
      const caseCount = await db
        .select({ count: pgSchema.traderSettlementReconciliationCases.id })
        .from(pgSchema.traderSettlementReconciliationCases)
        .where(eq(pgSchema.traderSettlementReconciliationCases.organizationId, orgA));

      expect(exceptionCount.length).toBe(caseCount.length);
    });
  },
);
