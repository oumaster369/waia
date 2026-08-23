import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATION_TAG = "0162_trader_information_sufficiency_v2";
const MIGRATION_PATH = join(ROOT, "db/migrations_postgres", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "db/migrations_postgres/meta/_journal.json");

describe("Information Sufficiency V2 migration identity (DEE-687)", () => {
  it("owns exactly one next-numbered 0162 PostgreSQL migration and journal entry", () => {
    expect(
      readdirSync(join(ROOT, "db/migrations_postgres")).filter((name) =>
        /^0162_.*\.sql$/.test(name),
      ),
    ).toEqual([`${MIGRATION_TAG}.sql`]);
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as {
      entries: Array<{
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
      }>;
    };
    expect(journal.entries).toContainEqual({
      idx: 162,
      version: "7",
      when: 1780000000162,
      tag: MIGRATION_TAG,
      breakpoints: true,
    });
    expect(journal.entries.filter((entry) => entry.tag === MIGRATION_TAG)).toHaveLength(1);
  });

  it("adds only the two immutable epistemic relations with exact digest guards", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    const tables = [...migration.matchAll(/CREATE TABLE public\.([a-z0-9_]+)/g)].map(
      (match) => match[1],
    );
    expect(tables).toEqual([
      "trader_required_information_profile_v2",
      "trader_information_sufficiency_receipt_v2",
    ]);
    for (const table of tables) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`${table}_deny_client_all`);
      expect(migration).toContain(`${table}_block_update`);
      expect(migration).toContain(`${table}_block_delete`);
    }
    expect(migration).toContain("RequiredInformationProfileV2 content digest mismatch");
    expect(migration).toContain("InformationSufficiencyReceiptV2 content digest mismatch");
    expect(migration).toContain("InformationSufficiencyReceiptV2 profile scope mismatch");
    expect(migration).not.toMatch(
      /economic_value|buy_signal|sell_signal|position_size|risk_approval/i,
    );
    expect(migration).not.toMatch(/raw_body|body_bytes|api_secret|access_key|credential/i);
  });
});
