/**
 * DEE-415 / HTR-WP21 — six-table Postgres access-control and append-only matrix.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { resetPostgresSingletonForTests } from "@/db/postgres-client";
import {
  assertWp21MandatoryPostgresProofEnvironment,
  seedWp21ProofUser,
} from "@/tests/helpers/wp21-proof-postgres";

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

async function readSessionRole(sql: postgres.Sql): Promise<string> {
  const rows = await sql.unsafe<{ role: string }[]>(`SELECT current_user AS role`);
  return rows[0]?.role ?? "";
}

async function withRoleProbe(
  sql: postgres.Sql,
  role: "authenticated" | "anon",
  operation: () => Promise<unknown>,
  table: string,
): Promise<void> {
  const baseline = await readSessionRole(sql);
  await sql.unsafe(`SET ROLE ${role}`);
  try {
    try {
      await operation();
      throw new Error(`RLS_PROBE_EXPECTED_INSUFFICIENT_PRIVILEGE:${table}`);
    } catch (error) {
      const probeError = error as PostgresRoleProbeError;
      expect(probeError.code).toBe(RLS_DENIED_SQLSTATE);
      expect(probeError.message.toLowerCase()).toContain(`permission denied for table ${table}`);
    }
  } finally {
    await sql.unsafe(`RESET ROLE`);
    expect(await readSessionRole(sql)).toBe(baseline);
  }
}

function registerWp21SixTableMatrixSuite(label: string): void {
  describe(label, () => {
    let orgA: string;
    let orgB: string;
    let sql: postgres.Sql;

    beforeAll(async () => {
      await assertWp21MandatoryPostgresProofEnvironment();
      sql = postgres(url!, { max: 1 });
      orgA = await seedWp21ProofUser(url!, USER_A, "WP21 Matrix A");
      orgB = await seedWp21ProofUser(url!, USER_B, "WP21 Matrix B");
    }, 60_000);

    afterAll(async () => {
      await sql.end({ timeout: 5 });
      resetPostgresSingletonForTests();
    });

    for (const table of WP21_TABLES) {
      it(`creates ${table} with required columns, indexes, and RLS policies`, async () => {
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

        const policies = await sql.unsafe<{ policyname: string }[]>(
          `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
          [table],
        );
        expect(policies.length).toBeGreaterThan(0);

        const triggers = await sql.unsafe<{ tgname: string }[]>(
          `SELECT tgname FROM pg_trigger
           WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
          [table],
        );
        const triggerNames = triggers.map((row) => row.tgname);
        expect(triggerNames.some((name) => name.includes("block_update"))).toBe(true);
        expect(triggerNames.some((name) => name.includes("block_delete"))).toBe(true);
      });

      it(`denies authenticated and anon direct access on ${table} (42501 table privilege)`, async () => {
        await withRoleProbe(
          sql,
          "authenticated",
          () => sql.unsafe(`SELECT 1 FROM ${table} LIMIT 1`),
          table,
        );
        await withRoleProbe(
          sql,
          "authenticated",
          () => sql.unsafe(`INSERT INTO ${table} DEFAULT VALUES`),
          table,
        );
        await withRoleProbe(sql, "anon", () => sql.unsafe(`SELECT 1 FROM ${table} LIMIT 1`), table);
        await withRoleProbe(
          sql,
          "anon",
          () => sql.unsafe(`INSERT INTO ${table} DEFAULT VALUES`),
          table,
        );
      });
    }

    it("scopes repository reads to organization context only", async () => {
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
      expect(orgA).not.toBe(orgB);
    });
  });
}

describe.skipIf(!integrationEnabled || !url)("postgres trader wp21 six-table matrix", () => {
  registerWp21SixTableMatrixSuite(
    "postgres trader wp21 six-table matrix mandatory profile run 1 (DEE-415 / HTR-WP21)",
  );
  registerWp21SixTableMatrixSuite(
    "postgres trader wp21 six-table matrix mandatory profile run 2 (DEE-415 / HTR-WP21)",
  );
});
