-- DEE-920: exact least-privilege database surface for the dedicated Historical V2 runner.
-- This role is deliberately organization-bound and non-capital: it receives no privilege on
-- private credentials or canonical live Risk / Execution / Reality authority tables.
DO $do$
DECLARE
  authorized_organization constant uuid := '3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid;
  relation_name text;
  runner record;
  read_relations constant text[] := ARRAY[
    'trader_historical_simulation_run_lifecycle_event_v2',
    'organization_members',
    'trader_historical_simulation_run_start_v2',
    'trader_historical_dataset_authority_v2',
    'trader_historical_simulation_policy_config_v2',
    'trader_historical_forecast_input_pit_v2',
    'trader_historical_forecast_input_knowledge_link_v2',
    'trader_historical_four_surface_ratified_admission_v2',
    'trader_dee659_authority_preregistration_v2',
    'trader_dee659_authority_bundle_v2',
    'trader_canonical_decision_verification_subject_v2',
    'trader_canonical_decision_verification_receipt_v2',
    'trader_historical_simulation_reason_ledger_v2',
    'trader_historical_simulation_modeled_evidence_v2',
    'trader_historical_simulation_atomic_stage_v2',
    'trader_historical_simulation_durable_snapshot_v2',
    'trader_historical_simulation_resume_checkpoint_v2',
    'trader_historical_simulation_resume_stage_link_v2',
    'trader_historical_simulation_resume_snapshot_link_v2',
    'trader_forecast_target_definition_v2',
    'trader_forecast_target_bucket_v2',
    'trader_forecast_predictive_package_v2',
    'trader_forecast_predictive_package_target_v2',
    'trader_forecast_replica_artifact_v2',
    'trader_forecast_bundle_v2',
    'trader_forecast_v2',
    'trader_forecast_scenario_v2',
    'trader_forecast_outcome_v2',
    'trader_forecast_calibration_observation_v2',
    'trader_forecast_pit_bar_v2',
    'trader_forecast_runtime_input_source_v2',
    'trader_forecast_contract_binding_v1',
    'trader_scientific_admission_receipt_v1',
    'trader_required_information_profile_v2',
    'trader_information_sufficiency_receipt_v2',
    'trader_mi_source',
    'trader_mi_trust_as_of_receipt_v1',
    'trader_mi_observation',
    'trader_mi_gateway_pit_receipt_v1',
    'trader_mi_canonical_measurement_definition_v1',
    'trader_mi_canonical_measurement_value_v1',
    'trader_mi_canonical_measurement_value_input_v1',
    'trader_mi_hypothesis',
    'trader_mi_hypothesis_lifecycle',
    'trader_mi_evidence',
    'trader_mi_trial',
    'trader_knowledge_edges',
    'trader_market_events',
    'trader_market_predictions',
    'trader_intelligence_cycle_envelope',
    'trader_intelligence_hypothesis_record',
    'trader_intelligence_conviction_record',
    'trader_intelligence_forecast_record',
    'trader_intelligence_decision_record',
    'trader_intelligence_decision_forecast_link',
    'trader_intelligence_entry_purpose_record',
    'trader_knowledge_confidence_update_record',
    'trader_knowledge_state_checkpoint_v2',
    'trader_orders',
    'trader_order_events',
    'trader_fills',
    'trader_fill_execution_economics',
    'trader_accounting_frontier'
  ];
  insert_relations constant text[] := ARRAY[
    'trader_historical_simulation_run_lifecycle_event_v2',
    'trader_historical_simulation_run_start_v2',
    'trader_historical_simulation_policy_config_v2',
    'trader_historical_dataset_authority_v2',
    'trader_historical_forecast_input_pit_v2',
    'trader_historical_forecast_input_knowledge_link_v2',
    'trader_dee659_authority_preregistration_v2',
    'trader_dee659_authority_bundle_v2',
    'trader_canonical_decision_verification_subject_v2',
    'trader_canonical_decision_verification_receipt_v2',
    'trader_historical_simulation_reason_ledger_v2',
    'trader_historical_simulation_modeled_evidence_v2',
    'trader_historical_simulation_atomic_stage_v2',
    'trader_historical_simulation_durable_snapshot_v2',
    'trader_historical_simulation_resume_checkpoint_v2',
    'trader_historical_simulation_resume_stage_link_v2',
    'trader_historical_simulation_resume_snapshot_link_v2',
    'trader_forecast_target_definition_v2',
    'trader_forecast_target_bucket_v2',
    'trader_forecast_predictive_package_v2',
    'trader_forecast_predictive_package_target_v2',
    'trader_forecast_replica_artifact_v2',
    'trader_forecast_bundle_v2',
    'trader_forecast_v2',
    'trader_forecast_scenario_v2',
    'trader_forecast_outcome_v2',
    'trader_forecast_calibration_observation_v2',
    'trader_forecast_pit_bar_v2',
    'trader_forecast_runtime_input_source_v2',
    'trader_forecast_contract_binding_v1',
    'trader_required_information_profile_v2',
    'trader_information_sufficiency_receipt_v2',
    'trader_mi_observation',
    'trader_mi_gateway_pit_receipt_v1',
    'trader_mi_canonical_measurement_definition_v1',
    'trader_mi_canonical_measurement_value_v1',
    'trader_mi_canonical_measurement_value_input_v1',
    'trader_knowledge_edges',
    'trader_knowledge_confidence_update_record',
    'trader_knowledge_state_checkpoint_v2',
    'trader_intelligence_cycle_envelope',
    'trader_intelligence_hypothesis_record',
    'trader_intelligence_conviction_record',
    'trader_orders',
    'trader_order_events',
    'trader_fills',
    'trader_fill_execution_economics',
    'trader_accounting_frontier'
  ];
  update_relations constant text[] := ARRAY['trader_orders'];
