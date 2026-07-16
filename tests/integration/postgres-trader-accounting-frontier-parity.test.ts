/**
 * DEE-415 / HTR-WP18 — trader_accounting_frontier Postgres parity (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import {
  AccountingIdempotencyConflictError,
  advanceAccountingFrontier,
  computeAccountingSemanticDigest,
  createAccountingFrontierRepositoryPostgres,
  createInitialAccountingState,
  type AccountingFrontierV1,
  type AccountingStateV1,
} from "@/lib/trader/accounting";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  BTC_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8000-0000000418d1";

const ACCOUNT_KEY = "htr-frontier-parity";
const RUN_ID = "htr-frontier-run-1";

/** Postgres FK on source_fill_id requires persisted trader_fills; parity tests use marks-only linkage. */
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

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader accounting frontier parity (DEE-415 / HTR-WP18)",
  () => {
    let orgA: string;
    let repo: ReturnType<typeof createAccountingFrontierRepositoryPostgres>;

    async function cleanupOrg(): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        const orgId = orgA;
        await sql.unsafe(`ALTER TABLE trader_accounting_frontier DISABLE TRIGGER USER`);
        await sql.unsafe(`DELETE FROM trader_accounting_frontier WHERE organization_id = $1`, [
          orgId,
        ]);
        await sql.unsafe(`ALTER TABLE trader_accounting_frontier ENABLE TRIGGER USER`);
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

    async function cleanupRows(): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        await sql.unsafe(`ALTER TABLE trader_accounting_frontier DISABLE TRIGGER USER`);
        await sql.unsafe(`DELETE FROM trader_accounting_frontier WHERE organization_id = $1`, [
          orgA,
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
          [USER_A, "wp18-frontier-parity", "wp18-frontier-parity@example.com"],
        );
      } finally {
        await sql.end({ timeout: 5 });
      }

      const db = getPostgresDrizzle();
      orgA = await ensureUserCoreSeedPostgres(db, {
        userId: USER_A,
        displayName: "WP18 Accounting Frontier Parity",
      });
      repo = createAccountingFrontierRepositoryPostgres(db);
    });

    beforeEach(async () => {
      await cleanupRows();
    });

    afterAll(async () => {
      await cleanupOrg();
      resetPostgresSingletonForTests();
    });

    it("creates trader_accounting_frontier table with expected schema", async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        const tables = await sql.unsafe<{ table_name: string }[]>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'trader_accounting_frontier'`,
        );
        expect(tables).toHaveLength(1);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it("persists accounting frontier with content-addressed semantic digest", async () => {
      const context = requireOrgContext(orgA);
      const fill = makeAccountingEconomicsFill("buy");
      const frontier = advanceAccountingFrontier({
        state: createInitialAccountingState({
          organizationId: orgA,
          accountKey: ACCOUNT_KEY,
          runId: RUN_ID,
        }),
        fill,
        marks: { BTCUSDT: BTC_MARK },
        frontierAsOf: fill.executedAt,
      });
      const stored = await repo.append(context, forPostgresAppend(frontier));

      const db = getPostgresDrizzle();
      const rows = await db
        .select()
        .from(pgSchema.traderAccountingFrontier)
        .where(eq(pgSchema.traderAccountingFrontier.organizationId, orgA));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.semanticContentDigest).toBe(stored.semanticContentDigest);
      expect(rows[0]?.accountingSequence).toBe(BigInt(2));
      expect(rows[0]?.schemaVersion).toBe("htr-accounting-frontier/v1");
    });

    it("loadLatest returns highest accounting_sequence frontier", async () => {
      const context = requireOrgContext(orgA);
      const buy = makeAccountingEconomicsFill("buy");
      let state = createInitialAccountingState({
        organizationId: orgA,
        accountKey: ACCOUNT_KEY,
        runId: RUN_ID,
      });
      const first = advanceAccountingFrontier({
        state,
        fill: buy,
        frontierAsOf: buy.executedAt,
      });
      await repo.append(context, forPostgresAppend(first));
      state = frontierToState(first);
      const sell = makeAccountingEconomicsFill("sell");
      const second = advanceAccountingFrontier({
        state,
        fill: sell,
        marks: { BTCUSDT: BTC_MARK },
        frontierAsOf: sell.executedAt,
      });
      await repo.append(context, forPostgresAppend(second));

      const latest = await repo.loadLatest(context, { accountKey: ACCOUNT_KEY, runId: RUN_ID });
      expect(latest?.accountingSequence).toBe(3);
      expect(latest?.semanticContentDigest).toBe(second.semanticContentDigest);
    });

    it("idempotency same key same content returns existing frontier", async () => {
      const context = requireOrgContext(orgA);
      const fill = makeAccountingEconomicsFill("buy");
      const frontier = advanceAccountingFrontier({
        state: createInitialAccountingState({
          organizationId: orgA,
          accountKey: ACCOUNT_KEY,
          runId: RUN_ID,
        }),
        fill,
        frontierAsOf: fill.executedAt,
      });
      const first = await repo.append(context, forPostgresAppend(frontier));
      const second = await repo.append(context, forPostgresAppend(frontier));

      expect(second.id).toBe(first.id);
      expect(second.semanticContentDigest).toBe(first.semanticContentDigest);

      const db = getPostgresDrizzle();
      const rows = await db
        .select()
        .from(pgSchema.traderAccountingFrontier)
        .where(eq(pgSchema.traderAccountingFrontier.organizationId, orgA));
      expect(rows).toHaveLength(1);
    });

    it("same key different content fails closed", async () => {
      const context = requireOrgContext(orgA);
      const fill = makeAccountingEconomicsFill("buy");
      const frontier = advanceAccountingFrontier({
        state: createInitialAccountingState({
          organizationId: orgA,
          accountKey: ACCOUNT_KEY,
          runId: RUN_ID,
        }),
        fill,
        frontierAsOf: fill.executedAt,
      });
      await repo.append(context, forPostgresAppend(frontier));

      const conflicting = {
        ...forPostgresAppend(frontier),
        cash: "1.00000000",
        semanticContentDigest: computeAccountingSemanticDigest({
          ...frontierToState(frontier),
          cash: "1.00000000",
        }),
      };

      await expect(repo.append(context, conflicting)).rejects.toThrow(
        AccountingIdempotencyConflictError,
      );
    });

    it("rejects append-only mutation on accounting frontier table", async () => {
      const context = requireOrgContext(orgA);
      const fill = makeAccountingEconomicsFill("buy");
      const frontier = advanceAccountingFrontier({
        state: createInitialAccountingState({
          organizationId: orgA,
          accountKey: ACCOUNT_KEY,
          runId: RUN_ID,
        }),
        fill,
        frontierAsOf: fill.executedAt,
      });
      const stored = await repo.append(context, forPostgresAppend(frontier));

      const sql = postgres(url!, { max: 1 });
      try {
        await expect(
          sql.unsafe(`UPDATE trader_accounting_frontier SET cash = '9' WHERE id = $1`, [stored.id]),
        ).rejects.toThrow(/append-only/i);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
);
