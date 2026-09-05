import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATION_TAG = "0193_historical_runner_knowledge_state_read";
const MIGRATION_PATH = join(ROOT, "db/migrations_postgres", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "db/migrations_postgres/meta/_journal.json");
const TABLES = [
  "trader_mi_hypothesis",
  "trader_mi_hypothesis_lifecycle",
  "trader_mi_evidence",
  "trader_knowledge_edges",
] as const;

describe("Historical runner knowledge-state migration (DEE-904)", () => {
  it("owns exactly one next-numbered 0193 migration", () => {
    const files = readdirSync(join(ROOT, "db/migrations_postgres"))
      .filter((name) => /^0193_.*\.sql$/.test(name));
    expect(files).toEqual([`${MIGRATION_TAG}.sql`]);
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(journal.entries).toContainEqual({ idx: 193, version: "7", when: 1780000000193,
      tag: MIGRATION_TAG, breakpoints: true });
  });

  it("grants only SELECT and pins every read to the production organization", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const executableSql = sql.replace(/^--.*$/gm, "");
    for (const table of TABLES) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ON public.${table}`);
    }
    expect(sql.match(/FOR SELECT/g)).toHaveLength(TABLES.length);
    expect(sql).toContain("current_user = 'waia_historical_runner'");
    expect(sql.match(/3c50b4e9-1138-43a5-a29f-e65088124cfc/g)).toHaveLength(TABLES.length);
    expect(sql).toContain("GRANT SELECT ON TABLE");
    expect(sql).toContain("REVOKE ALL PRIVILEGES ON TABLE");
    expect(sql).toContain("runner.rolsuper OR runner.rolbypassrls");
    expect(sql).toContain("pg_auth_members");
    expect(sql).toContain("must be provisioned before migration 0193");
    expect(executableSql).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE)|ALTER\s+ROLE[^;]*BYPASSRLS|service_role/i,
    );
    expect(executableSql).not.toMatch(/FOR\s+(?:INSERT|UPDATE|DELETE|ALL)/i);
  });

  it("provisions the validation-only role before the migration chain", () => {
    const prelude = readFileSync(join(ROOT,
      "scripts/postgres-validation/prelude-auth-stub.sql"), "utf8");
    expect(prelude).toMatch(
      /CREATE ROLE waia_historical_runner\s+NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/,
    );
  });
});
