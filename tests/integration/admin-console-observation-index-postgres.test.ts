import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const url = process.env.DATABASE_URL_POSTGRES;
describe.skipIf(process.env.WAIA_PG_INTEGRATION !== "1" || !url)(
  "bounded observation lookup",
  () => {
    let client: postgres.Sql;
    beforeAll(() => {
      if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname))
        throw new Error("LOCAL_ONLY");
      client = postgres(url!, { max: 1, prepare: false });
    });
    afterAll(async () => {
      await client?.end();
    });
    it("keeps an empty first-success lookup indexed even after thousands of partial observations", async () => {
      await client.begin(async (tx) => {
        await tx`CREATE TEMP TABLE observation_lookup_fixture (LIKE public.trader_account_observations INCLUDING DEFAULTS) ON COMMIT DROP`;
        await tx`INSERT INTO observation_lookup_fixture (organization_id,credential_id,exchange_account_id,observation_id,credential_revision,configuration_revision,lease_token,payload,recorded_at)
        SELECT '00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000002'::uuid,'fixture',gen_random_uuid(),1,'fixture',gen_random_uuid(),jsonb_build_object('status','PARTIAL','balances',jsonb_build_object('status','COMPLETE'),'padding',repeat(md5(n::text),500)),now()-n*interval '1 second' FROM generate_series(1,8000) n`;
        await tx`ANALYZE observation_lookup_fixture`;
        const query =
          "SELECT recorded_at FROM observation_lookup_fixture WHERE organization_id='00000000-0000-4000-8000-000000000001'::uuid AND exchange_account_id='fixture' AND payload->>'status'='COMPLETE' AND payload->'balances'->>'status'='COMPLETE' ORDER BY recorded_at,observation_id LIMIT 1";
        const before = await tx.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
        expect(JSON.stringify(before)).toContain('"Rows Removed by Filter":8000');
        const migration = readFileSync(
          resolve(process.cwd(), "db/migrations_postgres/0217_admin_observation_read_indexes.sql"),
          "utf8",
        ).replaceAll("public.trader_account_observations", "observation_lookup_fixture");
        for (const statement of migration.split("--> statement-breakpoint"))
          await tx.unsafe(statement);
        await tx`ANALYZE observation_lookup_fixture`;
        const after = await tx.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
        expect(JSON.stringify(after)).toContain("trader_observation_success_lookup");
        expect(JSON.stringify(after)).not.toContain('"Rows Removed by Filter":8000');
        expect(await tx.unsafe(query)).toHaveLength(0);
        const latest =
          await tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT recorded_at FROM observation_lookup_fixture WHERE organization_id='00000000-0000-4000-8000-000000000001'::uuid AND exchange_account_id='fixture' AND payload->'balances'->>'status'='COMPLETE' ORDER BY recorded_at DESC,observation_id DESC LIMIT 1`;
        expect(JSON.stringify(latest)).toContain("trader_observation_balance_lookup");
      });
    }, 20000);
  },
);
