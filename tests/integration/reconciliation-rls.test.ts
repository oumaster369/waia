/**
 * AT-E12 S3-C-B — reconciliation RLS alignment (opt-in Postgres).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import { ensureAuthUsersSeed } from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8022-00000003cb002";

describe.skipIf(!integrationEnabled || !url)("reconciliation RLS (AT-E12 S3-C-B)", () => {
  let orgA: string;
  let caseId: string;
  let settlementId: string;

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
    await ensureAuthUsersSeed(url!, [USER_A]);

    const db = getPostgresDrizzle();
    orgA = await ensureUserCoreSeedPostgres(db, {
      userId: USER_A,
      displayName: "Recon RLS User",
    });

    settlementId = crypto.randomUUID();
    caseId = crypto.randomUUID();
    const owner = postgres(url!, { max: 1 });
    try {
      await owner.unsafe(
        `INSERT INTO trader_settlements (
          id, organization_id, exchange_account_id, payment_id,
          settlement_network, settlement_tx_hash, transfer_index, block_height,
          asset, on_chain_amount, valued_amount, valuation_currency, valuation_basis,
          outcome, exception_reason, schema_version, record_content_digest, created_at
        ) VALUES (
          $1, $2, 'htx-rls', $3,
          'TRC-20', 'rls-tx', 0, '1',
          'USDT', '1', '1', 'USD', 'stablecoin_par',
          'EXCEPTION', 'AMOUNT_MISMATCH', 'waia.trader.settlement.v1', 'digest', NOW()
        )`,
        [settlementId, orgA, crypto.randomUUID()],
      );
      await owner.unsafe(
        `INSERT INTO trader_settlement_reconciliation_cases (
          id, organization_id, settlement_id, payment_id, exchange_account_id,
          exception_reason, status, priority, current_decision_id,
          last_event_seq, last_event_digest, opened_at
        ) VALUES (
          $1, $2, $3, $4, 'htx-rls',
          'AMOUNT_MISMATCH', 'OPEN', 10, $5,
          1, 'digest', NOW()
        )`,
        [caseId, orgA, settlementId, crypto.randomUUID(), crypto.randomUUID()],
      );
    } finally {
      await owner.end({ timeout: 5 });
    }
  });

  afterAll(async () => {
    await cleanup();
    resetPostgresSingletonForTests();
  });

  it("denies authenticated role SELECT on reconciliation cases (incl. current_decision_id)", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(`SET ROLE authenticated`);
      const rows = await sql.unsafe(
        `SELECT id, current_decision_id FROM trader_settlement_reconciliation_cases WHERE id = $1`,
        [caseId],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await sql.unsafe(`RESET ROLE`);
      await sql.end({ timeout: 5 });
    }
  });

  it("denies authenticated role INSERT on reconciliation events", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(`SET ROLE authenticated`);
      await expect(
        sql.unsafe(
          `INSERT INTO trader_settlement_reconciliation_events (
            id, organization_id, case_id, seq, event_type, actor_type, actor_id,
            payload, prev_event_digest, record_content_digest, schema_version, created_at
          ) VALUES (
            $1, $2, $3, 2, 'CASE_CLAIMED', 'user', $4,
            '{}', 'digest', 'digest2', 'waia.trader.settlement-reconciliation-event.v1', NOW()
          )`,
          [crypto.randomUUID(), orgA, caseId, USER_A],
        ),
      ).rejects.toThrow();
    } finally {
      await sql.unsafe(`RESET ROLE`);
      await sql.end({ timeout: 5 });
    }
  });

  it("denies authenticated role SELECT on settlement applications (incl. decision_id)", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(`SET ROLE authenticated`);
      const rows = await sql.unsafe(
        `SELECT id, decision_id FROM trader_settlement_applications WHERE settlement_id = $1`,
        [settlementId],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await sql.unsafe(`RESET ROLE`);
      await sql.end({ timeout: 5 });
    }
  });
});
