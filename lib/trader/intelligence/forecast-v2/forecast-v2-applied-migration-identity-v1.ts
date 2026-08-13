/**
 * Truthful Forecast V2 applied-migration identity from Drizzle journal + DB hashes.
 * Drizzle stores sha256(full migration file bytes) in drizzle.__drizzle_migrations.hash.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type postgres from "postgres";

export const FORECAST_V2_STORAGE_MIGRATION_MIN = 110 as const;
/**
 * Physical storage-surface upper bound including Closure VI (0146/0147) and the
 * Human-ratified forward open-tail corrective 0148
 * (HUMAN-RATIFY-DEE-518-0148-FORWARD-CORRECTIVE-OPEN-TAILS-V1).
 */
export const FORECAST_V2_STORAGE_MIGRATION_MAX_EXPECTED = 148 as const;

/** Exact Human-ratified 0148 forward corrective migration identity (bytes). */
export const FORECAST_V2_RATIFIED_0148_MIGRATION_TAG =
  "0148_trader_forecast_v2_open_tail_null_bounds_v1" as const;
export const FORECAST_V2_RATIFIED_0148_MIGRATION_SHA256 =
  "b0e445468a89303cbe9dc8611e9194a9d9774113b0990fe03f02125621fad1e8" as const;

export type ForecastV2JournalMigrationEntryV1 = {
  idx: number;
  when: number;
  tag: string;
  contentHash: string;
  absolutePath: string;
};

export type ForecastV2AppliedMigrationBindingV1 = {
  tag: string;
  journalIdx: number;
  journalWhen: number;
  contentHash: string;
  dbHash: string;
  dbCreatedAt: string;
};

export type ForecastV2AppliedMigrationIdentityV1 = {
  schemaVersion: "forecast-v2-applied-migration-identity/v1";
  min: number;
  max: number;
  count: number;
  requiredClosureViTags: readonly [
    "0146_trader_forecast_v2_a3_storage_representation_v1",
    "0147_trader_forecast_v2_a3_storage_compaction_v1",
  ];
  bindings: ForecastV2AppliedMigrationBindingV1[];
  extraAppliedBeyondExpectedMax: ForecastV2AppliedMigrationBindingV1[];
};

type JournalFile = {
  entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
};

