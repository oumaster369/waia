import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertFhvV2CanonicalMigrationsApplied,
  assertFhvV2RequiredTablesPresent,
  FHV_V2_POSTGRES_REQUIRED_TABLES,
  readFhvV2CanonicalMigrations,
  readFhvV2CompatibleAdditiveMigrations,
} from "@/lib/trader/observability/fhv-v2-postgres-schema-preflight";

describe("FHV V2 PostgreSQL schema preflight", () => {
  const canonical = readFhvV2CanonicalMigrations(process.cwd());
  const compatibleAdditive = readFhvV2CompatibleAdditiveMigrations(process.cwd());
  const baseline = canonical.map((entry) => ({ hash: entry.hash, createdAt: String(entry.when) }));

  it("accepts all exact migration bytes applied by the full checkout migration job", () => {
    // Build the applied journal independently of the preflight's range filter,
    // so a new canonical migration cannot silently disappear from both sides.
    const root = join(process.cwd(), "db/migrations_postgres");
    const journal = JSON.parse(readFileSync(join(root, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const applied = journal.entries.map((entry) => ({
      hash: createHash("sha256")
        .update(readFileSync(join(root, `${entry.tag}.sql`)))
        .digest("hex"),
      createdAt: String(entry.when),
    }));
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({ canonical, compatibleAdditive, applied }),
    ).not.toThrow();
  });

  it("requires the complete Cody policy prefix and admits 0208-0218 only as explicit compatible additive", () => {
    const journal = JSON.parse(
      readFileSync(join(process.cwd(), "db/migrations_postgres/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; when: number; tag: string }> };
    expect(
      compatibleAdditive.map((entry) => ({ idx: entry.idx, when: entry.when, tag: entry.tag })),
    ).toEqual(
      journal.entries
        .filter((entry) => entry.idx > 207)
        .map((entry) => ({ idx: entry.idx, when: entry.when, tag: entry.tag })),
    );
    expect(compatibleAdditive.map((entry) => entry.tag)).toEqual([
      "0208_historical_terminal_receipts_v1",
      "0209_ai_twin_epistemic_persistence_v1",
      "0210_trader_account_observation_credential_v1",
      "0211_trader_knowledge_edge_version_v2",
      "0212_trader_human_promotion_tables_v2",
      "0213_trader_human_promotion_tables_rls_v2",
      "0214_trader_admin_console_v2",
      "0215_trader_admin_console_v2_rls",
      "0216_trader_admin_change_log_triggers",
      "0217_admin_observation_read_indexes",
      "0218_trader_runtime_noncapital_cycles_v2",
    ]);
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({ canonical, compatibleAdditive, applied: baseline }),
    ).not.toThrow();
    expect(canonical.at(-1)?.tag).toBe("0207_historical_cody_admission_v4");
  });

  it.each([205, 206])(
    "does not let complete %s substitute for required Cody policy 0207",
    (through) => {
      expect(() =>
        assertFhvV2CanonicalMigrationsApplied({
          canonical,
          compatibleAdditive,
          applied: baseline.slice(0, through + 1),
        }),
      ).toThrow("REQUIRED_MIGRATION_MISSING");
    },
  );

  it.each([205, 206, 207])("requires migration %s even when all successors are applied", (idx) => {
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({
        canonical,
        compatibleAdditive,
        applied: baseline.filter((_, i) => i !== idx),
      }),
    ).toThrow(`${canonical[idx]!.tag} is not applied`);
  });

  it("rejects changed Cody policy SQL bytes", () => {
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({
        canonical,
        compatibleAdditive,
        applied: [...baseline.slice(0, -1), { ...baseline.at(-1)!, hash: "f".repeat(64) }],
      }),
    ).toThrow("APPLIED_MIGRATION_HASH_MISMATCH");
  });

  it("rejects an admitted hash registered at an unrecognized timestamp", () => {
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({
        canonical,
        compatibleAdditive,
        applied: [...baseline.slice(0, -1), { ...baseline.at(-1)!, createdAt: "1780000000210" }],
      }),
    ).toThrow("REQUIRED_MIGRATION_MISSING");
  });

  it("does not automatically admit the next migration", () => {
    const nextWhen = String(Math.max(...compatibleAdditive.map((entry) => entry.when)) + 1);
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({
        canonical,
        compatibleAdditive,
        applied: [...baseline, { hash: "a".repeat(64), createdAt: nextWhen }],
      }),
    ).toThrow("UNKNOWN_APPLIED_MIGRATION");
  });

  it.each(["same row", "same timestamp", "same hash"])(
    "rejects duplicate migration: %s",
    (kind) => {
      const row = { ...baseline.at(-1)! };
      if (kind === "same timestamp") row.hash = "a".repeat(64);
      if (kind === "same hash") row.createdAt = "1780000000210";
      expect(() =>
        assertFhvV2CanonicalMigrationsApplied({
          canonical,
          compatibleAdditive,
          applied: [...baseline, row],
        }),
      ).toThrow("DUPLICATE_APPLIED_MIGRATION");
    },
  );

  it("binds the exact contiguous canonical journal through 0207", () => {
    expect(canonical).toHaveLength(208);
    expect(canonical[0]?.tag.startsWith("0000_")).toBe(true);
    expect(canonical.at(-1)?.tag).toBe("0207_historical_cody_admission_v4");
  });

  it("refuses the old journal without required package storage", () => {
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({
        canonical,
        applied: canonical
          .filter((entry) => entry.idx !== 203)
          .map((entry) => ({ hash: entry.hash, createdAt: String(entry.when) })),
      }),
    ).toThrow("0203_predictive_package_storage_v1 is not applied");
  });

  it("refuses missing preparation-event migration even when package storage exists", () => {
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({
        canonical,
        applied: canonical
          .filter((entry) => entry.idx !== 204)
          .map((entry) => ({ hash: entry.hash, createdAt: String(entry.when) })),
      }),
    ).toThrow("0204_historical_preparation_events_v2 is not applied");
  });

  it.each([
    "trader_predictive_package_manifest_v1",
    "trader_predictive_package_chunk_v1",
    "trader_historical_preparation_event_v2",
  ] as const)("refuses missing %s even with a complete journal", (table) => {
    const present = new Set(FHV_V2_POSTGRES_REQUIRED_TABLES);
    present.delete(table);
    expect(() => assertFhvV2RequiredTablesPresent(present)).toThrow(table);
  });

  it("rejects a production database whose applied migration journal ends at 0109", () => {
    const appliedThrough0109 = canonical.slice(0, 110).map((entry) => ({
      hash: entry.hash,
      createdAt: String(entry.when),
    }));
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({ canonical, applied: appliedThrough0109 }),
    ).toThrowError(
      expect.objectContaining({
        code: "REQUIRED_MIGRATION_MISSING",
      }),
    );
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({ canonical, applied: appliedThrough0109 }),
    ).toThrow(/0110_trader_forecast_target_definition_v2/);
  });

  it("rejects applied bytes that differ from the exact checkout migration", () => {
    const applied = canonical.map((entry) => ({
      hash: entry.idx === 156 ? "f".repeat(64) : entry.hash,
      createdAt: String(entry.when),
    }));
    expect(() => assertFhvV2CanonicalMigrationsApplied({ canonical, applied })).toThrowError(
      expect.objectContaining({
        code: "APPLIED_MIGRATION_HASH_MISMATCH",
      }),
    );
  });

  it("accepts only the exact complete canonical migration identity", () => {
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({
        canonical,
        applied: canonical.map((entry) => ({ hash: entry.hash, createdAt: String(entry.when) })),
      }),
    ).not.toThrow();
  });

  it("still rejects an applied migration outside the ratified canonical journal", () => {
    expect(() =>
      assertFhvV2CanonicalMigrationsApplied({
        canonical,
        applied: [
          ...canonical.map((entry) => ({ hash: entry.hash, createdAt: String(entry.when) })),
          { hash: "a".repeat(64), createdAt: "9999999999999" },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "UNKNOWN_APPLIED_MIGRATION" }));
  });

  it("rejects an exact journal when a required Reality V2 dependency table is absent", () => {
    const present = new Set(FHV_V2_POSTGRES_REQUIRED_TABLES);
    present.delete("trader_mi_raw_capture_receipt_v1");
    expect(() => assertFhvV2RequiredTablesPresent(present)).toThrowError(
      expect.objectContaining({ code: "REQUIRED_V2_TABLE_MISSING" }),
    );
    expect(() => assertFhvV2RequiredTablesPresent(present)).toThrow(
      /trader_mi_raw_capture_receipt_v1/,
    );
  });
});
