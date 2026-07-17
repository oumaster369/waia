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

const RLS_DENIED_SQLSTATE = "42501";
const RLS_PROBE_ORG_ID = "00000000-0000-4000-8018-000000000001";
const RLS_PROBE_ROW_ID = "00000000-0000-4000-8018-000000000002";

type PostgresRoleProbeError = Error & { code?: string };

/** Canonical validate profile uses table-owner `waia_validate`, not PostgreSQL `service_role`. */
function createDedicatedRoleProbeClient() {
  return postgres(url!, { max: 1 });
}

async function readSessionRole(sql: ReturnType<typeof postgres>): Promise<string> {
  const rows = await sql.unsafe<{ role: string }[]>(`SELECT current_user AS role`);
  return rows[0]?.role ?? "";
}

async function assertRoleReset(
  sql: ReturnType<typeof postgres>,
  expectedRole: string,
): Promise<void> {
  expect(await readSessionRole(sql)).toBe(expectedRole);
}

async function expectInsufficientPrivilege(
  operation: () => Promise<unknown>,
): Promise<PostgresRoleProbeError> {
  try {
    await operation();
    throw new Error("RLS_PROBE_EXPECTED_INSUFFICIENT_PRIVILEGE");
  } catch (error) {
    const probeError = error as PostgresRoleProbeError;
    expect(probeError.code).toBe(RLS_DENIED_SQLSTATE);
    expect(probeError.message).toMatch(/permission denied for table trader_accounting_frontier/i);
    return probeError;
  }
}

function rlsProbeInsertSql(): string {
  return `INSERT INTO trader_accounting_frontier (
    id, organization_id, account_key, run_id, accounting_sequence, frontier_as_of,
    cash, position_quantity_json, gross_position_basis_json, net_position_basis_json,
    gross_realized_pnl, net_realized_pnl, marks_json, equity, equity_hwm,
    account_drawdown_bps, source_economics_digest, semantic_content_digest,
    idempotency_key, schema_version
  ) VALUES (
    '${RLS_PROBE_ROW_ID}', '${RLS_PROBE_ORG_ID}', 'htr-rls-probe', 'htr-rls-probe-run', 1,
    TIMESTAMPTZ '2026-01-01T00:00:00.000Z', '0', '{}', '{}', '{}', '0', '0', '{}', '0', '0',
    0, repeat('a', 64), repeat('b', 64), 'htr-rls-probe-idempotency', 'htr-accounting-frontier/v1'
  )`;
}

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

    it("persists accounting frontier with content-addressed semantic digest (privileged validate-profile table-owner append permitted)", async () => {
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

    it("loadLatest returns highest accounting_sequence frontier (privileged validate-profile table-owner readback permitted)", async () => {
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

    it("denies authenticated role SELECT on trader_accounting_frontier (42501 insufficient privilege)", async () => {
      const sql = createDedicatedRoleProbeClient();
      const baselineRole = await readSessionRole(sql);
      try {
        await sql.unsafe(`SET ROLE authenticated`);
        expect(await readSessionRole(sql)).toBe("authenticated");
        await expectInsufficientPrivilege(() =>
          sql.unsafe(`SELECT id FROM trader_accounting_frontier LIMIT 1`),
        );
      } finally {
        await sql.unsafe(`RESET ROLE`);
        await assertRoleReset(sql, baselineRole);
        await sql.end({ timeout: 5 });
      }
    });

    it("denies authenticated role INSERT on trader_accounting_frontier (42501 insufficient privilege)", async () => {
      const sql = createDedicatedRoleProbeClient();
      const baselineRole = await readSessionRole(sql);
      try {
        await sql.unsafe(`SET ROLE authenticated`);
        expect(await readSessionRole(sql)).toBe("authenticated");
        await expectInsufficientPrivilege(() => sql.unsafe(rlsProbeInsertSql()));
      } finally {
        await sql.unsafe(`RESET ROLE`);
        await assertRoleReset(sql, baselineRole);
        await sql.end({ timeout: 5 });
      }
    });

    it("denies anon role SELECT on trader_accounting_frontier (42501 insufficient privilege)", async () => {
      const sql = createDedicatedRoleProbeClient();
      const baselineRole = await readSessionRole(sql);
      try {
        await sql.unsafe(`SET ROLE anon`);
        expect(await readSessionRole(sql)).toBe("anon");
        await expectInsufficientPrivilege(() =>
          sql.unsafe(`SELECT id FROM trader_accounting_frontier LIMIT 1`),
        );
      } finally {
        await sql.unsafe(`RESET ROLE`);
        await assertRoleReset(sql, baselineRole);
        await sql.end({ timeout: 5 });
      }
    });

    it("denies anon role INSERT on trader_accounting_frontier (42501 insufficient privilege)", async () => {
      const sql = createDedicatedRoleProbeClient();
      const baselineRole = await readSessionRole(sql);
      try {
        await sql.unsafe(`SET ROLE anon`);
        expect(await readSessionRole(sql)).toBe("anon");
        await expectInsufficientPrivilege(() => sql.unsafe(rlsProbeInsertSql()));
      } finally {
        await sql.unsafe(`RESET ROLE`);
        await assertRoleReset(sql, baselineRole);
        await sql.end({ timeout: 5 });
      }
    });
  },
);
