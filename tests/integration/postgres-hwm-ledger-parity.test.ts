/**
 * DEE-307 — HWM ledger repository Postgres parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import {
  createPostgresHwmLedgerService,
  HwmLedgerAlreadyBootstrappedError,
  HwmLedgerRatchetNotAllowedError,
  verifyHwmLedgerRecordDigest,
} from "@/lib/trader/billing";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8000-0000000307p1";
const EXCHANGE_ACCOUNT_ID = "htx-paper-307-pg";

const BOOTSTRAP_AT = new Date("2026-06-01T00:00:00.000Z");
const RATCHET_AT = new Date("2026-06-30T23:59:59.000Z");
const ROLLBACK_AT = new Date("2026-07-01T00:00:00.000Z");

describe.skipIf(!integrationEnabled || !url)("postgres HWM ledger parity (DEE-307 S3)", () => {
  let orgA: string;
  let service: ReturnType<typeof createPostgresHwmLedgerService>;

  async function cleanup(): Promise<void> {
    const sql = postgres(url!, { max: 1 });
    try {
      const orgId = personalOrganizationIdFromUserId(USER_A);
      await sql.unsafe(`DELETE FROM trader_hwm_ledger WHERE organization_id = $1`, [orgId]);
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

  beforeAll(async () => {
    await cleanup();
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
        USER_A,
      ]);
    } finally {
      await sql.end({ timeout: 5 });
    }

    const db = getPostgresDrizzle();
    orgA = await ensureUserCoreSeedPostgres(db, {
      userId: USER_A,
      displayName: "HWM Ledger Postgres Parity",
    });
    service = createPostgresHwmLedgerService(db, {}, db);
  });

  afterAll(async () => {
    await cleanup();
    resetPostgresSingletonForTests();
  });

  it("bootstraps, ratchets, rolls back, and lists with digest verification", async () => {
    const context = requireOrgContext(orgA);

    const bootstrapped = await service.bootstrapHwm(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      initialHwm: "10000.00",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: BOOTSTRAP_AT,
    });
    expect(bootstrapped.entryType).toBe("BOOTSTRAP");
    verifyHwmLedgerRecordDigest(bootstrapped);

    await expect(
      service.bootstrapHwm(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        initialHwm: "10000.00",
        valuationSource: "paper_pnl_read_model.v1",
        effectiveAt: BOOTSTRAP_AT,
      }),
    ).rejects.toThrow(HwmLedgerAlreadyBootstrappedError);

    const ratcheted = await service.recordHwmRatchet(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      newHwm: "12000.00",
      sourcePeriodId: "period-pg-307",
      valuationSource: "paper_pnl_read_model.v1",
      effectiveAt: RATCHET_AT,
    });
    expect(ratcheted.previousHighWaterMark).toBe("10000.00");
    verifyHwmLedgerRecordDigest(ratcheted);

    await expect(
      service.recordHwmRatchet(context, {
        exchangeAccountId: EXCHANGE_ACCOUNT_ID,
        newHwm: "11000.00",
        sourcePeriodId: "period-pg-307-lower",
        valuationSource: "paper_pnl_read_model.v1",
        effectiveAt: RATCHET_AT,
      }),
    ).rejects.toThrow(HwmLedgerRatchetNotAllowedError);

    const rolledBack = await service.recordHwmRollback(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
      restoredHwm: "10000.00",
      sourcePeriodId: "period-pg-307-overcharge",
      reason: "Overcharge remediation",
      effectiveAt: ROLLBACK_AT,
    });
    expect(rolledBack.entryType).toBe("ROLLBACK");
    verifyHwmLedgerRecordDigest(rolledBack);

    const current = await service.getCurrentHwm(context, EXCHANGE_ACCOUNT_ID);
    expect(current?.highWaterMark).toBe("10000.00");

    const entries = await service.listHwmLedger(context, {
      exchangeAccountId: EXCHANGE_ACCOUNT_ID,
    });
    expect(entries).toHaveLength(3);
  });
});
