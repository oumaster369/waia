import { describe, expect, it } from "vitest";
import postgres from "postgres";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!enabled || !url)("canonical decision verification V2 PostgreSQL", () => {
  it("requires all immutable 0187 source, receipt, policy and run-start relations", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      const names = [
        "trader_canonical_decision_verification_subject_v2",
        "trader_canonical_decision_verification_receipt_v2",
        "trader_dee659_authority_preregistration_v2",
        "trader_historical_simulation_policy_config_v2",
        "trader_historical_dataset_authority_v2",
        "trader_historical_simulation_run_start_v2",
      ];
      const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
        SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ${sql(names)}
      `;
      expect(rows.map((row) => row.relname).sort()).toEqual([...names].sort());
      expect(rows.every((row) => row.relrowsecurity)).toBe(true);
      const triggers = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid IN (
          SELECT oid FROM pg_class WHERE relname IN ${sql(names)}
        )
      `;
      expect(Number(triggers[0]?.count)).toBe(names.length);

      const policies = await sql<{ relname: string; count: string }[]>`
        SELECT c.relname, count(p.policyname)::text AS count
        FROM pg_class c LEFT JOIN pg_policies p ON p.tablename=c.relname
        WHERE c.relname IN ${sql(names)} GROUP BY c.relname
      `;
      expect(policies.every((row) => Number(row.count) === 0)).toBe(true);

      const boundary = await sql<{ description: string | null; relforcerowsecurity: boolean }[]>`
        SELECT obj_description(c.oid) AS description, c.relforcerowsecurity
        FROM pg_class c WHERE c.relname='trader_historical_simulation_run_start_v2'
      `;
      expect(boundary[0]?.description).toContain("Owner-only historical simulation service boundary");
      expect(boundary[0]?.relforcerowsecurity).toBe(false);
      await sql`SET ROLE authenticated`;
      await expect(sql`SELECT * FROM trader_historical_simulation_run_start_v2`).rejects.toThrow();
      await sql`RESET ROLE`;

      const userId = "00000000-0000-4000-8000-000000001871";
      const organizationId = "00000000-0000-4000-8000-000000001872";
      const digest = "a".repeat(64);
      await sql`INSERT INTO auth.users (id) VALUES (${userId}::uuid) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO users (id, identity_label, email)
        VALUES (${userId}::uuid, '0187 validation', '0187-validation@invalid.local') ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO organizations (id, owner_user_id, kind, name)
        VALUES (${organizationId}::uuid, ${userId}::uuid, 'personal', '0187 validation') ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO trader_historical_simulation_policy_config_v2 (
        organization_id, run_id, policy_config_digest_hex, policy_config_json,
        verifier_code_digest_hex, schema_version
      ) VALUES (${organizationId}::uuid, 'run-0187', ${digest}, ${sql.json({ threshold: 1 })}, ${digest},
        'waia.trader.historical_simulation_policy_config.v2') ON CONFLICT DO NOTHING`;
      await expect(sql`UPDATE trader_historical_simulation_policy_config_v2
        SET policy_config_json=${sql.json({ threshold: 2 })}
        WHERE organization_id=${organizationId}::uuid AND run_id='run-0187'`).rejects.toThrow();
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
