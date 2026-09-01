import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATION_TAG = "0192_forecast_v2_symbol_binding";
const MIGRATION_PATH = join(ROOT, "db/migrations_postgres", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "db/migrations_postgres/meta/_journal.json");

describe("Forecast V2 symbol-binding migration", () => {
  it("has the canonical migration identity", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    expect(journal.entries).toContainEqual({
      idx: 192,
      version: "7",
      when: 1780000000192,
      tag: MIGRATION_TAG,
      breakpoints: true,
    });
  });

  it("binds package, bundle, source JSON and normalized snapshot instrument", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    expect(migration).toContain("tfbv2_package_org_symbol_fk");
    expect(migration).toContain("forecast_runtime_input_source_package_symbol_fk");
    expect(migration).toContain("forecast_runtime_input_source_symbol_json_binding");
    expect(migration).toContain("replace(");
    expect(migration).toContain("'instrumentId', '/', ''");
    expect(migration).toContain("'predictivePackage' -> 'family' ->> 'symbol' = symbol");
    expect(migration).toContain(
      "'issuance' -> 'package' -> 'family' ->> 'symbol' = symbol",
    );
    expect(migration).toContain("0192 refuses mixed-symbol Forecast V2 lineage");
  });
});
