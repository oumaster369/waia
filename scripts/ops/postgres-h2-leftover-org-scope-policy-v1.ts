/**
 * DEE-1022: frozen leftover `waia_historical_runner_org_scope` identity.
 *
 * Partner Alpha0 production (journal `0000..0205`) still carries a permissive `FOR ALL`
 * (`polcmd=*`) policy that is absent from git migrations. PostgreSQL ORs permissive
 * policies, so that leftover would authorize `waia_historical_runner` INSERT even after
 * 0206 installs the Brier WITH CHECK. Hygiene DROPs this name only. It does not CREATE
 * `org_select_v2` on relations whose 0201 posture is `exact_*`, and it does not invent
 * SELECT on `trader_lifecycle_events`.
 */

export const LEFTOVER_ORG_SCOPE_POLICY_NAME = "waia_historical_runner_org_scope" as const;
export const HISTORICAL_SCIENTIFIC_ADMISSION_RUNNER_INSERT_POLICY =
  "historical_scientific_admission_runner_insert_v2" as const;
export const ORG_SELECT_V2_POLICY_NAME = "waia_historical_runner_org_select_v2" as const;
export const RUNNER_EXACT_SELECT_POLICY = "waia_historical_runner_exact_select_v2" as const;
export const RUNNER_EXACT_INSERT_POLICY = "waia_historical_runner_exact_insert_v2" as const;
export const RUNNER_EXACT_UPDATE_POLICY = "waia_historical_runner_exact_update_v2" as const;

export const AUTHORIZED_PARTNER_ALPHA0_ORG_ID = "3c50b4e9-1138-43a5-a29f-e65088124cfc" as const;

/** Exact `pg_get_expr` form observed on the Partner Alpha0 leftover policies. */
export const LEFTOVER_ORG_SCOPE_USING_EXPRESSION =
  `(organization_id = '${AUTHORIZED_PARTNER_ALPHA0_ORG_ID}'::uuid)` as const;

export const LEFTOVER_ORG_SCOPE_RELATIONS = Object.freeze([
  "trader_accounting_frontier",
  "trader_canonical_decision_verification_receipt_v2",
  "trader_canonical_decision_verification_subject_v2",
  "trader_dee659_authority_bundle_v2",
  "trader_dee659_authority_preregistration_v2",
  "trader_fills",
  "trader_forecast_bundle_v2",
  "trader_forecast_contract_binding_v1",
  "trader_forecast_predictive_package_v2",
  "trader_forecast_runtime_input_source_v2",
  "trader_forecast_v2",
  "trader_historical_dataset_authority_v2",
  "trader_historical_forecast_input_knowledge_link_v2",
  "trader_historical_forecast_input_pit_v2",
  "trader_historical_simulation_atomic_stage_v2",
  "trader_historical_simulation_durable_snapshot_v2",
  "trader_historical_simulation_modeled_evidence_v2",
  "trader_historical_simulation_policy_config_v2",
  "trader_historical_simulation_reason_ledger_v2",
  "trader_historical_simulation_resume_checkpoint_v2",
  "trader_historical_simulation_resume_snapshot_link_v2",
  "trader_historical_simulation_resume_stage_link_v2",
  "trader_historical_simulation_run_start_v2",
  "trader_knowledge_confidence_update_record",
  "trader_lifecycle_events",
  "trader_order_events",
  "trader_orders",
  "trader_scientific_admission_receipt_v1",
] as const);

export type LeftoverOrgScopeRelation = (typeof LEFTOVER_ORG_SCOPE_RELATIONS)[number];

/** 0201 replaced `org_select_v2` with exact-run policies. Do not recreate SELECT here. */
export const EXACT_RUN_RELATIONS = Object.freeze([
  "trader_accounting_frontier",
  "trader_fills",
  "trader_order_events",
  "trader_orders",
] as const);

/**
 * 0199 never journaled SELECT on this relation. DROP of leftover ALL restores deny-all.
 * Creating `org_select_v2` here would invent access.
 */
export const LIFECYCLE_EVENTS_RELATION = "trader_lifecycle_events" as const;

export const KEEP_ORG_SELECT_V2_RELATIONS = Object.freeze([
  "trader_canonical_decision_verification_receipt_v2",
  "trader_canonical_decision_verification_subject_v2",
  "trader_dee659_authority_bundle_v2",
  "trader_dee659_authority_preregistration_v2",
  "trader_forecast_bundle_v2",
  "trader_forecast_contract_binding_v1",
  "trader_forecast_predictive_package_v2",
  "trader_forecast_runtime_input_source_v2",
  "trader_forecast_v2",
  "trader_historical_dataset_authority_v2",
  "trader_historical_forecast_input_knowledge_link_v2",
  "trader_historical_forecast_input_pit_v2",
  "trader_historical_simulation_atomic_stage_v2",
  "trader_historical_simulation_durable_snapshot_v2",
  "trader_historical_simulation_modeled_evidence_v2",
  "trader_historical_simulation_policy_config_v2",
  "trader_historical_simulation_reason_ledger_v2",
  "trader_historical_simulation_resume_checkpoint_v2",
  "trader_historical_simulation_resume_snapshot_link_v2",
  "trader_historical_simulation_resume_stage_link_v2",
  "trader_historical_simulation_run_start_v2",
  "trader_knowledge_confidence_update_record",
  "trader_scientific_admission_receipt_v1",
] as const);

export type RunnerPolicySnapshot = Readonly<{
  policyName: string;
  command: string;
  permissive: boolean;
  roles: readonly string[];
}>;

export function extraInsertApplicableRunnerPolicies(
  policies: readonly RunnerPolicySnapshot[],
): readonly string[] {
  return policies
    .filter(
      (policy) =>
        policy.permissive &&
        (policy.command === "a" || policy.command === "*") &&
        policy.roles.includes("waia_historical_runner") &&
        policy.policyName !== HISTORICAL_SCIENTIFIC_ADMISSION_RUNNER_INSERT_POLICY,
    )
    .map((policy) => policy.policyName)
    .sort();
}

export function leftoverOrgScopeInventoryIdentity(
  rows: readonly Readonly<{
    relationName: string;
    policyName: string;
    command: string;
    permissive: boolean;
    roles: readonly string[];
    usingExpression: string | null;
    checkExpression: string | null;
  }>[],
): Readonly<{
  matchesFrozenInventory: boolean;
  relationNames: readonly string[];
}> {
  const relationNames = rows.map((row) => row.relationName).sort();
  const expected = [...LEFTOVER_ORG_SCOPE_RELATIONS];
  const matchesFrozenInventory =
    rows.length === LEFTOVER_ORG_SCOPE_RELATIONS.length &&
    relationNames.join("\0") === expected.join("\0") &&
    rows.every(
      (row) =>
        row.policyName === LEFTOVER_ORG_SCOPE_POLICY_NAME &&
        row.command === "*" &&
        row.permissive &&
        JSON.stringify([...row.roles].sort()) === JSON.stringify(["waia_historical_runner"]) &&
        row.usingExpression === LEFTOVER_ORG_SCOPE_USING_EXPRESSION &&
        row.checkExpression === LEFTOVER_ORG_SCOPE_USING_EXPRESSION,
    );
  return Object.freeze({ matchesFrozenInventory, relationNames });
}
