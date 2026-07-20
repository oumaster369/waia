/**
 * DEE-311 — Invoice issuance repository Postgres parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import {
  createPostgresDraftInvoiceService,
  createPostgresHwmLedgerService,
  createPostgresInvoiceIssuanceService,
  createPostgresReportingPeriodLifecycleService,
} from "@/lib/trader/billing";
import { traderAuditActions } from "@/lib/trader/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import {
  deleteHtrPostgresBillingArtifactsForOrg,
  seedHtrPostgresUser,
} from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8022-000000031101";
const EXCHANGE_ACCOUNT_ID = "htx-paper-311-pg";
const FIXED_AT = new Date("2026-06-30T12:00:00.000Z");
const COMPLETE_ATTESTATIONS = {
  depositsVerified: true,
  withdrawalsVerified: true,
  balanceSnapshotsVerified: true,
  reconciliationVerified: true,
  exchangeSyncVerified: true,
  realizedFillFinalityVerified: true,
};

describe.skipIf(!integrationEnabled || !url)(
  "postgres invoice issuance parity (DEE-311 S6)",
  () => {
    let orgA: string;
    let draftService: ReturnType<typeof createPostgresDraftInvoiceService>;
    let lifecycleService: ReturnType<typeof createPostgresReportingPeriodLifecycleService>;
    let hwmService: ReturnType<typeof createPostgresHwmLedgerService>;

    async function cleanup(): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        const orgId = personalOrganizationIdFromUserId(USER_A);
        await deleteHtrPostgresBillingArtifactsForOrg(url!, orgId);
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
      orgA = await seedHtrPostgresUser(url!, USER_A, "Invoice Issuance Postgres Parity");

      const db = getPostgresDrizzle();

      draftService = createPostgresDraftInvoiceService(db, {}, db);
      lifecycleService = createPostgresReportingPeriodLifecycleService(db, {}, db);
      hwmService = createPostgresHwmLedgerService(db, {}, db);
    });

    afterAll(async () => {
      await cleanup();
      resetPostgresSingletonForTests();
    });

    it("approves and issues with atomic HWM ratchet", async () => {
      const context = { ...requireOrgContext(orgA), userId: USER_A };
      const operatorContext = { ...requireOrgContext(orgA), userId: USER_A };

      await hwmService.bootstrapHwm(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        initialHwm: "0",
        valuationSource: "paper_pnl_read_model.v1",
        effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      await lifecycleService.openReportingPeriod(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        periodStart: new Date("2026-01-01T00:00:00.000Z"),
        startingEquity: "10000.00",
        openPositionsSnapshotRef: "paper-positions:jan",
        valuationSource: "paper_pnl_read_model.v1",
        startingSnapshotAt: new Date("2026-01-01T00:05:00.000Z"),
      });

      const periodEnd = new Date("2026-01-28T23:59:59.000Z");
      const closed = await lifecycleService.closeReportingPeriod(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        periodEnd,
        endingEquity: "10100.00",
        endingSnapshotAt: new Date("2026-01-28T23:55:00.000Z"),
        realizedPnl: "100.00",
        unrealizedPnl: "0",
      });

      const draft = await draftService.generateDraftInvoice(context, {
        periodId: closed.id,
        computedAt: periodEnd,
      });

      const approvedAt = FIXED_AT;
      const issueAt = new Date(approvedAt.getTime() + 120_000);
      const service = createPostgresInvoiceIssuanceService(
        getPostgresDrizzle(),
        { now: () => issueAt },
        getPostgresDrizzle(),
      );

      const approved = await service.approveInvoiceIssuance(operatorContext, {
        invoiceId: draft.id,
        attestations: COMPLETE_ATTESTATIONS,
        coolingOffMs: 60_000,
        approvedAt,
      });
      expect(approved.status).toBe("DRAFT");

      const issued = await service.issueInvoice(operatorContext, { invoiceId: draft.id });
      expect(issued.status).toBe("ISSUED");
      expect(issued.proposedNewHighWaterMark).toBe("100");

      const currentHwm = await hwmService.getCurrentHwm(context, EXCHANGE_ACCOUNT_ID);
      expect(currentHwm?.highWaterMark).toBe("100");
      expect(currentHwm?.sourceInvoiceId).toBe(draft.id);

      const sql = postgres(url!, { max: 1 });
      try {
        const issuedAudits = await sql.unsafe(
          `SELECT action FROM audit_logs WHERE organization_id = $1 AND action = $2`,
          [orgA, traderAuditActions.invoiceIssued],
        );
        expect(issuedAudits.length).toBe(1);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
);
