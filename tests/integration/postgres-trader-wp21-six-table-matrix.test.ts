/**
 * DEE-415 / HTR-WP21 — six-table Postgres access-control and append-only matrix.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8021-0000000000b1";
const USER_B = "00000000-0000-4000-8021-0000000000b2";

const RLS_DENIED_SQLSTATE = "42501";

const WP21_TABLES = [
  "trader_forecast_outcome_record",
  "trader_hypothesis_outcome_record",
  "trader_calibration_observation_record",
  "trader_calibration_snapshot_record",
  "trader_abstention_outcome_record",
  "trader_knowledge_confidence_update_record",
] as const;

type PostgresRoleProbeError = Error & { code?: string };

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
  table: string,
): Promise<void> {
  try {
    await operation();
    throw new Error(`RLS_PROBE_EXPECTED_INSUFFICIENT_PRIVILEGE:${table}`);
  } catch (error) {
    const probeError = error as PostgresRoleProbeError;
    expect(probeError.code).toBe(RLS_DENIED_SQLSTATE);
    expect(probeError.message.toLowerCase()).toContain(`permission denied for table ${table}`);
  }
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader wp21 six-table matrix (DEE-415 / HTR-WP21)",
  () => {
    let orgA: string;
    let orgB: string;

    async function cleanupOrg(orgId: string): Promise<void> {
      const sql = postgres(url!, { max: 1 });
      try {
        for (const table of [...WP21_TABLES].reverse()) {
          await sql.unsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
          await sql.unsafe(`DELETE FROM ${table} WHERE organization_id = $1`, [orgId]);
          await sql.unsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    beforeAll(async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        for (const userId of [USER_A, USER_B]) {
          await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
            userId,
          ]);
          await sql.unsafe(
            `INSERT INTO users (id, identity_label, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
            [userId, `wp21-matrix-${userId.slice(-4)}`, `${userId.slice(-4)}@example.com`],
          );
        }
      } finally {
        await sql.end({ timeout: 5 });
      }

      const db = getPostgresDrizzle();
      orgA = await ensureUserCoreSeedPostgres(db, {
        userId: USER_A,
        displayName: "WP21 Matrix A",
      });
      orgB = await ensureUserCoreSeedPostgres(db, {
        userId: USER_B,
        displayName: "WP21 Matrix B",
      });
    });

    beforeEach(async () => {
      await cleanupOrg(orgA);
      await cleanupOrg(orgB);
    });

    afterAll(async () => {
      resetPostgresSingletonForTests();
    });

    for (const table of WP21_TABLES) {
      it(`creates ${table} with required columns and indexes`, async () => {
        const sql = postgres(url!, { max: 1 });
        try {
          const tables = await sql.unsafe<{ table_name: string }[]>(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = $1`,
            [table],
          );
          expect(tables).toHaveLength(1);

          const columns = await sql.unsafe<{ column_name: string; is_nullable: string }[]>(
            `SELECT column_name, is_nullable
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1`,
            [table],
          );
          const names = new Set(columns.map((row) => row.column_name));
          expect(names.has("organization_id")).toBe(true);
          expect(names.has("content_digest")).toBe(true);
          expect(names.has("idempotency_key")).toBe(true);
          expect(columns.find((row) => row.column_name === "organization_id")?.is_nullable).toBe(
            "NO",
          );
          expect(columns.find((row) => row.column_name === "content_digest")?.is_nullable).toBe(
            "NO",
          );
          expect(columns.find((row) => row.column_name === "idempotency_key")?.is_nullable).toBe(
            "NO",
          );
        } finally {
          await sql.end({ timeout: 5 });
        }
      });

      it(`denies authenticated SELECT on ${table} (42501 table privilege)`, async () => {
        const sql = postgres(url!, { max: 1 });
        try {
          const baseline = await readSessionRole(sql);
          await sql.unsafe(`SET ROLE authenticated`);
          await expectInsufficientPrivilege(
            () => sql.unsafe(`SELECT 1 FROM ${table} LIMIT 1`),
            table,
          );
          await sql.unsafe(`RESET ROLE`);
          await assertRoleReset(sql, baseline);
        } finally {
          await sql.end({ timeout: 5 });
        }
      });

      it(`denies authenticated INSERT on ${table} (42501 table privilege)`, async () => {
        const sql = postgres(url!, { max: 1 });
        try {
          const baseline = await readSessionRole(sql);
          await sql.unsafe(`SET ROLE authenticated`);
          await expectInsufficientPrivilege(
            () => sql.unsafe(`INSERT INTO ${table} DEFAULT VALUES`),
            table,
          );
          await sql.unsafe(`RESET ROLE`);
          await assertRoleReset(sql, baseline);
        } finally {
          await sql.end({ timeout: 5 });
        }
      });

      it(`denies anon SELECT on ${table} (42501 table privilege)`, async () => {
        const sql = postgres(url!, { max: 1 });
        try {
          const baseline = await readSessionRole(sql);
          await sql.unsafe(`SET ROLE anon`);
          await expectInsufficientPrivilege(
            () => sql.unsafe(`SELECT 1 FROM ${table} LIMIT 1`),
            table,
          );
          await sql.unsafe(`RESET ROLE`);
          await assertRoleReset(sql, baseline);
        } finally {
          await sql.end({ timeout: 5 });
        }
      });

      it(`denies anon INSERT on ${table} (42501 table privilege)`, async () => {
        const sql = postgres(url!, { max: 1 });
        try {
          const baseline = await readSessionRole(sql);
          await sql.unsafe(`SET ROLE anon`);
          await expectInsufficientPrivilege(
            () => sql.unsafe(`INSERT INTO ${table} DEFAULT VALUES`),
            table,
          );
          await sql.unsafe(`RESET ROLE`);
          await assertRoleReset(sql, baseline);
        } finally {
          await sql.end({ timeout: 5 });
        }
      });

      it(`installs append-only UPDATE/DELETE triggers on ${table}`, async () => {
        const sql = postgres(url!, { max: 1 });
        try {
          const triggers = await sql.unsafe<{ tgname: string }[]>(
            `SELECT tgname FROM pg_trigger
             WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
            [table],
          );
          const names = triggers.map((row) => row.tgname);
          expect(names.some((name) => name.includes("block_update"))).toBe(true);
          expect(names.some((name) => name.includes("block_delete"))).toBe(true);
        } finally {
          await sql.end({ timeout: 5 });
        }
      });
    }

    it("scopes repository reads to organization context only", async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        const orgARows = await sql.unsafe<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM trader_forecast_outcome_record WHERE organization_id = $1`,
          [orgA],
        );
        const orgBRows = await sql.unsafe<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM trader_forecast_outcome_record WHERE organization_id = $1`,
          [orgB],
        );
        expect(orgARows[0]?.count ?? 0).toBe(0);
        expect(orgBRows[0]?.count ?? 0).toBe(0);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
);
