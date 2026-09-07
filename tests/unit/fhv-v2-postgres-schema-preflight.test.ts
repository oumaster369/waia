import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertFhvV2CanonicalMigrationsApplied,
  assertFhvV2RequiredTablesPresent,
  FHV_V2_POSTGRES_REQUIRED_TABLES,
  readFhvV2CanonicalMigrations,
} from "@/lib/trader/observability/fhv-v2-postgres-schema-preflight";

describe("FHV V2 PostgreSQL schema preflight", () => {
  const canonical = readFhvV2CanonicalMigrations(process.cwd());

  it("accepts all exact migration bytes applied by the full checkout migration job", () => {
    // Build the applied journal independently of the preflight's range filter,
    // so a new canonical migration cannot silently disappear from both sides.
    const root = join(process.cwd(), "db/migrations_postgres");
    const journal = JSON.parse(readFileSync(join(root, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const applied = journal.entries.map((entry) => ({
      hash: createHash("sha256").update(readFileSync(join(root, `${entry.tag}.sql`))).digest("hex"),
      createdAt: String(entry.when),
    }));
    expect(() => assertFhvV2CanonicalMigrationsApplied({ canonical, applied })).not.toThrow();
  });

  it("binds the exact contiguous canonical journal through 0204", () => {
    expect(canonical).toHaveLength(205);
    expect(canonical[0]?.tag.startsWith("0000_")).toBe(true);
    expect(canonical.at(-1)?.tag).toBe("0204_historical_preparation_events_v2");
  });

  it("refuses the old journal without required package storage", () => {
    expect(() => assertFhvV2CanonicalMigrationsApplied({ canonical,
      applied: canonical.filter((entry) => entry.idx !== 203).map((entry) => ({ hash: entry.hash, createdAt: String(entry.when) })),
    })).toThrow("0203_predictive_package_storage_v1 is not applied");
  });

  it("refuses missing preparation-event migration even when package storage exists", () => {
    expect(() => assertFhvV2CanonicalMigrationsApplied({ canonical,
      applied: canonical.filter((entry) => entry.idx !== 204).map((entry) => ({ hash: entry.hash, createdAt: String(entry.when) })),
    })).toThrow("0204_historical_preparation_events_v2 is not applied");
  });

  it.each(["trader_predictive_package_manifest_v1", "trader_predictive_package_chunk_v1",
    "trader_historical_preparation_event_v2"] as const)(
    "refuses missing %s even with a complete journal", (table) => {
      const present = new Set(FHV_V2_POSTGRES_REQUIRED_TABLES);
      present.delete(table);
      expect(() => assertFhvV2RequiredTablesPresent(present)).toThrow(table);
    },
  );

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
