import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  traderForecastBundleV2,
  traderForecastPredictivePackageV2,
  traderForecastRuntimeInputSourceV2,
} from "@/db/schema.postgres";

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

  it("mirrors every 0192 index and constraint in the PostgreSQL schema model", () => {
    const packageConfig = getTableConfig(traderForecastPredictivePackageV2);
    const symbolLineageIndex = packageConfig.indexes.find(
      (index) => index.config.name ===
        "forecast_predictive_package_v2_symbol_lineage_unique",
    );
    const organizationSymbolIndex = packageConfig.indexes.find(
      (index) => index.config.name ===
        "forecast_predictive_package_v2_org_symbol_unique",
    );
    expect(symbolLineageIndex?.config.unique).toBe(true);
    expect(organizationSymbolIndex?.config.unique).toBe(true);

    const bundleConfig = getTableConfig(traderForecastBundleV2);
    const bundleSymbolForeignKey = bundleConfig.foreignKeys.find(
      (foreignKey) => foreignKey.getName() === "tfbv2_package_org_symbol_fk",
    );
    expect(bundleSymbolForeignKey?.reference().columns.map((column) => column.name)).toEqual([
      "predictive_package_id", "organization_id", "symbol",
    ]);
    expect(
      bundleSymbolForeignKey?.reference().foreignColumns.map((column) => column.name),
    ).toEqual(["id", "organization_id", "symbol"]);

    const sourceConfig = getTableConfig(traderForecastRuntimeInputSourceV2);
    const sourceSymbolForeignKey = sourceConfig.foreignKeys.find(
      (foreignKey) => foreignKey.getName() ===
        "forecast_runtime_input_source_package_symbol_fk",
    );
    expect(sourceSymbolForeignKey?.reference().columns.map((column) => column.name)).toEqual([
      "predictive_package_id",
      "organization_id",
      "predictive_package_content_digest_hex",
      "symbol",
    ]);
    expect(
      sourceSymbolForeignKey?.reference().foreignColumns.map((column) => column.name),
    ).toEqual([
      "id", "organization_id", "predictive_package_content_digest", "symbol",
    ]);
    expect(sourceConfig.checks.map((constraint) => constraint.name)).toContain(
      "forecast_runtime_input_source_symbol_json_binding",
    );
  });
});
