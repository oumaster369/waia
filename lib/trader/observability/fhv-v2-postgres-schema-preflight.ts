import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type postgres from "postgres";

import { getPostgresSql } from "@/db/postgres-client";

// Corrected Cody evidence admission requires the exact 0207 policy.
export const FHV_V2_POSTGRES_REQUIRED_MIGRATION_MAX = 207 as const;

// Explicit compatibility admission, not automatic acceptance of every future
// journal entry. 0205 and 0206 remain inside the required prefix through 0207.
// 0208 is DEE-1006 terminal-receipt storage: admitted after Cody, never a
// substitute for the required 0000..0207 prefix.
// 0209 is DEE-871 AI-TWIN epistemic persistence: unrelated additive tables,
// never a substitute for the required prefix or a required FHV table.
// 0210 is DEE-1015 account-observation credential authority: one NOLOGIN role plus
// narrow column grants and assignment-bound SELECT policies. It creates no table and
// grants the FHV plane nothing, so it is compatibility-admitted only.
// 0211 is DEE-771 versioned append-only Knowledge authority. It creates Knowledge
// version/verification tables and does not add FHV required tables, so it is
// compatibility-admitted only. It is not an H2 or post-H2 production operator step.
// 0212 and 0213 are DEE-1049 additive Human promotion tables: one proposal table
// and one research-assignment table, then deny-by-default RLS. They add no required
// FHV table. RLS denies SELECT, INSERT, UPDATE, and DELETE to authenticated and anon.
// This admission is not an H2 or post-H2 production operator step.
// 0214 and 0215 are DEE-1050 additive admin console tables + deny-by-default RLS.
// 0216 is DEE-1071 id-only change-log triggers on existing tables. No required FHV
// table. Not an H2 or post-H2 production operator step.
// 0217 adds read-only lookup indexes on existing immutable observations; no
// required FHV table, data rewrite, grant or policy change.
// 0218 adds isolated append-only noncapital cycle receipts with deny browser RLS
// and a lease fence. It adds no required FHV table, modifies no historical data,
// and is not an H2/post-H2 production operator step or a scientific admission.
const COMPATIBLE_ADDITIVE_MIGRATIONS: readonly { idx: number; when: number; tag: string }[] = [
  { idx: 208, when: 1780000000208, tag: "0208_historical_terminal_receipts_v1" },
  { idx: 209, when: 1780000000209, tag: "0209_ai_twin_epistemic_persistence_v1" },
  { idx: 210, when: 1780000000210, tag: "0210_trader_account_observation_credential_v1" },
  { idx: 211, when: 1780000000211, tag: "0211_trader_knowledge_edge_version_v2" },
  { idx: 212, when: 1780000000212, tag: "0212_trader_human_promotion_tables_v2" },
  { idx: 213, when: 1780000000213, tag: "0213_trader_human_promotion_tables_rls_v2" },
  { idx: 214, when: 1780000000214, tag: "0214_trader_admin_console_v2" },
  { idx: 215, when: 1780000000215, tag: "0215_trader_admin_console_v2_rls" },
  { idx: 216, when: 1780000000216, tag: "0216_trader_admin_change_log_triggers" },
  { idx: 217, when: 1780000000217, tag: "0217_admin_observation_read_indexes" },
  { idx: 218, when: 1780000000218, tag: "0218_trader_runtime_noncapital_cycles_v2" },
];

