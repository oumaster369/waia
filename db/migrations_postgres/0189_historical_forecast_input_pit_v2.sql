CREATE UNIQUE INDEX IF NOT EXISTS forecast_contract_binding_v1_org_digest_unique
  ON trader_forecast_contract_binding_v1 (organization_id, content_digest);
CREATE UNIQUE INDEX IF NOT EXISTS scientific_admission_receipt_v1_full_lineage_unique
  ON trader_scientific_admission_receipt_v1 (id, organization_id, content_digest);
CREATE UNIQUE INDEX IF NOT EXISTS forecast_predictive_package_v2_full_lineage_unique
  ON trader_forecast_predictive_package_v2 (id, organization_id, predictive_package_content_digest);
CREATE UNIQUE INDEX IF NOT EXISTS forecast_bundle_v2_runtime_source_lineage_unique
  ON trader_forecast_bundle_v2 (id, organization_id, run_id, cycle_id, symbol, anchor_closed_bar_epoch_ms);
CREATE UNIQUE INDEX IF NOT EXISTS forecast_v2_runtime_source_lineage_unique
  ON trader_forecast_v2
    (id, organization_id, bundle_id, target_role_id, forecast_content_digest);
CREATE UNIQUE INDEX IF NOT EXISTS historical_dataset_authority_v2_membership_lineage_unique
  ON trader_historical_dataset_authority_v2
    (id, organization_id, run_id, cycle_id, dataset_seal_digest_hex, membership_content_digest_hex);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_confidence_update_record_full_lineage_unique
  ON trader_knowledge_confidence_update_record (id, organization_id, content_digest);

CREATE TABLE trader_forecast_runtime_input_source_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bundle_id uuid NOT NULL,
  execution_forecast_id uuid NOT NULL,
  execution_forecast_target_role_id text NOT NULL,
  execution_forecast_content_digest bytea NOT NULL,
  run_id text NOT NULL,
  cycle_id text NOT NULL,
  symbol text NOT NULL,
  pit_anchor timestamptz NOT NULL,
  anchor_closed_bar_epoch_ms bigint NOT NULL,
  predictive_package_id uuid NOT NULL,
  predictive_package_content_digest_hex text NOT NULL,
  scientific_admission_receipt_id uuid NOT NULL,
  scientific_admission_content_digest_hex text NOT NULL,
  contract_binding_content_digest_hex text NOT NULL,
  knowledge_edge_id uuid,
  knowledge_content_digest_hex text NOT NULL,
  market_snapshot_content_digest_hex text NOT NULL,
  predictive_admission_content_digest_hex text NOT NULL,
  forecast_authority_content_digest_hex text NOT NULL,
  authorized_outcome_content_digest_hex text NOT NULL,
  runtime_input_content_digest_hex text NOT NULL,
  runtime_input_json jsonb NOT NULL,
  authorized_outcome_json jsonb NOT NULL,
  verifier_version text NOT NULL,
  verifier_build_digest_hex text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, bundle_id),
  UNIQUE (id, organization_id, bundle_id, execution_forecast_id,
          execution_forecast_target_role_id, execution_forecast_content_digest,
          run_id, cycle_id, pit_anchor),
  CONSTRAINT forecast_runtime_input_source_bundle_fk FOREIGN KEY
    (bundle_id, organization_id, run_id, cycle_id, symbol, anchor_closed_bar_epoch_ms)
    REFERENCES trader_forecast_bundle_v2
      (id, organization_id, run_id, cycle_id, symbol, anchor_closed_bar_epoch_ms),
  CONSTRAINT forecast_runtime_input_source_forecast_fk FOREIGN KEY
    (execution_forecast_id, organization_id, bundle_id,
     execution_forecast_target_role_id, execution_forecast_content_digest)
    REFERENCES trader_forecast_v2
      (id, organization_id, bundle_id, target_role_id, forecast_content_digest),
  CONSTRAINT forecast_runtime_input_source_package_fk FOREIGN KEY
    (predictive_package_id, organization_id, predictive_package_content_digest_hex)
    REFERENCES trader_forecast_predictive_package_v2 (id, organization_id, predictive_package_content_digest),
  CONSTRAINT forecast_runtime_input_source_scientific_fk FOREIGN KEY
    (scientific_admission_receipt_id, organization_id, scientific_admission_content_digest_hex)
    REFERENCES trader_scientific_admission_receipt_v1 (id, organization_id, content_digest),
  CONSTRAINT forecast_runtime_input_source_binding_fk FOREIGN KEY (organization_id, contract_binding_content_digest_hex)
    REFERENCES trader_forecast_contract_binding_v1 (organization_id, content_digest),
  CONSTRAINT forecast_runtime_input_source_schema CHECK
    (schema_version='waia.trader.forecast_runtime_input_source.v2'),
  CONSTRAINT forecast_runtime_input_source_execution_role CHECK
    (execution_forecast_target_role_id='EXECUTION_OPPORTUNITY'),
  CONSTRAINT forecast_runtime_input_source_digests CHECK
    (predictive_package_content_digest_hex ~ '^[0-9a-f]{64}$' AND scientific_admission_content_digest_hex ~ '^[0-9a-f]{64}$'
     AND contract_binding_content_digest_hex ~ '^[0-9a-f]{64}$' AND knowledge_content_digest_hex ~ '^[0-9a-f]{64}$'
     AND market_snapshot_content_digest_hex ~ '^[0-9a-f]{64}$' AND predictive_admission_content_digest_hex ~ '^[0-9a-f]{64}$'
     AND forecast_authority_content_digest_hex ~ '^[0-9a-f]{64}$' AND authorized_outcome_content_digest_hex ~ '^[0-9a-f]{64}$'
     AND runtime_input_content_digest_hex ~ '^[0-9a-f]{64}$' AND verifier_build_digest_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT forecast_runtime_input_source_json_binding CHECK
    (runtime_input_json -> 'marketStateSnapshot' ->> 'contentDigestHex'=market_snapshot_content_digest_hex
     AND runtime_input_json -> 'predictiveAdmissionReceipt' ->> 'contentDigestHex'=predictive_admission_content_digest_hex
     AND runtime_input_json -> 'forecastContractBinding' ->> 'contentDigestHex'=contract_binding_content_digest_hex
     AND authorized_outcome_json -> 'authority' ->> 'contentDigestHex'=forecast_authority_content_digest_hex)
);