function sha256Hex(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export function readForecastV2JournalMigrationEntries(
  repoRoot: string,
  options?: { min?: number; maxInclusive?: number },
): ForecastV2JournalMigrationEntryV1[] {
  const min = options?.min ?? FORECAST_V2_STORAGE_MIGRATION_MIN;
  const maxInclusive = options?.maxInclusive;
  const migrationDir = join(repoRoot, "db/migrations_postgres");
  const journalPath = join(migrationDir, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as JournalFile;
  const out: ForecastV2JournalMigrationEntryV1[] = [];
  for (const entry of journal.entries) {
    const match = entry.tag.match(/^(\d{4})_/);
    if (!match) {
      throw new Error(`[forecast-v2/migration-identity] invalid journal tag: ${entry.tag}`);
    }
    const num = Number(match[1]);
    if (num < min) continue;
    if (maxInclusive !== undefined && num > maxInclusive) continue;
    const absolutePath = join(migrationDir, `${entry.tag}.sql`);
    const content = readFileSync(absolutePath);
    out.push({
      idx: entry.idx,
      when: entry.when,
      tag: entry.tag,
      contentHash: sha256Hex(content),
      absolutePath,
    });
  }
  return out.sort((a, b) => a.idx - b.idx || a.when - b.when);
}

export function assertJournalContainsExactMigration(
  entries: readonly ForecastV2JournalMigrationEntryV1[],
  tag: string,
  expectedContentHash: string,
): void {
  const found = entries.filter((e) => e.tag === tag);
  if (found.length !== 1) {
    throw new Error(
      `[forecast-v2/migration-identity] journal mismatch for ${tag}: found ${found.length}`,
    );
  }
  if (found[0]!.contentHash !== expectedContentHash) {
    throw new Error(
      `[forecast-v2/migration-identity] hash mismatch for ${tag}: journal/file=${found[0]!.contentHash} expected=${expectedContentHash}`,
    );
  }
}

/**
 * Pure binder used by unit negative tests: map journal entries to applied DB hashes.
 */
export function bindForecastV2AppliedMigrations(input: {
  journalEntries: readonly ForecastV2JournalMigrationEntryV1[];
  appliedByHash: ReadonlyMap<string, { createdAt: string }>;
  expectedMaxInclusive?: number;
}): ForecastV2AppliedMigrationIdentityV1 {
  const expectedMax = input.expectedMaxInclusive ?? FORECAST_V2_STORAGE_MIGRATION_MAX_EXPECTED;
  const requiredClosureViTags = [
    "0146_trader_forecast_v2_a3_storage_representation_v1",
    "0147_trader_forecast_v2_a3_storage_compaction_v1",
  ] as const;

  const bindings: ForecastV2AppliedMigrationBindingV1[] = [];
  for (const entry of input.journalEntries) {
    const applied = input.appliedByHash.get(entry.contentHash);
    if (!applied) {
      throw new Error(
        `[forecast-v2/migration-identity] missing applied migration for ${entry.tag} hash=${entry.contentHash}`,
      );
    }
    if (applied.createdAt !== String(entry.when)) {
      // Drizzle stores journal `when` as created_at; mismatch is fail-closed evidence drift.
      throw new Error(
        `[forecast-v2/migration-identity] created_at mismatch for ${entry.tag}: db=${applied.createdAt} journal.when=${entry.when}`,
      );
    }
    bindings.push({
      tag: entry.tag,
      journalIdx: entry.idx,
      journalWhen: entry.when,
      contentHash: entry.contentHash,
      dbHash: entry.contentHash,
      dbCreatedAt: applied.createdAt,
    });
  }

  for (const tag of requiredClosureViTags) {
    if (!bindings.some((b) => b.tag === tag)) {
      throw new Error(
        `[forecast-v2/migration-identity] required Closure VI migration missing: ${tag}`,
      );
    }
  }

  const extraAppliedBeyondExpectedMax = bindings.filter(
    (b) => Number(b.tag.slice(0, 4)) > expectedMax,
  );
  // Forecast V2 storage surface is sealed at 0148. Later Core/Treasury journal
  // entries are extras, not a Forecast V2 identity bump (DEE-606 0149–0151).
  const surfaceBindings = bindings.filter((b) => Number(b.tag.slice(0, 4)) <= expectedMax);

  const nums = surfaceBindings.map((b) => Number(b.tag.slice(0, 4)));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max < expectedMax) {
    throw new Error(
      `[forecast-v2/migration-identity] applied max=${max} below required storage surface max=${expectedMax}`,
    );
  }

  return {
    schemaVersion: "forecast-v2-applied-migration-identity/v1",
    min,
    max,
    count: surfaceBindings.length,
    requiredClosureViTags,
    bindings,
    extraAppliedBeyondExpectedMax,
  };
}

export async function assertForecastV2AppliedMigrationIdentity(
  sql: postgres.Sql,
  repoRoot: string,
): Promise<ForecastV2AppliedMigrationIdentityV1> {
  const journalEntries = readForecastV2JournalMigrationEntries(repoRoot, {
    min: FORECAST_V2_STORAGE_MIGRATION_MIN,
  });
  if (journalEntries.length === 0) {
    throw new Error("[forecast-v2/migration-identity] no journal entries in Forecast V2 range");
  }

  const appliedRows = await sql<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
  `;
  const appliedByHash = new Map(
    appliedRows.map((row) => [row.hash, { createdAt: row.created_at }]),
  );

  // Detect orphan applied hashes that collide with journal tags (wrong content).
  for (const entry of journalEntries) {
    const byWhen = appliedRows.find((row) => row.created_at === String(entry.when));
    if (byWhen && byWhen.hash !== entry.contentHash) {
      throw new Error(
        `[forecast-v2/migration-identity] hash mismatch for ${entry.tag}: db=${byWhen.hash} file=${entry.contentHash}`,
      );
    }
  }

  return bindForecastV2AppliedMigrations({
    journalEntries,
    appliedByHash,
    expectedMaxInclusive: FORECAST_V2_STORAGE_MIGRATION_MAX_EXPECTED,
  });
}
