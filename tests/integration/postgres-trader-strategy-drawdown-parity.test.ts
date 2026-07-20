import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { createStrategyDrawdownRepositoryPostgres } from "@/lib/trader/risk/strategy-drawdown-repository-postgres";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

const WP16_PG_USER_A = "00000000-0000-4000-8000-000000041601";

async function seedWp16User(url: string, userId: string, displayName: string): Promise<string> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
      userId,
    ]);
  } finally {
    await sql.end({ timeout: 5 });
  }
  const db = getPostgresDrizzle();
  const existing = await db
    .select()
    .from(pgSchema.users)
    .where(eq(pgSchema.users.id, userId))
    .limit(1);
  if (!existing[0]) {
    await db.insert(pgSchema.users).values({
      id: userId,
      identityLabel: displayName,
      email: `${userId}@waia.invalid`,
      passwordHash: null,
    });
  }
  return ensureUserCoreSeedPostgres(db, { userId, displayName });
}

async function disableWp16MutationTriggers(sql: postgres.Sql): Promise<void> {
  for (const table of [
    "trader_strategy_lifecycle_event",
    "trader_strategy_trial",
    "trader_account_drawdown_checkpoint",
    "trader_strategy_drawdown_checkpoint",
  ]) {
    await sql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
  }
}

async function enableWp16MutationTriggers(sql: postgres.Sql): Promise<void> {
  for (const table of [
    "trader_strategy_lifecycle_event",
    "trader_strategy_trial",
    "trader_account_drawdown_checkpoint",
    "trader_strategy_drawdown_checkpoint",
  ]) {
    await sql.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
  }
}

async function cleanupWp16Org(url: string, userId: string): Promise<void> {
  const orgId = personalOrganizationIdFromUserId(userId);
  const sql = postgres(url, { max: 1 });
  try {
    await disableWp16MutationTriggers(sql);
    await sql.unsafe(`DELETE FROM trader_strategy_drawdown_checkpoint WHERE organization_id = $1`, [
      orgId,
    ]);
    await sql.unsafe(`DELETE FROM trader_account_drawdown_checkpoint WHERE organization_id = $1`, [
      orgId,
    ]);
    await sql.unsafe(`DELETE FROM trader_strategy_trial WHERE organization_id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM trader_strategy_lifecycle_event WHERE organization_id = $1`, [
      orgId,
    ]);
    await enableWp16MutationTriggers(sql);
    await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM users WHERE id = $1`, [userId]);
    await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [userId]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cleanupWp16Rows(url: string, organizationId: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await disableWp16MutationTriggers(sql);
    await sql.unsafe(`DELETE FROM trader_strategy_drawdown_checkpoint WHERE organization_id = $1`, [
      organizationId,
    ]);
    await sql.unsafe(`DELETE FROM trader_account_drawdown_checkpoint WHERE organization_id = $1`, [
      organizationId,
    ]);
    await sql.unsafe(`DELETE FROM trader_strategy_trial WHERE organization_id = $1`, [
      organizationId,
    ]);
    await sql.unsafe(`DELETE FROM trader_strategy_lifecycle_event WHERE organization_id = $1`, [
      organizationId,
    ]);
    await enableWp16MutationTriggers(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader strategy drawdown parity (DEE-415 / HTR-WP16)",
  () => {
    let orgA: string;

    beforeAll(async () => {
      await cleanupWp16Org(url!, WP16_PG_USER_A);
      orgA = await seedWp16User(url!, WP16_PG_USER_A, "WP16 Strategy Drawdown Parity");
    });

    beforeEach(async () => {
      await cleanupWp16Rows(url!, orgA);
    });

    afterAll(async () => {
      await cleanupWp16Org(url!, WP16_PG_USER_A);
      resetPostgresSingletonForTests();
    });

    it("persists per-strategy drawdown checkpoints in separate table", async () => {
      const db = getPostgresDrizzle();
      const repo = createStrategyDrawdownRepositoryPostgres(db);
      const context = { organizationId: orgA };
      await repo.append(context, {
        id: "00000000-0000-4000-8000-000000000401",
        accountKey: "acct",
        portfolioId: "portfolio",
        runId: "wp16-sdd-run",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        seq: 1,
        asOf: "2026-01-01T00:00:00.000Z",
        strategyAllocationUsdt: "50000",
        strategyEquityUsdt: "45000",
        strategyPeakHwm: "50000",
        strategyDrawdownBps: 1000,
        breachState: "NONE",
      });

      const rows = await db
        .select()
        .from(pgSchema.traderStrategyDrawdownCheckpoint)
        .where(eq(pgSchema.traderStrategyDrawdownCheckpoint.organizationId, orgA));
      expect(rows).toHaveLength(1);
      const latest = await repo.loadLatest(context, {
        accountKey: "acct",
        portfolioId: "portfolio",
        runId: "wp16-sdd-run",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
      });
      expect(latest?.strategyAllocationUsdt).toBe("50000");
    });
  },
);
