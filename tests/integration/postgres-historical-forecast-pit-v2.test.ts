import { describe, expect, it } from "vitest";
import postgres from "postgres";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!enabled || !url)("historical Forecast PIT V2 PostgreSQL", () => {
  it("has complete append-only, RLS and composite lineage authority", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      const names = ["trader_forecast_runtime_input_source_v2", "trader_historical_forecast_input_pit_v2",
        "trader_historical_forecast_input_knowledge_link_v2"];
      const relations = await sql<{ relname: string; relrowsecurity: boolean }[]>`
        SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ${sql(names)}`;
      expect(relations.map((row) => row.relname).sort()).toEqual([...names].sort());
      expect(relations.every((row) => row.relrowsecurity)).toBe(true);
      const triggers = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relname IN ${sql(names)})`;
      expect(Number(triggers[0]?.count)).toBe(3);
      const fks = await sql<{ conname: string }[]>`SELECT conname FROM pg_constraint
        WHERE contype='f' AND conrelid IN (SELECT oid FROM pg_class WHERE relname IN ${sql(names)})`;
      const fkNames = fks.map((row) => row.conname);
      for (const expectedName of [
        "forecast_runtime_input_source_bundle_fk", "forecast_runtime_input_source_forecast_fk",
        "forecast_runtime_input_source_package_fk", "forecast_runtime_input_source_scientific_fk",
        "forecast_runtime_input_source_binding_fk",
        "historical_forecast_pit_run_fk", "historical_forecast_pit_dataset_fk",
        "historical_forecast_pit_source_fk", "historical_forecast_pit_forecast_fk",
      ]) expect(fkNames).toContain(expectedName);
      const checks = await sql<{ conname: string }[]>`SELECT conname FROM pg_constraint
        WHERE contype='c' AND conrelid IN (SELECT oid FROM pg_class WHERE relname IN ${sql(names)})`;
      expect(checks.map((row) => row.conname)).toEqual(expect.arrayContaining([
        "forecast_runtime_input_source_execution_role", "historical_forecast_pit_execution_role",
      ]));
      await sql`SET ROLE authenticated`;
      await expect(sql`SELECT * FROM trader_historical_forecast_input_pit_v2`).rejects.toThrow();
      await expect(sql`INSERT INTO trader_historical_forecast_input_pit_v2 DEFAULT VALUES`).rejects.toThrow();
      await sql`RESET ROLE`;
    } finally { await sql.end({ timeout: 5 }); }
  });
});
