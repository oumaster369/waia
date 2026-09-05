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
    // The ratified Closure VI/A3 identity remains 0148. Later migrations, including
    // complementary Forecast constraints, are surfaced as extras rather than rewriting it.
    expect(identity.extraAppliedBeyondExpectedMax.map((b) => b.tag)).toEqual([
      "0149_treasury_transparency_ledger_foundation",
      "0150_treasury_transparency_ledger_rls",
      "0151_treasury_chain_observations_lifecycle_guard",
      "0152_trader_mi_pit_trust_as_of_v1",
      "0153_trader_mi_raw_capture_v1",
      "0154_treasury_central_ledger_catalogs",
      "0155_treasury_central_ledger_catalogs_rls",
      "0156_trader_risk_v2",
      "0157_trader_execution_v2",
      "0158_treasury_category_budget_history",
      "0159_treasury_category_budget_history_rls",
      "0160_trader_reality_v2",
      "0161_trader_mi_canonical_pit_lineage_v1",
      "0162_trader_information_sufficiency_v2",
      "0163_treasury_fund_allocation_evidence",
      "0164_treasury_fund_allocation_evidence_rls",
      "0165_treasury_finance_assistant_confirmations",
      "0166_treasury_finance_assistant_confirmations_rls",
      "0167_trader_canonical_causal_lineage_v1",
      "0168_trader_intelligence_cycle_causal_input_bundle_v2",
      "0169_trader_forecast_contract_binding_v1",
      "0170_trader_forecast_contract_binding_v1_rls",
      "0171_treasury_contribution_payment_intents",
      "0172_treasury_contribution_payment_intents_rls",
      "0173_dee633_forecast_v2_feedback_payload",
      "0174_waia_admin_hr",
      "0175_waia_admin_hr_rls",
      "0176_dee635_order_opening_causal_lineage",
      "0177_dee635_lifecycle_opening_causal_lineage",
      "0178_dee635_risk_causal_projection",
      "0179_dee635_execution_plan_causal_projection",
      "0180_dee635_trade_leg_reference_guards",
      "0181_dee636_guardian_assessment_v2",
      "0182_dee637_runtime_authority_v2",
      "0183_historical_simulation_v2_evidence",
      "0184_historical_simulation_observed_execution_effects_v2",
      "0185_dee659_durable_authority_bundle_v2",
      "0186_historical_simulation_dataset_membership_v2",
      "0187_canonical_decision_verification_receipt_v2",
      "0188_historical_simulation_atomic_cycle_resume_v2",
      "0189_historical_forecast_input_pit_v2",
      "0190_internal_guardian_runtime_privilege_revoke",
      "0191_historical_preholdout_dataset_authority_v2",
      "0192_forecast_v2_symbol_binding",
      "0193_historical_runner_knowledge_state_read",
      "0194_historical_four_surface_ratified_admission_v2",
      "0195_historical_information_sufficiency_authority_v2",
      "0196_historical_dynamic_cycle_information_authority_v2",
      "0197_historical_modeled_reality_stage_v2",
      "0198_historical_simulation_run_lifecycle_v2",
      "0199_historical_runner_least_privilege_v2",
      "0200_historical_knowledge_checkpoint_namespace_v2",
      "0201_historical_ratification_split_v2",
      "0202_historical_accounting_semantic_state_v2",
    ]);
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
