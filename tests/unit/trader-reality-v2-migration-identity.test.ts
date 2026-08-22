import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATION_TAG = "0160_trader_reality_v2";
const MIGRATION_PATH = join(ROOT, "db/migrations_postgres", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "db/migrations_postgres/meta/_journal.json");

describe("Reality V2 migration identity (DEE-677)", () => {
  it("owns exactly one next-numbered 0160 PostgreSQL migration", () => {
    const files = readdirSync(join(ROOT, "db/migrations_postgres"))
      .filter((name) => /^0160_.*\.sql$/.test(name));
    expect(files).toEqual([`${MIGRATION_TAG}.sql`]);

    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    expect(journal.entries.at(-1)).toEqual({
      idx: 160,
      version: "7",
      when: 1780000000160,
      tag: MIGRATION_TAG,
      breakpoints: true,
    });
    expect(journal.entries.filter((entry) => entry.tag === MIGRATION_TAG)).toHaveLength(1);
  });

  it("creates exactly four append-only, deny-RLS Reality tables without raw payload storage", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const createdTables = [...sql.matchAll(/CREATE TABLE public\.(trader_reality_[a-z_]+_v2)/g)]
      .map((match) => match[1]);
    expect(createdTables).toEqual([
      "trader_reality_source_reports_v2",
      "trader_reality_truth_records_v2",
      "trader_reality_events_v2",
      "trader_reality_projections_v2",
    ]);
    expect(sql).not.toMatch(/raw_payload|raw_body|body_bytes|api_secret|access_key|signature text/i);
    for (const table of createdTables) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM authenticated, anon`);
      expect(sql).toContain(`${table}_block_update`);
      expect(sql).toContain(`${table}_block_delete`);
    }
  });

  it("pins database-authored knowledge time, scoped lineage, correction, and event-head guards", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toContain("NEW.knowledge_at := date_trunc('milliseconds', transaction_timestamp())");
    expect(sql).toContain("ExecutionReportV2 lineage does not match scoped immutable HTX source");
    expect(sql).toContain("upper(attempt.venue) = 'HTX'");
    expect(sql).toContain("raw HTX lineage does not match encrypted scoped capture receipt");
    expect(sql).toContain("Only explicit source-native correction may supersede scoped truth");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("Reality event sequence/digest head mismatch");
    expect(sql).toContain("Reality projection frontier is not exact at requested as-of time");
  });
});
