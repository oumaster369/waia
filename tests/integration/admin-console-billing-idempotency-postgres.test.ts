/**
 * Opt-in: WAIA_PG_INTEGRATION=1, WAIA_DB_BACKEND=postgres, DATABASE_URL_POSTGRES.
 * A second approve, issue, or close must not add another invoice, HWM row, or period.
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
import { ReportingPeriodNotOpenError } from "@/lib/trader/billing/reporting-period.errors";
import { traderAuditActions } from "@/lib/trader/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import { billingV2PeriodCloseEvidence } from "@/tests/helpers/billing-v2-period-close-evidence";
import {
  deleteHtrPostgresBillingArtifactsForOrg,
  seedHtrPostgresUser,
} from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const validateStack = process.env.WAIA_DB_BACKEND === "postgres";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_ID = "00000000-0000-4000-8022-000000031156";
const EXCHANGE_ACCOUNT_ID = "htx-paper-1053-pg";
const FIXED_AT = new Date("2026-06-30T12:00:00.000Z");
const COMPLETE_ATTESTATIONS = {
  depositsVerified: true,
  withdrawalsVerified: true,
  balanceSnapshotsVerified: true,
  reconciliationVerified: true,
  exchangeSyncVerified: true,
  realizedFillFinalityVerified: true,
};

describe.skipIf(!integrationEnabled || !validateStack || !url)(
  "admin console billing idempotency",
  () => {
    let orgId: string;

    async function cleanup(): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        const organizationId = personalOrganizationIdFromUserId(USER_ID);
        await deleteHtrPostgresBillingArtifactsForOrg(url!, organizationId);
        await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [
          organizationId,
        ]);
        await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [organizationId]);
        await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [USER_ID]);
        await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [USER_ID]);
        await sql.unsafe(`DELETE FROM users WHERE id = $1`, [USER_ID]);
        await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [USER_ID]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    beforeAll(async () => {
      await verifyHtrPostgresConnectionIdentity();
      await cleanup();
      orgId = await seedHtrPostgresUser(url!, USER_ID, "Admin console billing idempotency");
    });

    afterAll(async () => {
      await cleanup();
      await resetPostgresSingletonForTests();
    });

    it("keeps one invoice, one HWM row, and one period when the commands are repeated", async () => {
      const db = getPostgresDrizzle();
      const context = { ...requireOrgContext(orgId), userId: USER_ID };
      const hwm = createPostgresHwmLedgerService(db, {}, db);
      const lifecycle = createPostgresReportingPeriodLifecycleService(db, {}, db);
      const drafts = createPostgresDraftInvoiceService(db, {}, db);
      const periodStart = new Date("2026-02-01T00:00:00.000Z");
      const periodEnd = new Date("2026-02-28T23:59:59.000Z");

      await hwm.bootstrapHwm(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        initialHwm: "0",
        valuationSource: "paper_pnl_read_model.v1",
        effectiveAt: periodStart,
      });
      await lifecycle.openReportingPeriod(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        periodStart,
        startingEquity: "10000.00",
        openPositionsSnapshotRef: "paper-positions:feb",
        valuationSource: "paper_pnl_read_model.v1",
        startingSnapshotAt: new Date("2026-02-01T00:05:00.000Z"),
      });
      const closeInput = billingV2PeriodCloseEvidence({
        organizationId: orgId,
        accountId: EXCHANGE_ACCOUNT_ID,
        periodStart,
        periodEnd,
        realizedPnl: "100.00",
        unrealizedPnl: "0",
        endingEquity: "10100.00",
        endingSnapshotAt: new Date("2026-02-28T23:55:00.000Z"),
      });
      const closed = await lifecycle.closeReportingPeriod(context, closeInput);
      await expect(lifecycle.closeReportingPeriod(context, closeInput)).rejects.toBeInstanceOf(
        ReportingPeriodNotOpenError,
      );

      const draft = await drafts.generateDraftInvoice(context, {
        periodId: closed.id,
        computedAt: periodEnd,
      });
      const issueAt = new Date(FIXED_AT.getTime() + 120_000);
      const service = createPostgresInvoiceIssuanceService(db, { now: () => issueAt }, db);
      await service.approveInvoiceIssuance(context, {
        invoiceId: draft.id,
        attestations: COMPLETE_ATTESTATIONS,
        coolingOffMs: 60_000,
        approvedAt: FIXED_AT,
      });
      await service.approveInvoiceIssuance(context, {
        invoiceId: draft.id,
        attestations: COMPLETE_ATTESTATIONS,
        coolingOffMs: 60_000,
        approvedAt: FIXED_AT,
      });
      const issued = await service.issueInvoice(context, { invoiceId: draft.id });
      const repeated = await service.issueInvoice(context, { invoiceId: draft.id });
      expect(repeated.id).toBe(issued.id);
      expect(repeated.status).toBe("ISSUED");

      const sql = postgres(url!, { max: 1 });
      try {
        const invoices = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_invoices
        WHERE organization_id = ${orgId}::uuid
          AND exchange_account_id = ${EXCHANGE_ACCOUNT_ID}
      `;
        const periods = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_reporting_periods
        WHERE organization_id = ${orgId}::uuid
          AND exchange_account_id = ${EXCHANGE_ACCOUNT_ID}
      `;
        const hwmRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_hwm_ledger
        WHERE source_invoice_id = ${draft.id}
      `;
        const issuedAudits = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM audit_logs
        WHERE organization_id = ${orgId}
          AND action = ${traderAuditActions.invoiceIssued}
      `;
        expect(invoices[0]?.count).toBe("1");
        expect(periods[0]?.count).toBe("1");
        expect(hwmRows[0]?.count).toBe("1");
        expect(issuedAudits[0]?.count).toBe("1");
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
);