CREATE TABLE trader_historical_forecast_input_pit_v2 (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL, cycle_id text NOT NULL, forecast_id uuid NOT NULL, bundle_id uuid NOT NULL,
  forecast_target_role_id text NOT NULL, forecast_content_digest bytea NOT NULL,
  runtime_input_source_id uuid NOT NULL, dataset_authority_id uuid NOT NULL,
  symbol text NOT NULL, partition text NOT NULL, record_index integer NOT NULL,
  dataset_seal_digest_hex text NOT NULL, dataset_membership_content_digest_hex text NOT NULL,
  dataset_membership_json jsonb NOT NULL, pit_anchor timestamptz NOT NULL, visible_from timestamptz NOT NULL,
  knowledge_content_digest_hex text NOT NULL, forecast_authority_content_digest_hex text NOT NULL,
  runtime_input_content_digest_hex text NOT NULL, verifier_build_digest_hex text NOT NULL,
  runtime_input_json jsonb NOT NULL, content_digest_hex text NOT NULL, schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, run_id, cycle_id),
  UNIQUE (organization_id, run_id, cycle_id, forecast_id, dataset_authority_id, pit_anchor,
          knowledge_content_digest_hex, forecast_authority_content_digest_hex),
  CONSTRAINT historical_forecast_pit_run_fk FOREIGN KEY (organization_id, run_id)
    REFERENCES trader_historical_simulation_run_start_v2 (organization_id, run_id),
  CONSTRAINT historical_forecast_pit_dataset_fk FOREIGN KEY
    (dataset_authority_id, organization_id, run_id, cycle_id, dataset_seal_digest_hex,
     dataset_membership_content_digest_hex)
    REFERENCES trader_historical_dataset_authority_v2
      (id, organization_id, run_id, cycle_id, dataset_seal_digest_hex, membership_content_digest_hex),
  CONSTRAINT historical_forecast_pit_source_fk FOREIGN KEY
    (runtime_input_source_id, organization_id, bundle_id, forecast_id,
     forecast_target_role_id, forecast_content_digest, run_id, cycle_id, pit_anchor)
    REFERENCES trader_forecast_runtime_input_source_v2
      (id, organization_id, bundle_id, execution_forecast_id,
       execution_forecast_target_role_id, execution_forecast_content_digest,
       run_id, cycle_id, pit_anchor),
  CONSTRAINT historical_forecast_pit_forecast_fk FOREIGN KEY
    (forecast_id, organization_id, bundle_id, forecast_target_role_id, forecast_content_digest)
    REFERENCES trader_forecast_v2
      (id, organization_id, bundle_id, target_role_id, forecast_content_digest),
  CONSTRAINT historical_forecast_pit_schema CHECK (schema_version='waia.trader.historical_forecast_input_pit.v2'),
  CONSTRAINT historical_forecast_pit_partition CHECK (partition IN ('DEVELOPMENT','WALK_FORWARD')),
  CONSTRAINT historical_forecast_pit_execution_role CHECK
    (forecast_target_role_id='EXECUTION_OPPORTUNITY'),
  CONSTRAINT historical_forecast_pit_digests CHECK
    (dataset_seal_digest_hex ~ '^[0-9a-f]{64}$' AND dataset_membership_content_digest_hex ~ '^[0-9a-f]{64}$'
     AND knowledge_content_digest_hex ~ '^[0-9a-f]{64}$' AND forecast_authority_content_digest_hex ~ '^[0-9a-f]{64}$'
     AND runtime_input_content_digest_hex ~ '^[0-9a-f]{64}$' AND verifier_build_digest_hex ~ '^[0-9a-f]{64}$'
     AND content_digest_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT historical_forecast_pit_json_binding CHECK
    (dataset_membership_json ->> 'organizationId'=organization_id::text
     AND dataset_membership_json ->> 'cycleId'=cycle_id
     AND dataset_membership_json ->> 'contentDigestHex'=dataset_membership_content_digest_hex
     AND (runtime_input_json -> 'marketStateSnapshot' ->> 'pitAnchor')::timestamptz=pit_anchor)
);

