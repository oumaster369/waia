import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATION_TAG = "0161_trader_mi_canonical_pit_lineage_v1";
const MIGRATION_PATH = join(ROOT, "db/migrations_postgres", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "db/migrations_postgres/meta/_journal.json");

describe("canonical PIT lineage migration identity (DEE-682)", () => {
  it("owns exactly one next-numbered 0161 PostgreSQL migration", () => {
    const files = readdirSync(join(ROOT, "db/migrations_postgres")).filter((name) =>
      /^0161_.*\.sql$/.test(name),
    );
    expect(files).toEqual([`${MIGRATION_TAG}.sql`]);

    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    expect(journal.entries.at(-1)).toEqual({
      idx: 161,
      version: "7",
      when: 1780000000161,
      tag: MIGRATION_TAG,
      breakpoints: true,
    });
    expect(journal.entries.filter((entry) => entry.tag === MIGRATION_TAG)).toHaveLength(1);
  });

  it("extends only the six ratified external primitive kinds", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    const values = [...migration.matchAll(/ADD VALUE IF NOT EXISTS '([a-z0-9_]+)'/g)].map(
      (match) => match[1],
    );
    expect(values).toEqual([
      "ohlcv_bar",
      "quote_l1",
      "order_book_snapshot",
      "market_trades_snapshot",
      "fear_greed_index",
      "news_headline",
    ]);
    expect(migration).not.toMatch(/ADD VALUE IF NOT EXISTS 'cross_exchange_confirmation'/);
    expect(migration).not.toMatch(/ADD VALUE IF NOT EXISTS 'news_event_cluster'/);
  });

  it("adds four append-only deny-RLS lineage relations with no economic evaluator", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    const tables = [...migration.matchAll(/CREATE TABLE public\.(trader_mi_[a-z0-9_]+_v1)/g)].map(
      (match) => match[1],
    );
    expect(tables).toEqual([
      "trader_mi_gateway_pit_receipt_v1",
      "trader_mi_canonical_measurement_definition_v1",
      "trader_mi_canonical_measurement_value_v1",
      "trader_mi_canonical_measurement_value_input_v1",
    ]);
    for (const table of tables) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`${table}_deny_client_all`);
      expect(migration).toContain(`${table}_block_update`);
      expect(migration).toContain(`${table}_block_delete`);
    }
    expect(migration).toContain("trust-as-of identity mismatch");
    expect(migration).toContain("canonical MeasurementDefinition content digest mismatch");
    expect(migration).toContain("canonical MeasurementValue content digest mismatch");
    expect(migration).toContain("observation_schema_version = 'mi-observation-v1'");
    expect(migration).toContain("relational lineage is incomplete");
    expect(migration).not.toMatch(/formula|economic_value|buy_signal|sell_signal|position_size/i);
    expect(migration).not.toMatch(/raw_body|body_bytes|api_secret|access_key|credential/i);
  });
});
