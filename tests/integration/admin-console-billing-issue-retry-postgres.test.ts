import { createHistoricalPostgresLifecycleFixture } from "@/tests/helpers/historical-billing-lifecycle-fixture";
/**
 * Opt-in: WAIA_PG_INTEGRATION=1 and DATABASE_URL_POSTGRES on an isolated local port.
 * Refuses port 54329. Does not call verifyHtrPostgresConnectionIdentity.
 * A forced rollback inside issue must not leave a second invoice, HWM row, or audit.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import {
  createPerRequestPostgresRuntime,
  resetPostgresSingletonForTests,
} from "@/db/postgres-client";
import {
  createPostgresDraftInvoiceService,
  createPostgresHwmLedgerService,
  createPostgresInvoiceIssuanceService,
} from "@/lib/trader/billing";
import { traderAuditActions } from "@/lib/trader/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { billingV2PeriodCloseEvidence } from "@/tests/helpers/billing-v2-period-close-evidence";
import {
  deleteHtrPostgresBillingArtifactsForOrg,
  seedHtrPostgresUser,
} from "@/tests/integration/htr-postgres-fixture-prelude";

const USER_ID = "00000000-0000-4000-8022-000000031157";
const ROLLBACK_ACCOUNT = "htx-paper-1053-retry";
const RACE_ACCOUNT = "htx-paper-1053-race";
const FIXED_AT = new Date("2026-06-30T12:00:00.000Z");
const COMPLETE_ATTESTATIONS = {
  depositsVerified: true,
  withdrawalsVerified: true,
  balanceSnapshotsVerified: true,
  reconciliationVerified: true,
  exchangeSyncVerified: true,
  realizedFillFinalityVerified: true,
};

function isolatedUrl(): string | null {
  if (process.env.WAIA_PG_INTEGRATION !== "1") return null;
  const raw = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const port = parsed.port || "5432";
  if (port === "54329") return null;
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
  if (parsed.hostname.includes("supabase") || parsed.hostname.includes("pooler")) return null;
  return raw;
}

const url = isolatedUrl();

describe.skipIf(!url)("admin console billing issue retry after rollback", () => {
  let orgId: string;

  async function cleanup(): Promise<void> {
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(`DROP TRIGGER IF EXISTS waia_it_fail_hwm ON trader_hwm_ledger`);
      await sql.unsafe(`DROP FUNCTION IF EXISTS waia_it_fail_hwm()`);
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
    if (!url || new URL(url).port === "54329") {
      throw new Error("REFUSING_SHARED_VALIDATE_PORT");
    }
    await cleanup();
    orgId = await seedHtrPostgresUser(url!, USER_ID, "Admin console billing issue retry");
  });

  afterAll(async () => {
    await cleanup();
    await resetPostgresSingletonForTests();
  });

  async function draftInvoice(exchangeAccountId: string, periodStart: Date, periodEnd: Date) {
    const runtime = createPerRequestPostgresRuntime();
    try {
      const context = { ...requireOrgContext(orgId), userId: USER_ID };
      const hwm = createPostgresHwmLedgerService(runtime.db, {}, runtime.db);
      const lifecycle = createHistoricalPostgresLifecycleFixture(runtime.db);
      const drafts = createPostgresDraftInvoiceService(runtime.db, {}, runtime.db);
      await hwm.bootstrapHwm(context, {
        exchangeAccountId,
        initialHwm: "0",
        valuationSource: "paper_pnl_read_model.v1",
        effectiveAt: periodStart,
      });
      await lifecycle.openReportingPeriod(context, {
        exchangeAccountId,
        periodStart,
        startingEquity: "10000.00",
        openPositionsSnapshotRef: "paper-positions:retry",
        valuationSource: "paper_pnl_read_model.v1",
        startingSnapshotAt: new Date(periodStart.getTime() + 5 * 60 * 1000),
      });
      const closed = await lifecycle.closeReportingPeriod(
        context,
        billingV2PeriodCloseEvidence({
          organizationId: orgId,
          accountId: exchangeAccountId,
          periodStart,
          periodEnd,
          realizedPnl: "100.00",
          unrealizedPnl: "0",
          endingEquity: "10100.00",
          endingSnapshotAt: new Date(periodEnd.getTime() - 5 * 60 * 1000),
        }),
      );
      const draft = await drafts.generateDraftInvoice(context, {
        periodId: closed.id,
        computedAt: periodEnd,
      });
      const service = createPostgresInvoiceIssuanceService(
        runtime.db,
        { now: () => new Date(FIXED_AT.getTime() + 120_000) },
        runtime.db,
      );
      await service.approveInvoiceIssuance(context, {
        invoiceId: draft.id,
        attestations: COMPLETE_ATTESTATIONS,
        coolingOffMs: 60_000,
        approvedAt: FIXED_AT,
      });
      return draft.id;
    } finally {
      await runtime._sql.end({ timeout: 5 });
    }
  }

  async function counts(exchangeAccountId: string, invoiceId: string) {
    const sql = postgres(url!, { max: 1 });
    try {
      const invoices = await sql<{ count: string; status: string | null }[]>`
        SELECT count(*)::text AS count, max(status) AS status
        FROM trader_invoices
        WHERE organization_id = ${orgId}::uuid
          AND exchange_account_id = ${exchangeAccountId}
      `;
      const hwmRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_hwm_ledger
        WHERE source_invoice_id = ${invoiceId}
          AND entry_type = 'RATCHET_UP'
      `;
      const periods = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM trader_reporting_periods
        WHERE organization_id = ${orgId}::uuid
          AND exchange_account_id = ${exchangeAccountId}
      `;
      const issuedAudits = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM audit_logs
        WHERE organization_id = ${orgId}
          AND action = ${traderAuditActions.invoiceIssued}
          AND entity_id = ${invoiceId}
      `;
      return {
        invoices: invoices[0]?.count ?? "0",
        status: invoices[0]?.status ?? null,
        hwm: hwmRows[0]?.count ?? "0",
        periods: periods[0]?.count ?? "0",
        audits: issuedAudits[0]?.count ?? "0",
      };
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  it("retries issue after a mid-transaction rollback and races two issuers into one invoice", async () => {
    const rollbackId = await draftInvoice(
      ROLLBACK_ACCOUNT,
      new Date("2026-03-01T00:00:00.000Z"),
      new Date("2026-03-31T23:59:59.000Z"),
    );
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(`
        CREATE OR REPLACE FUNCTION waia_it_fail_hwm() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'WAIA_IT_FORCED_ROLLBACK';
        END;
        $$
      `);
      await sql.unsafe(
        `CREATE TRIGGER waia_it_fail_hwm BEFORE INSERT ON trader_hwm_ledger FOR EACH ROW EXECUTE FUNCTION waia_it_fail_hwm()`,
      );
    } finally {
      await sql.end({ timeout: 5 });
    }

    const failing = createPerRequestPostgresRuntime();
    const context = { ...requireOrgContext(orgId), userId: USER_ID };
    await expect(
      createPostgresInvoiceIssuanceService(
        failing.db,
        { now: () => new Date(FIXED_AT.getTime() + 120_000) },
        failing.db,
      ).issueInvoice(context, { invoiceId: rollbackId }),
    ).rejects.toThrow(/WAIA_IT_FORCED_ROLLBACK/);
    await failing._sql.end({ timeout: 5 });

    const dropped = postgres(url!, { max: 1 });
    try {
      await dropped.unsafe(`DROP TRIGGER IF EXISTS waia_it_fail_hwm ON trader_hwm_ledger`);
      await dropped.unsafe(`DROP FUNCTION IF EXISTS waia_it_fail_hwm()`);
    } finally {
      await dropped.end({ timeout: 5 });
    }

    const rolledBack = await counts(ROLLBACK_ACCOUNT, rollbackId);
    expect(rolledBack).toMatchObject({
      invoices: "1",
      status: "DRAFT",
      hwm: "0",
      periods: "1",
      audits: "0",
    });

    const retry = createPerRequestPostgresRuntime();
    const issued = await createPostgresInvoiceIssuanceService(
      retry.db,
      { now: () => new Date(FIXED_AT.getTime() + 120_000) },
      retry.db,
    ).issueInvoice(context, { invoiceId: rollbackId });
    await retry._sql.end({ timeout: 5 });
    expect(issued.status).toBe("ISSUED");
    expect(await counts(ROLLBACK_ACCOUNT, rollbackId)).toMatchObject({
      invoices: "1",
      status: "ISSUED",
      hwm: "1",
      periods: "1",
      audits: "1",
    });

    const raceId = await draftInvoice(
      RACE_ACCOUNT,
      new Date("2026-04-01T00:00:00.000Z"),
      new Date("2026-04-30T23:59:59.000Z"),
    );
    const left = createPerRequestPostgresRuntime();
    const right = createPerRequestPostgresRuntime();
    let raceError: unknown = null;
    try {
      await Promise.all([
        createPostgresInvoiceIssuanceService(
          left.db,
          { now: () => new Date(FIXED_AT.getTime() + 120_000) },
          left.db,
        ).issueInvoice(context, { invoiceId: raceId }),
        createPostgresInvoiceIssuanceService(
          right.db,
          { now: () => new Date(FIXED_AT.getTime() + 120_000) },
          right.db,
        ).issueInvoice(context, { invoiceId: raceId }),
      ]);
    } catch (error) {
      raceError = error;
    } finally {
      await left._sql.end({ timeout: 5 });
      await right._sql.end({ timeout: 5 });
    }
    const raced = await counts(RACE_ACCOUNT, raceId);
    if (
      raced.invoices !== "1" ||
      raced.hwm !== "1" ||
      raced.audits !== "1" ||
      raced.status !== "ISSUED"
    ) {
      throw new Error(
        `BILLING_DUPLICATE_AFTER_PARALLEL_ISSUE invoices=${raced.invoices} hwm=${raced.hwm} audits=${raced.audits} status=${raced.status} error=${raceError instanceof Error ? raceError.message : "none"}`,
      );
    }
    expect(raced.periods).toBe("1");
  }, 120_000);
});