CREATE TABLE trader_historical_forecast_input_knowledge_link_v2 (
  organization_id uuid NOT NULL, run_id text NOT NULL, cycle_id text NOT NULL,
  knowledge_update_id uuid NOT NULL, knowledge_update_content_digest_hex text NOT NULL,
  PRIMARY KEY (organization_id, run_id, cycle_id, knowledge_update_id),
  FOREIGN KEY (organization_id, run_id, cycle_id)
    REFERENCES trader_historical_forecast_input_pit_v2 (organization_id, run_id, cycle_id),
  FOREIGN KEY (knowledge_update_id, organization_id, knowledge_update_content_digest_hex)
    REFERENCES trader_knowledge_confidence_update_record (id, organization_id, content_digest),
  CHECK (knowledge_update_content_digest_hex ~ '^[0-9a-f]{64}$')
);

CREATE INDEX historical_forecast_pit_lookup_idx ON trader_historical_forecast_input_pit_v2
  (organization_id, run_id, symbol, pit_anchor, cycle_id);
CREATE INDEX historical_forecast_pit_retention_idx ON trader_historical_forecast_input_pit_v2 (created_at);
CREATE INDEX forecast_runtime_input_source_lookup_idx ON trader_forecast_runtime_input_source_v2
  (organization_id, run_id, symbol, pit_anchor);

CREATE TRIGGER forecast_runtime_input_source_v2_append_only BEFORE UPDATE OR DELETE ON trader_forecast_runtime_input_source_v2
  FOR EACH ROW EXECUTE FUNCTION trader_historical_simulation_v2_append_only();
CREATE TRIGGER historical_forecast_input_pit_v2_append_only BEFORE UPDATE OR DELETE ON trader_historical_forecast_input_pit_v2
  FOR EACH ROW EXECUTE FUNCTION trader_historical_simulation_v2_append_only();
CREATE TRIGGER historical_forecast_input_knowledge_link_v2_append_only BEFORE UPDATE OR DELETE ON trader_historical_forecast_input_knowledge_link_v2
  FOR EACH ROW EXECUTE FUNCTION trader_historical_simulation_v2_append_only();

ALTER TABLE trader_forecast_runtime_input_source_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE trader_historical_forecast_input_pit_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE trader_historical_forecast_input_knowledge_link_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON trader_forecast_runtime_input_source_v2 FROM anon, authenticated;
REVOKE ALL ON trader_historical_forecast_input_pit_v2 FROM anon, authenticated;
REVOKE ALL ON trader_historical_forecast_input_knowledge_link_v2 FROM anon, authenticated;
