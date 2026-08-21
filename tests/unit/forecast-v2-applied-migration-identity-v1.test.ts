import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FORECAST_V2_RATIFIED_0148_MIGRATION_SHA256,
  FORECAST_V2_RATIFIED_0148_MIGRATION_TAG,
  FORECAST_V2_STORAGE_MIGRATION_MAX_EXPECTED,
  bindForecastV2AppliedMigrations,
  readForecastV2JournalMigrationEntries,
} from "@/lib/trader/intelligence/forecast-v2/forecast-v2-applied-migration-identity-v1";

const REPO = process.cwd();

function hashFile(tag: string): string {
  return createHash("sha256")
    .update(readFileSync(join(REPO, "db/migrations_postgres", `${tag}.sql`)))
    .digest("hex");
}

describe("Forecast V2 applied migration identity", () => {
  it("binds journal content hashes through ratified 0148 with truthful max=148", () => {
    const journalEntries = readForecastV2JournalMigrationEntries(REPO, { min: 110 });
    const appliedByHash = new Map(
      journalEntries.map((e) => [e.contentHash, { createdAt: String(e.when) }]),
    );
    const identity = bindForecastV2AppliedMigrations({ journalEntries, appliedByHash });
    expect(identity.max).toBe(FORECAST_V2_STORAGE_MIGRATION_MAX_EXPECTED);
    expect(identity.max).toBe(148);
    expect(identity.bindings.some((b) => b.tag.startsWith("0146_"))).toBe(true);
    expect(identity.bindings.some((b) => b.tag.startsWith("0147_"))).toBe(true);
    expect(identity.bindings.some((b) => b.tag.startsWith("0148_"))).toBe(true);
    // Forecast V2 remains 0148; later Treasury/MI migrations are extras, not V2 identity.
    expect(identity.extraAppliedBeyondExpectedMax.map((b) => b.tag)).toEqual([
      "0149_treasury_transparency_ledger_foundation",
      "0150_treasury_transparency_ledger_rls",
      "0151_treasury_chain_observations_lifecycle_guard",
      "0152_trader_mi_pit_trust_as_of_v1",
      "0153_trader_mi_raw_capture_v1",
      "0154_treasury_central_ledger_catalogs",
      "0155_treasury_central_ledger_catalogs_rls",
    ]);
    expect(
      identity.extraAppliedBeyondExpectedMax.every((b) => !b.tag.includes("trader_forecast_v2")),
    ).toBe(true);
    expect(hashFile("0146_trader_forecast_v2_a3_storage_representation_v1")).toBe(
      identity.bindings.find((b) => b.tag.startsWith("0146_"))!.contentHash,
    );
    expect(hashFile("0147_trader_forecast_v2_a3_storage_compaction_v1")).toBe(
      identity.bindings.find((b) => b.tag.startsWith("0147_"))!.contentHash,
    );
    // Ratified 0148 bytes are pinned in the identity surface.
    expect(hashFile(FORECAST_V2_RATIFIED_0148_MIGRATION_TAG)).toBe(
      FORECAST_V2_RATIFIED_0148_MIGRATION_SHA256,
    );
    expect(identity.bindings.find((b) => b.tag.startsWith("0148_"))!.contentHash).toBe(
      FORECAST_V2_RATIFIED_0148_MIGRATION_SHA256,
    );
  });

  it("fails closed (old-schema max) when ratified 0148 is missing from applied set", () => {
    const journalEntries = readForecastV2JournalMigrationEntries(REPO, { min: 110 });
    const appliedByHash = new Map(
      journalEntries
        .filter((e) => !e.tag.startsWith("0148_"))
        .map((e) => [e.contentHash, { createdAt: String(e.when) }]),
    );
    expect(() => bindForecastV2AppliedMigrations({ journalEntries, appliedByHash })).toThrow(
      /0148_|missing applied migration|applied max=147 below required/,
    );
  });

  it("fails closed when 0148 bytes are modified (SHA drift)", () => {
    const journalEntries = readForecastV2JournalMigrationEntries(REPO, { min: 110 }).map((e) =>
      e.tag.startsWith("0148_") ? { ...e, contentHash: "cafe".repeat(16) } : e,
    );
    const appliedByHash = new Map(
      journalEntries
        .filter((e) => !e.tag.startsWith("0148_"))
        .map((e) => [e.contentHash, { createdAt: String(e.when) }]),
    );
    expect(() => bindForecastV2AppliedMigrations({ journalEntries, appliedByHash })).toThrow(
      /missing applied migration/,
    );
  });

  it("fails closed when 0147 is missing from applied set", () => {
    const journalEntries = readForecastV2JournalMigrationEntries(REPO, { min: 110 });
    const appliedByHash = new Map(
      journalEntries
        .filter((e) => !e.tag.startsWith("0147_"))
        .map((e) => [e.contentHash, { createdAt: String(e.when) }]),
    );
    expect(() => bindForecastV2AppliedMigrations({ journalEntries, appliedByHash })).toThrow(
      /0147_|missing applied migration/,
    );
  });

  it("fails closed when 0146 is missing from applied set", () => {
    const journalEntries = readForecastV2JournalMigrationEntries(REPO, { min: 110 });
    const appliedByHash = new Map(
      journalEntries
        .filter((e) => !e.tag.startsWith("0146_"))
        .map((e) => [e.contentHash, { createdAt: String(e.when) }]),
    );
    expect(() => bindForecastV2AppliedMigrations({ journalEntries, appliedByHash })).toThrow(
      /0146_|missing applied migration/,
    );
  });

  it("fails closed on content hash mismatch (wrong applied hash for tag when)", () => {
    const journalEntries = readForecastV2JournalMigrationEntries(REPO, { min: 110 });
    const appliedByHash = new Map(
      journalEntries.map((e) => [e.contentHash, { createdAt: String(e.when) }]),
    );
    const last = journalEntries[journalEntries.length - 1]!;
    appliedByHash.delete(last.contentHash);
    appliedByHash.set("deadbeef".repeat(8), { createdAt: String(last.when) });
    expect(() => bindForecastV2AppliedMigrations({ journalEntries, appliedByHash })).toThrow(
      /missing applied migration/,
    );
  });

  it("fails closed on journal.when / created_at mismatch", () => {
    const journalEntries = readForecastV2JournalMigrationEntries(REPO, { min: 110 });
    const appliedByHash = new Map(
      journalEntries.map((e) => [e.contentHash, { createdAt: String(e.when + 1) }]),
    );
    expect(() => bindForecastV2AppliedMigrations({ journalEntries, appliedByHash })).toThrow(
      /created_at mismatch/,
    );
  });

  it("detects an unexpected extra migration beyond ratified 0148 (synthetic 0149)", () => {
    const journalEntries = [
      ...readForecastV2JournalMigrationEntries(REPO, { min: 110 }),
      {
        idx: 149,
        when: 1780000000149,
        tag: "0149_synthetic_extra_migration_v1",
        contentHash: "ab".repeat(32),
        absolutePath: "/tmp/0149_synthetic_extra_migration_v1.sql",
      },
    ];
    const appliedByHash = new Map(
      journalEntries.map((e) => [e.contentHash, { createdAt: String(e.when) }]),
    );
    const identity = bindForecastV2AppliedMigrations({ journalEntries, appliedByHash });
    expect(identity.max).toBe(FORECAST_V2_STORAGE_MIGRATION_MAX_EXPECTED);
    // Unexpected migration beyond the ratified surface max=148 MUST be surfaced,
    // alongside any already-present post-0148 Core/Treasury extras.
    expect(identity.extraAppliedBeyondExpectedMax.map((b) => b.tag)).toContain(
      "0149_synthetic_extra_migration_v1",
    );
  });
});
