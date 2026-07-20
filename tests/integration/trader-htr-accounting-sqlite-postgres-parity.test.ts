/**
 * DEE-415 / HTR-WP18 — memory vs Postgres accounting frontier semantic parity (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import {
  advanceAccountingFrontier,
  computeAccountingSemanticDigest,
  createAccountingFrontierRepositoryMemory,
  createAccountingFrontierRepositoryPostgres,
  createInitialAccountingState,
  type AccountingFrontierV1,
  type AccountingStateV1,
} from "@/lib/trader/accounting";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  BTC_MARK,
  ETH_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-0000000418d1";

const ACCOUNT_KEY = "htr-memory-pg-parity";
const RUN_ID = "htr-memory-pg-run-1";

function forPostgresAppend(frontier: AccountingFrontierV1): AccountingFrontierV1 {
  return { ...frontier, sourceFillId: null };
}

function frontierToState(frontier: AccountingFrontierV1): AccountingStateV1 {
  const {
    id: _id,
    sourceFillId: _sourceFillId,
    sourceEconomicsDigest: _sourceEconomicsDigest,
    semanticContentDigest: _semanticContentDigest,
    idempotencyKey: _idempotencyKey,
    ...state
  } = frontier;
  return state;
}

function buildScenarioFrontier(organizationId: string): AccountingFrontierV1 {
  const buyBtc = makeAccountingEconomicsFill("buy");
  const buyEth = makeAccountingEconomicsFill("buy", {
    symbol: "ETHUSDT",
    grossFillPrice: "3000",
    sliceQuantity: "1.00000000",
    fillTimestamp: new Date("2026-01-01T00:02:59.999Z"),
  });

  const state = createInitialAccountingState({
    organizationId,
    accountKey: ACCOUNT_KEY,
    runId: RUN_ID,
  });
  const afterBtc = advanceAccountingFrontier({
    state,
    fill: buyBtc,
    marks: { BTCUSDT: BTC_MARK },
    frontierAsOf: buyBtc.executedAt,
  });
  return advanceAccountingFrontier({
    state: frontierToState(afterBtc),
    fill: buyEth,
    marks: { BTCUSDT: BTC_MARK, ETHUSDT: ETH_MARK },
    frontierAsOf: buyEth.executedAt,
  });
}

describe.skipIf(!integrationEnabled || !url)(
  "trader HTR accounting memory vs postgres semantic parity (DEE-415 / HTR-WP18)",
  () => {
    let orgA: string;
    let memoryRepo: ReturnType<typeof createAccountingFrontierRepositoryMemory>;
    let pgRepo: ReturnType<typeof createAccountingFrontierRepositoryPostgres>;

    async function cleanup(): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        const orgId = orgA;
        await sql.unsafe(`ALTER TABLE trader_accounting_frontier DISABLE TRIGGER USER`);
        await sql.unsafe(`DELETE FROM trader_accounting_frontier WHERE organization_id = $1`, [
          orgId,
        ]);
        await sql.unsafe(`ALTER TABLE trader_accounting_frontier ENABLE TRIGGER USER`);
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    beforeAll(async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
          USER_A,
        ]);
        await sql.unsafe(
          `INSERT INTO users (id, identity_label, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [USER_A, "wp18-memory-pg-parity", "wp18-memory-pg-parity@example.com"],
        );
      } finally {
        await sql.end({ timeout: 5 });
      }

      const db = getPostgresDrizzle();
      orgA = await ensureUserCoreSeedPostgres(db, {
        userId: USER_A,
        displayName: "WP18 Memory PG Parity",
      });
      memoryRepo = createAccountingFrontierRepositoryMemory();
      pgRepo = createAccountingFrontierRepositoryPostgres(db);
    });

    beforeEach(async () => {
      await cleanup();
      memoryRepo = createAccountingFrontierRepositoryMemory();
    });

    afterAll(async () => {
      if (orgA) {
        await cleanup();
      }
      resetPostgresSingletonForTests();
    });

    it("memory and postgres agree on semantic digest for identical frontier input", async () => {
      const context = requireOrgContext(orgA);
      const frontier = buildScenarioFrontier(orgA);

      const memoryStored = await memoryRepo.append(context, frontier);
      const pgStored = await pgRepo.append(context, forPostgresAppend(frontier));

      expect(pgStored.semanticContentDigest).toBe(memoryStored.semanticContentDigest);
      expect(pgStored.cash).toBe(memoryStored.cash);
      expect(pgStored.equity).toBe(memoryStored.equity);
      expect(pgStored.grossRealizedPnl).toBe(memoryStored.grossRealizedPnl);
      expect(pgStored.netRealizedPnl).toBe(memoryStored.netRealizedPnl);
      expect(pgStored.accountingSequence).toBe(memoryStored.accountingSequence);
    });

    it("postgres round-trip loadLatest preserves memory semantic digest", async () => {
      const context = requireOrgContext(orgA);
      const frontier = buildScenarioFrontier(orgA);
      const memoryStored = await memoryRepo.append(context, frontier);
      await pgRepo.append(context, forPostgresAppend(frontier));

      const pgLoaded = await pgRepo.loadLatest(context, { accountKey: ACCOUNT_KEY, runId: RUN_ID });
      expect(pgLoaded).not.toBeNull();
      expect(pgLoaded!.semanticContentDigest).toBe(memoryStored.semanticContentDigest);
      expect(computeAccountingSemanticDigest(frontierToState(pgLoaded!))).toBe(
        memoryStored.semanticContentDigest,
      );
    });

    it("sequential append parity across memory and postgres repositories", async () => {
      const context = requireOrgContext(orgA);
      const buy = makeAccountingEconomicsFill("buy");
      const state = createInitialAccountingState({
        organizationId: orgA,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
      });
      const frontier = advanceAccountingFrontier({
        state,
        fill: buy,
        marks: { BTCUSDT: BTC_MARK },
        frontierAsOf: buy.executedAt,
      });

      const memoryResult = await memoryRepo.append(context, frontier);
      const pgResult = await pgRepo.append(context, forPostgresAppend(frontier));

      expect(pgResult.positions.BTCUSDT?.quantity).toBe(memoryResult.positions.BTCUSDT?.quantity);
      expect(pgResult.marks.BTCUSDT?.price).toBe(memoryResult.marks.BTCUSDT?.price);
    });
  },
);