BEGIN
  ALTER ROLE waia_historical_runner
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
    CONNECTION LIMIT -1;
  SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
    rolreplication, rolbypassrls INTO runner
  FROM pg_roles WHERE rolname = 'waia_historical_runner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'waia_historical_runner role must be provisioned before migration 0199';
  END IF;
  IF runner.rolcanlogin OR runner.rolinherit OR runner.rolsuper OR runner.rolcreatedb OR
      runner.rolcreaterole OR runner.rolreplication OR runner.rolbypassrls OR EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles member ON member.oid = membership.member
    WHERE member.rolname = 'waia_historical_runner'
  ) THEN
    RAISE EXCEPTION 'waia_historical_runner must be exact NOLOGIN/NOINHERIT and inherit no roles';
  END IF;

  GRANT USAGE ON SCHEMA public, drizzle TO waia_historical_runner;
  REVOKE ALL PRIVILEGES ON TABLE drizzle.__drizzle_migrations FROM waia_historical_runner;
  GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO waia_historical_runner;

  FOREACH relation_name IN ARRAY read_relations LOOP
    IF to_regclass(format('public.%I', relation_name)) IS NULL THEN
      RAISE EXCEPTION 'migration 0199 required relation public.% is absent', relation_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = relation_name
        AND column_name = 'organization_id'
    ) THEN
      RAISE EXCEPTION 'migration 0199 relation public.% is not organization-scoped', relation_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    -- Replace the earlier PUBLIC/current_user policies from targeted 0193/0194 with policies
    -- addressed directly to the runner role.
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_runner_org_select ON public.%I', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_runner_org_select_v2 ON public.%I', relation_name);
    EXECUTE format(
      'CREATE POLICY waia_historical_runner_org_select_v2 ON public.%I FOR SELECT TO waia_historical_runner USING (organization_id = %L::uuid)',
      relation_name, authorized_organization::text
    );
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM waia_historical_runner', relation_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO waia_historical_runner', relation_name);
  END LOOP;

  FOREACH relation_name IN ARRAY insert_relations LOOP
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_runner_org_insert_v2 ON public.%I', relation_name);
    EXECUTE format(
      'CREATE POLICY waia_historical_runner_org_insert_v2 ON public.%I FOR INSERT TO waia_historical_runner WITH CHECK (organization_id = %L::uuid)',
      relation_name, authorized_organization::text
    );
    EXECUTE format('GRANT INSERT ON TABLE public.%I TO waia_historical_runner', relation_name);
  END LOOP;

  -- The authority table can also contain FULL_SEALED_DATASET_V2 rows.  Those are
  -- outside the pre-holdout runner's mandate even inside the authorized organization.
  DROP POLICY IF EXISTS waia_historical_runner_org_select_v2
    ON public.trader_historical_dataset_authority_v2;
  EXECUTE format(
    'CREATE POLICY waia_historical_runner_org_select_v2 ON public.trader_historical_dataset_authority_v2 FOR SELECT TO waia_historical_runner USING (organization_id = %L::uuid AND dataset_authority_class = ''PRE_HOLDOUT_QUALIFICATION_V1'')',
    authorized_organization::text
  );
  DROP POLICY IF EXISTS waia_historical_runner_org_insert_v2
    ON public.trader_historical_dataset_authority_v2;
  EXECUTE format(
    'CREATE POLICY waia_historical_runner_org_insert_v2 ON public.trader_historical_dataset_authority_v2 FOR INSERT TO waia_historical_runner WITH CHECK (organization_id = %L::uuid AND dataset_authority_class = ''PRE_HOLDOUT_QUALIFICATION_V1'')',
    authorized_organization::text
  );

  FOREACH relation_name IN ARRAY update_relations LOOP
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_runner_org_update_v2 ON public.%I', relation_name);
    EXECUTE format(
      'CREATE POLICY waia_historical_runner_org_update_v2 ON public.%I FOR UPDATE TO waia_historical_runner USING (organization_id = %L::uuid) WITH CHECK (organization_id = %L::uuid)',
      relation_name, authorized_organization::text, authorized_organization::text
    );
    EXECUTE format('GRANT UPDATE ON TABLE public.%I TO waia_historical_runner', relation_name);
  END LOOP;
END
$do$;
