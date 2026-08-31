import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type postgres from "postgres";

import { getPostgresSql } from "@/db/postgres-client";

export const FHV_V2_POSTGRES_REQUIRED_MIGRATION_MAX = 183 as const;

export const FHV_V2_POSTGRES_REQUIRED_TABLES = [
  "trader_forecast_target_definition_v2",
  "trader_forecast_target_bucket_v2",
  "trader_forecast_predictive_package_v2",
  "trader_forecast_predictive_package_target_v2",
  "trader_forecast_replica_artifact_v2",
  "trader_forecast_bundle_v2",
  "trader_forecast_v2",
  "trader_forecast_scenario_v2",
  "trader_forecast_outcome_v2",
  "trader_forecast_calibration_observation_v2",
  "trader_pattern_definition_v1",
  "trader_pattern_occurrence_v1",
  "trader_knowledge_state_checkpoint_v2",
  "trader_research_trial_registration_v1",
  "trader_htx_volume_qualification_receipt_v1",
  "trader_intelligence_decision_economics_v2",
  "trader_scientific_admission_receipt_v1",
  "trader_control_replay_authority_claim_v1",
  "trader_orders",
  "trader_fills",
  "trader_trades",
  "trader_position_lots",
  "trader_trade_legs",
  "trader_lifecycle_events",
  "trader_accounting_frontier",
  "trader_risk_account_state_v2",
  "trader_risk_verdicts_v2",
  "trader_risk_allowances_v2",
  "trader_risk_enforcement_events_v2",
  "trader_execution_policies_v2",
  "trader_execution_plans_v2",
  "trader_execution_attempts_v2",
  "trader_execution_reports_v2",
  "trader_mi_source",
  "trader_mi_raw_storage_binding_v1",
  "trader_mi_raw_capture_receipt_v1",
  "trader_mi_raw_validation_receipt_v1",
  "trader_reality_raw_source_admissions_v2",
  "trader_reality_knowledge_frontiers_v2",
  "trader_reality_source_reports_v2",
  "trader_reality_truth_records_v2",
  "trader_reality_events_v2",
  "trader_reality_projections_v2",
  "trader_required_information_profile_v2",
  "trader_information_sufficiency_receipt_v2",
  "trader_forecast_contract_binding_v1",
  "trader_forecast_pit_bar_v2",
  "trader_forecast_pit_bar_retention_audit_v2",
  "trader_forecast_pit_bar_retention_guard_v2",
  "trader_guardian_assessments_v2",
  "trader_guardian_protective_consumptions_v2",
  "trader_runtime_authority_assessments_v2",
  "trader_runtime_control_lease_heads_v2",
  "trader_runtime_control_lease_epoch_history_v2",
  "trader_historical_simulation_reason_ledger_v2",
  "trader_historical_simulation_modeled_evidence_v2",
] as const;

type Journal = {
  entries: Array<{ idx: number; when: number; tag: string }>;
};

export type FhvV2CanonicalMigration = Readonly<{
  idx: number;
  when: number;
  tag: string;
  hash: string;
}>;

export type FhvV2AppliedMigration = Readonly<{
  hash: string;
  createdAt: string;
}>;

export class FhvV2PostgresSchemaPreflightError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`[fhv-v2/postgres-preflight] ${code}: ${message}`);
    this.name = "FhvV2PostgresSchemaPreflightError";
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readFhvV2CanonicalMigrations(repoRoot: string): FhvV2CanonicalMigration[] {
  const migrationRoot = join(repoRoot, "db/migrations_postgres");
  const journal = JSON.parse(readFileSync(join(migrationRoot, "meta/_journal.json"), "utf8")) as Journal;
  const required = journal.entries.filter((entry) => entry.idx <= FHV_V2_POSTGRES_REQUIRED_MIGRATION_MAX);
  if (required.length !== FHV_V2_POSTGRES_REQUIRED_MIGRATION_MAX + 1) {
    throw new FhvV2PostgresSchemaPreflightError(
      "CANONICAL_JOURNAL_RANGE_INVALID",
      `expected migrations 0000..${String(FHV_V2_POSTGRES_REQUIRED_MIGRATION_MAX).padStart(4, "0")}, found ${required.length}`,
    );
  }
  return required.map((entry, expectedIdx) => {
    const migrationNumber = Number(entry.tag.slice(0, 4));
    if (entry.idx !== expectedIdx || migrationNumber !== expectedIdx) {
      throw new FhvV2PostgresSchemaPreflightError(
        "CANONICAL_JOURNAL_GAP",
        `expected migration ${String(expectedIdx).padStart(4, "0")}, found idx=${entry.idx} tag=${entry.tag}`,
      );
    }
    return {
      idx: entry.idx,
      when: entry.when,
      tag: entry.tag,
      hash: sha256(readFileSync(join(migrationRoot, `${entry.tag}.sql`))),
    };
  });
}

export function assertFhvV2CanonicalMigrationsApplied(input: {
  canonical: readonly FhvV2CanonicalMigration[];
  applied: readonly FhvV2AppliedMigration[];
}): void {
  const appliedByCreatedAt = new Map(input.applied.map((row) => [row.createdAt, row.hash]));
  const canonicalHashes = new Set(input.canonical.map((entry) => entry.hash));
  for (const entry of input.canonical) {
    const appliedHash = appliedByCreatedAt.get(String(entry.when));
    if (!appliedHash) {
      throw new FhvV2PostgresSchemaPreflightError(
        "REQUIRED_MIGRATION_MISSING",
        `${entry.tag} is not applied`,
      );
    }
    if (appliedHash !== entry.hash) {
      throw new FhvV2PostgresSchemaPreflightError(
        "APPLIED_MIGRATION_HASH_MISMATCH",
        `${entry.tag} database=${appliedHash} checkout=${entry.hash}`,
      );
    }
  }
  const orphan = input.applied.find((row) => !canonicalHashes.has(row.hash));
  if (orphan) {
    throw new FhvV2PostgresSchemaPreflightError(
      "UNKNOWN_APPLIED_MIGRATION",
      `database contains non-canonical migration hash=${orphan.hash}`,
    );
  }
}

export function assertFhvV2RequiredTablesPresent(presentTables: ReadonlySet<string>): void {
  for (const table of FHV_V2_POSTGRES_REQUIRED_TABLES) {
    if (!presentTables.has(table)) {
      throw new FhvV2PostgresSchemaPreflightError(
        "REQUIRED_V2_TABLE_MISSING",
        `public.${table} is absent after canonical migration verification`,
      );
    }
  }
}

export async function assertFhvV2PostgresSchemaPreflight(input?: {
  sql?: postgres.Sql;
  repoRoot?: string;
}): Promise<void> {
  const sql = input?.sql ?? getPostgresSql();
  const canonical = readFhvV2CanonicalMigrations(input?.repoRoot ?? process.cwd());
  const rows = await sql<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at
  `;
  assertFhvV2CanonicalMigrationsApplied({
    canonical,
    applied: rows.map((row) => ({ hash: row.hash, createdAt: row.created_at })),
  });
  const presentTables = new Set<string>();
  for (const table of FHV_V2_POSTGRES_REQUIRED_TABLES) {
    const relation = await sql.unsafe<{ relation: string | null }[]>(
      "SELECT to_regclass($1)::text AS relation",
      [`public.${table}`],
    );
    if (relation[0]?.relation) {
      presentTables.add(table);
    }
  }
  assertFhvV2RequiredTablesPresent(presentTables);
}