export const FHV_V2_POSTGRES_REQUIRED_TABLES = [
  "trader_forecast_target_definition_v2",
  "trader_forecast_target_bucket_v2",
  "trader_forecast_predictive_package_v2",
  "trader_predictive_package_manifest_v1",
  "trader_predictive_package_chunk_v1",
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
  "trader_dee659_authority_bundle_v2",
  "trader_canonical_decision_verification_subject_v2",
  "trader_canonical_decision_verification_receipt_v2",
  "trader_dee659_authority_preregistration_v2",
  "trader_historical_simulation_run_start_v2",
  "trader_historical_dataset_authority_v2",
  "trader_historical_simulation_policy_config_v2",
  "trader_historical_simulation_atomic_stage_v2",
  "trader_historical_simulation_durable_snapshot_v2",
  "trader_historical_simulation_resume_checkpoint_v2",
  "trader_historical_simulation_resume_stage_link_v2",
  "trader_historical_simulation_resume_snapshot_link_v2",
  "trader_forecast_runtime_input_source_v2",
  "trader_historical_forecast_input_pit_v2",
  "trader_historical_forecast_input_knowledge_link_v2",
  "trader_historical_four_surface_ratified_admission_v2",
  "trader_historical_simulation_run_lifecycle_event_v2",
  "trader_historical_ratification_request_v2",
  "trader_historical_qualified_execution_extent_v2",
  "trader_historical_technical_proposal_v2",
  "trader_historical_proposal_ratification_v2",
  "trader_historical_preparation_event_v2",
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
  const journal = JSON.parse(
    readFileSync(join(migrationRoot, "meta/_journal.json"), "utf8"),
  ) as Journal;
  const required = journal.entries.filter(
    (entry) => entry.idx <= FHV_V2_POSTGRES_REQUIRED_MIGRATION_MAX,
  );
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
  compatibleAdditive?: readonly FhvV2CanonicalMigration[];
  applied: readonly FhvV2AppliedMigration[];
}): void {
  const compatible = input.compatibleAdditive ?? [];
  const known = [...input.canonical, ...compatible];
  const knownByCreatedAt = new Map(known.map((entry) => [String(entry.when), entry]));
  const appliedByCreatedAt = new Map(input.applied.map((row) => [row.createdAt, row.hash]));
  if (
    appliedByCreatedAt.size !== input.applied.length ||
    new Set(input.applied.map((row) => row.hash)).size !== input.applied.length
  ) {
    throw new FhvV2PostgresSchemaPreflightError(
      "DUPLICATE_APPLIED_MIGRATION",
      "applied journal contains duplicate identities",
    );
  }
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
  for (const row of input.applied) {
    const entry = knownByCreatedAt.get(row.createdAt);
    if (!entry) {
      throw new FhvV2PostgresSchemaPreflightError(
        "UNKNOWN_APPLIED_MIGRATION",
        `database contains non-canonical migration identity=${row.createdAt}`,
      );
    }
    if (row.hash !== entry.hash) {
      throw new FhvV2PostgresSchemaPreflightError(
        "APPLIED_MIGRATION_HASH_MISMATCH",
        `${entry.tag} database=${row.hash} checkout=${entry.hash}`,
      );
    }
  }
}

export function readFhvV2CompatibleAdditiveMigrations(repoRoot: string): FhvV2CanonicalMigration[] {
  const root = join(repoRoot, "db/migrations_postgres");
  const journal = JSON.parse(readFileSync(join(root, "meta/_journal.json"), "utf8")) as Journal;
  return COMPATIBLE_ADDITIVE_MIGRATIONS.map((identity) => {
    const entries = journal.entries.filter(
      (entry) =>
        entry.idx === identity.idx || entry.when === identity.when || entry.tag === identity.tag,
    );
    if (
      entries.length !== 1 ||
      entries[0].idx !== identity.idx ||
      entries[0].when !== identity.when ||
      entries[0].tag !== identity.tag
    ) {
      throw new FhvV2PostgresSchemaPreflightError(
        "COMPATIBLE_MIGRATION_IDENTITY_INVALID",
        identity.tag,
      );
    }
    return { ...identity, hash: sha256(readFileSync(join(root, `${identity.tag}.sql`))) };
  });
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
  const compatibleAdditive = readFhvV2CompatibleAdditiveMigrations(
    input?.repoRoot ?? process.cwd(),
  );
  const rows = await sql<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at
  `;
  assertFhvV2CanonicalMigrationsApplied({
    canonical,
    compatibleAdditive,
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
