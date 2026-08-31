import { describe, expect, it } from "vitest";

import {
  assertFhvV2CanonicalMigrationsApplied,
  assertFhvV2RequiredTablesPresent,
  FHV_V2_POSTGRES_REQUIRED_TABLES,
  readFhvV2CanonicalMigrations,
} from "@/lib/trader/observability/fhv-v2-postgres-schema-preflight";

describe("FHV V2 PostgreSQL schema preflight", () => {
  const canonical = readFhvV2CanonicalMigrations(process.cwd());

  it("binds the exact contiguous canonical journal through 0182", () => {
    expect(canonical).toHaveLength(183);
    expect(canonical[0]?.tag.startsWith("0000_")).toBe(true);
    expect(canonical.at(-1)?.tag.startsWith("0182_")).toBe(true);
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
