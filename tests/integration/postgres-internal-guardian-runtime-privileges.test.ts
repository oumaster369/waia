import { describe, expect, it } from "vitest";
import postgres from "postgres";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const INTERNAL_TABLES = [
  "trader_guardian_assessments_v2",
  "trader_guardian_protective_consumptions_v2",
  "trader_runtime_authority_assessments_v2",
  "trader_runtime_control_lease_heads_v2",
  "trader_runtime_control_lease_epoch_history_v2",
] as const;

describe.skipIf(!enabled || !url)("0190 internal Guardian and Runtime Authority privileges", () => {
  it("leaves no table privilege for PUBLIC, anon, or authenticated", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      const browserGrants = await sql<{ table_name: string; grantee: string; privilege_type: string }[]>`
        SELECT table_name, grantee, privilege_type
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name IN ${sql(INTERNAL_TABLES)}
          AND grantee IN ('anon', 'authenticated')
      `;
      expect(browserGrants).toEqual([]);

      const publicGrants = await sql<{ table_name: string; privilege_type: string }[]>`
        SELECT c.relname AS table_name, x.privilege_type
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(
          COALESCE(c.relacl, acldefault('r', c.relowner))
        ) AS x
        WHERE c.relnamespace = 'public'::regnamespace
          AND c.relname IN ${sql(INTERNAL_TABLES)}
          AND x.grantee = 0
      `;
      expect(publicGrants).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it.each(["anon", "authenticated"] as const)("refuses TRUNCATE to %s", async (role) => {
    const sql = postgres(url!, { max: 1 });
    try {
      await sql`BEGIN`;
      await sql.unsafe(`SET LOCAL ROLE ${role}`);
      await expect(
        sql.unsafe(`TRUNCATE TABLE public.${INTERNAL_TABLES.join(", public.")}`),
      ).rejects.toThrow();
    } finally {
      await sql`ROLLBACK`.catch(() => undefined);
      await sql.end({ timeout: 5 });
    }
  });
});
