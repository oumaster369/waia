import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { advanceAccountingFrontier } from "@/lib/trader/accounting";
import {
  applyDrawdownCheckpointToBridge,
  createHtrAccountingCycleBridge,
  hydrateBridgeDrawdownFromPersistence,
  persistDrawdownCycleAfterGuardian,
  createDrawdownPersistenceSession,
  restoreAccountingBridgeFromCheckpoint,
  toAccountingCheckpointSlice,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import {
  buildAccountDrawdownCheckpointFromBridgeState,
  createAccountDrawdownRepositoryPostgres,
  createHtrDrawdownPersistencePortPostgres,
} from "@/lib/trader/risk/account-drawdown-repository-postgres";
import {
  buildStrategyDrawdownCheckpointsFromBridgeState,
  createStrategyDrawdownRepositoryPostgres,
} from "@/lib/trader/risk/strategy-drawdown-repository-postgres";
import { buildStrategyAttributionKey } from "@/lib/trader/risk/strategy-attribution";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
} from "@/lib/trader/intelligence/types";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import {
  BTC_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

const CA1_PG_USER_A = "00000000-0000-4000-8000-0000000415a3";
const CA1_PG_USER_B = "00000000-0000-4000-8000-0000000415a4";

const ACCOUNT_KEY = "corrective-a1-pg-acct";
const PORTFOLIO_ID = "corrective-a1-pg-portfolio";
const RUN_ID = "corrective-a1-pg-run";

const LSR_KEY = buildStrategyAttributionKey(
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
);
const MR_KEY = buildStrategyAttributionKey(MEAN_REVERSION_V0, MEAN_REVERSION_V0_VERSION);

const RLS_DENIED_SQLSTATE = "42501";

async function seedUser(url: string, userId: string, displayName: string): Promise<string> {
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

async function disableMutationTriggers(sql: postgres.Sql): Promise<void> {
  for (const table of [
    "trader_strategy_lifecycle_event",
    "trader_strategy_trial",
    "trader_account_drawdown_checkpoint",
    "trader_strategy_drawdown_checkpoint",
  ]) {
    await sql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_block_delete`);
  }
}

async function enableMutationTriggers(sql: postgres.Sql): Promise<void> {
  for (const table of [
    "trader_strategy_lifecycle_event",
    "trader_strategy_trial",
    "trader_account_drawdown_checkpoint",
    "trader_strategy_drawdown_checkpoint",
  ]) {
    await sql.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_block_delete`);
  }
}

async function cleanupOrg(url: string, userId: string): Promise<void> {
  const orgId = personalOrganizationIdFromUserId(userId);
  const sql = postgres(url, { max: 1 });
  try {
    await disableMutationTriggers(sql);
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
    await enableMutationTriggers(sql);
    await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await sql.unsafe(`DELETE FROM users WHERE id = $1`, [userId]);
    await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [userId]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cleanupRows(url: string, organizationId: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await disableMutationTriggers(sql);
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
    await enableMutationTriggers(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function buildBridgeFromOrg(orgId: string) {
  const bridge = createHtrAccountingCycleBridge({
    organizationId: orgId,
    accountKey: ACCOUNT_KEY,
    runId: RUN_ID,
  });
  const fill = makeAccountingEconomicsFill("buy");
  bridge.state = advanceAccountingFrontier({
    state: bridge.state,
    fill,
    marks: { BTCUSDT: BTC_MARK },
    frontierAsOf: fill.executedAt,
  });
  return bridge;
}

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader corrective-a1 drawdown parity (DEE-415 / G1)",
  () => {
    let orgA: string;
    let orgB: string;

    beforeAll(async () => {
      await cleanupOrg(url!, CA1_PG_USER_A);
      await cleanupOrg(url!, CA1_PG_USER_B);
      orgA = await seedUser(url!, CA1_PG_USER_A, "C-A1 Drawdown Parity A");
      orgB = await seedUser(url!, CA1_PG_USER_B, "C-A1 Drawdown Parity B");
    });

    beforeEach(async () => {
      await cleanupRows(url!, orgA);
      await cleanupRows(url!, orgB);
    });

    afterAll(async () => {
      await cleanupOrg(url!, CA1_PG_USER_A);
      await cleanupOrg(url!, CA1_PG_USER_B);
      resetPostgresSingletonForTests();
    });

    it("0094 and 0096 rows match in-memory bridge drawdown state", async () => {
      const db = getPostgresDrizzle();
      const accountRepo = createAccountDrawdownRepositoryPostgres(db);
      const strategyRepo = createStrategyDrawdownRepositoryPostgres(db);
      const context = { organizationId: orgA };
      const bridge = buildBridgeFromOrg(orgA);
      const seq = bridge.state.accountingSequence;

      const accountInput = buildAccountDrawdownCheckpointFromBridgeState({
        state: bridge.state,
        portfolioId: PORTFOLIO_ID,
        seq,
        id: "00000000-0000-4000-8000-000000000a01",
        breachState: "NONE",
      });
      await accountRepo.append(context, accountInput);

      const strategyInputs = buildStrategyDrawdownCheckpointsFromBridgeState({
        state: bridge.state,
        portfolioId: PORTFOLIO_ID,
        seqByKey: { [LSR_KEY]: seq, [MR_KEY]: seq },
        idFactory: (key) =>
          key === LSR_KEY
            ? "00000000-0000-4000-8000-000000000a02"
            : "00000000-0000-4000-8000-000000000a03",
        breachState: "NONE",
      });
      for (const row of strategyInputs) {
        await strategyRepo.append(context, row);
      }

      const loadedAccount = await accountRepo.loadLatest(context, {
        accountKey: ACCOUNT_KEY,
        portfolioId: PORTFOLIO_ID,
        runId: RUN_ID,
      });
      expect(loadedAccount?.accountPeakHwm).toBe(bridge.state.equityHwm);
      expect(loadedAccount?.monthlyPeakHwm).toBe(bridge.state.monthlyPeakHwm);
      expect(loadedAccount?.accountDrawdownBps).toBe(bridge.state.accountDrawdownBps);
      expect(loadedAccount?.monthlyDrawdownBps).toBe(bridge.state.monthlyDrawdownBps);

      const loadedLsr = await strategyRepo.loadLatest(context, {
        accountKey: ACCOUNT_KEY,
        portfolioId: PORTFOLIO_ID,
        runId: RUN_ID,
        strategyId: LIQUIDITY_SWEEP_REVERSAL_V0,
        strategyVersion: LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
      });
      expect(loadedLsr?.strategyPeakHwm).toBe(bridge.state.strategyPeakHwmByKey[LSR_KEY]);
      expect(loadedLsr?.strategyDrawdownBps).toBe(
        bridge.state.strategyDrawdownBpsByKey[LSR_KEY] ?? 0,
      );
    });

    it("RLS org isolation prevents cross-tenant drawdown reads", async () => {
      const db = getPostgresDrizzle();
      const accountRepo = createAccountDrawdownRepositoryPostgres(db);
      await accountRepo.append(
        { organizationId: orgA },
        buildAccountDrawdownCheckpointFromBridgeState({
          state: buildBridgeFromOrg(orgA).state,
          portfolioId: PORTFOLIO_ID,
          seq: 1,
          id: "00000000-0000-4000-8000-000000000b01",
          breachState: "NONE",
        }),
      );

      const crossOrgLatest = await accountRepo.loadLatest(
        { organizationId: orgB },
        { accountKey: ACCOUNT_KEY, portfolioId: PORTFOLIO_ID, runId: RUN_ID },
      );
      expect(crossOrgLatest).toBeNull();

      const sql = postgres(url!, { max: 1 });
      try {
        await sql.unsafe(`SET ROLE authenticated`);
        await expect(
          sql.unsafe(`SELECT id FROM trader_account_drawdown_checkpoint LIMIT 1`),
        ).rejects.toMatchObject({ code: RLS_DENIED_SQLSTATE });
      } finally {
        await sql.unsafe(`RESET ROLE`);
        await sql.end({ timeout: 5 });
      }
    });

    it("resume from DB checkpoint restores bridge drawdown fields", async () => {
      const db = getPostgresDrizzle();
      const accountRepo = createAccountDrawdownRepositoryPostgres(db);
      const context = { organizationId: orgA };
      const bridge = buildBridgeFromOrg(orgA);
      const slice = toAccountingCheckpointSlice(bridge);

      await accountRepo.append(
        context,
        buildAccountDrawdownCheckpointFromBridgeState({
          state: bridge.state,
          portfolioId: PORTFOLIO_ID,
          seq: bridge.state.accountingSequence,
          id: "00000000-0000-4000-8000-000000000c01",
          breachState: "NONE",
        }),
      );
      const strategyRepo = createStrategyDrawdownRepositoryPostgres(db);
      for (const row of buildStrategyDrawdownCheckpointsFromBridgeState({
        state: bridge.state,
        portfolioId: PORTFOLIO_ID,
        seqByKey: {
          [LSR_KEY]: bridge.state.accountingSequence,
          [MR_KEY]: bridge.state.accountingSequence,
        },
        idFactory: (key) =>
          key === LSR_KEY
            ? "00000000-0000-4000-8000-000000000c02"
            : "00000000-0000-4000-8000-000000000c03",
        breachState: "NONE",
      })) {
        await strategyRepo.append(context, row);
      }

      const loaded = await accountRepo.loadLatest(context, {
        accountKey: ACCOUNT_KEY,
        portfolioId: PORTFOLIO_ID,
        runId: RUN_ID,
      });
      expect(loaded).not.toBeNull();

      const restarted = createHtrAccountingCycleBridge({
        organizationId: orgA,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
      });
      restoreAccountingBridgeFromCheckpoint(restarted, slice);
      const port = createHtrDrawdownPersistencePortPostgres({
        db,
        context,
        portfolioId: PORTFOLIO_ID,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
        resumeMode: "resumable",
        newCheckpointId: ({ kind, seq }) =>
          `00000000-0000-4000-8000-${kind === "account" ? "c02" : "c03"}${String(seq).padStart(6, "0")}`,
      });
      await hydrateBridgeDrawdownFromPersistence(restarted, port);

      expect(restarted.state.equityHwm).toBe(loaded!.accountPeakHwm);
      expect(restarted.state.monthlyPeakHwm).toBe(loaded!.monthlyPeakHwm);
      expect(restarted.state.accountDrawdownBps).toBe(loaded!.accountDrawdownBps);
      expect(restarted.state.monthlyDrawdownBps).toBe(loaded!.monthlyDrawdownBps);
    });

    it("append-only trigger enforcement blocks UPDATE and DELETE on 0094/0096", async () => {
      const db = getPostgresDrizzle();
      const accountRepo = createAccountDrawdownRepositoryPostgres(db);
      const context = { organizationId: orgA };
      const accountCheckpointId = "00000000-0000-4000-8000-000000000d01";
      const stored = await accountRepo.append(
        context,
        buildAccountDrawdownCheckpointFromBridgeState({
          state: buildBridgeFromOrg(orgA).state,
          portfolioId: PORTFOLIO_ID,
          seq: 1,
          id: accountCheckpointId,
          breachState: "NONE",
        }),
      );
      void stored;

      const sql = postgres(url!, { max: 1 });
      try {
        await expect(
          sql.unsafe(
            `UPDATE trader_account_drawdown_checkpoint SET equity_usdt = '1' WHERE id = $1`,
            [accountCheckpointId],
          ),
        ).rejects.toThrow(/append-only/i);
        await expect(
          sql.unsafe(`DELETE FROM trader_account_drawdown_checkpoint WHERE id = $1`, [
            accountCheckpointId,
          ]),
        ).rejects.toThrow(/append-only/i);

        const strategyCheckpointId = "00000000-0000-4000-8000-000000000d02";
        const strategyRepo = createStrategyDrawdownRepositoryPostgres(db);
        const strategyStored = await strategyRepo.append(
          context,
          buildStrategyDrawdownCheckpointsFromBridgeState({
            state: buildBridgeFromOrg(orgA).state,
            portfolioId: PORTFOLIO_ID,
            seqByKey: { [LSR_KEY]: 1 },
            idFactory: () => strategyCheckpointId,
            breachState: "NONE",
          })[0]!,
        );
        void strategyStored;
        await expect(
          sql.unsafe(
            `UPDATE trader_strategy_drawdown_checkpoint SET strategy_equity_usdt = '1' WHERE id = $1`,
            [strategyCheckpointId],
          ),
        ).rejects.toThrow(/append-only/i);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
);
