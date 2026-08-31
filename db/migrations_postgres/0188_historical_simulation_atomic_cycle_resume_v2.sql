DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM trader_historical_simulation_reason_ledger_v2 LIMIT 1) THEN
    RAISE EXCEPTION '0188 refuses account backfill for existing historical simulation ledger rows';
  END IF;
END $$;

ALTER TABLE trader_historical_simulation_reason_ledger_v2
  ADD COLUMN account_id text NOT NULL;
ALTER TABLE trader_historical_simulation_reason_ledger_v2
  DROP CONSTRAINT historical_sim_v2_org_run_sequence_unique;
ALTER TABLE trader_historical_simulation_reason_ledger_v2
  ADD CONSTRAINT historical_sim_v2_scope_sequence_unique UNIQUE
    (organization_id, account_id, run_id, cycle_sequence),
  ADD CONSTRAINT historical_sim_v2_entry_scope_unique UNIQUE
    (entry_id, organization_id, account_id),
  ADD CONSTRAINT historical_sim_v2_atomic_lineage_unique UNIQUE
    (entry_id, organization_id, account_id, run_id, cycle_sequence, cycle_id, content_digest_hex),
  ADD CONSTRAINT historical_sim_v2_dataset_account_binding CHECK
    (dataset_membership_json ->> 'organizationId' = organization_id::text);

CREATE TABLE trader_historical_simulation_atomic_stage_v2 (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  run_id text NOT NULL,
  cycle_sequence integer NOT NULL,
  cycle_id text NOT NULL,
  stage text NOT NULL,
  ledger_entry_id text NOT NULL,
  ledger_entry_content_digest_hex text NOT NULL,
  artifacts_json jsonb NOT NULL,
  bundle_content_digest_hex text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, account_id, run_id, cycle_sequence, stage),
  UNIQUE (organization_id, account_id, run_id, cycle_sequence, stage, bundle_content_digest_hex),
  CONSTRAINT historical_sim_atomic_stage_ledger_fk FOREIGN KEY
    (ledger_entry_id, organization_id, account_id, run_id, cycle_sequence, cycle_id, ledger_entry_content_digest_hex)
    REFERENCES trader_historical_simulation_reason_ledger_v2
      (entry_id, organization_id, account_id, run_id, cycle_sequence, cycle_id, content_digest_hex),
  CONSTRAINT historical_sim_atomic_stage_schema CHECK
    (schema_version='waia.trader.historical_simulation_atomic_stage_bundle.v2'),
  CONSTRAINT historical_sim_atomic_stage_kind CHECK (stage IN
    ('FORECAST_LIFECYCLE','CANONICAL_VERIFICATION','MODELED_RISK','MODELED_EXECUTION',
     'OBSERVED_EXECUTION_EFFECTS','ACCOUNTING','GUARDIAN','KNOWLEDGE','LEARNING')),
  CONSTRAINT historical_sim_atomic_stage_sequence CHECK (cycle_sequence >= 0),
  CONSTRAINT historical_sim_atomic_stage_digests CHECK
    (ledger_entry_content_digest_hex ~ '^[0-9a-f]{64}$' AND bundle_content_digest_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT historical_sim_atomic_stage_artifacts CHECK
    (jsonb_typeof(artifacts_json)='array' AND jsonb_array_length(artifacts_json)>0)
);

CREATE TABLE trader_historical_simulation_durable_snapshot_v2 (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  run_id text NOT NULL,
  cycle_sequence integer NOT NULL,
  cycle_id text NOT NULL,
  state_kind text NOT NULL,
  ledger_entry_id text NOT NULL,
  ledger_entry_content_digest_hex text NOT NULL,
  state_json jsonb NOT NULL,
  snapshot_content_digest_hex text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, account_id, run_id, cycle_sequence, state_kind),
  UNIQUE (organization_id, account_id, run_id, cycle_sequence, state_kind, snapshot_content_digest_hex),
  CONSTRAINT historical_sim_snapshot_ledger_fk FOREIGN KEY
    (ledger_entry_id, organization_id, account_id, run_id, cycle_sequence, cycle_id, ledger_entry_content_digest_hex)
    REFERENCES trader_historical_simulation_reason_ledger_v2
      (entry_id, organization_id, account_id, run_id, cycle_sequence, cycle_id, content_digest_hex),
  CONSTRAINT historical_sim_snapshot_schema CHECK
    (schema_version='waia.trader.historical_simulation_durable_state_snapshot.v2'),
  CONSTRAINT historical_sim_snapshot_kind CHECK (state_kind IN
    ('KNOWLEDGE','MODELED_EXECUTION_REGISTRY','MODELED_EXCHANGE','ACCOUNTING_FRONTIER','GUARDIAN','LEARNING')),
  CONSTRAINT historical_sim_snapshot_sequence CHECK (cycle_sequence >= 0),
  CONSTRAINT historical_sim_snapshot_digest CHECK
    (snapshot_content_digest_hex ~ '^[0-9a-f]{64}$' AND ledger_entry_content_digest_hex ~ '^[0-9a-f]{64}$')
);

CREATE TABLE trader_historical_simulation_resume_checkpoint_v2 (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  run_id text NOT NULL,
  split text NOT NULL,
  committed_cycle_sequence integer NOT NULL,
  committed_cycle_id text NOT NULL,
  ledger_entry_id text NOT NULL,
  ledger_head_content_digest_hex text NOT NULL,
  next_record_index integer NOT NULL,
  next_cycle_sequence integer NOT NULL,
  dataset_authority_json jsonb NOT NULL,
  stage_digest_json jsonb NOT NULL,
  snapshot_digest_json jsonb NOT NULL,
  checkpoint_json jsonb NOT NULL,
  checkpoint_content_digest_hex text NOT NULL,
  commit_request_digest_hex text NOT NULL,
  commit_request_json jsonb NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, account_id, run_id, committed_cycle_sequence),
  UNIQUE (organization_id, account_id, run_id, next_cycle_sequence),
  CONSTRAINT historical_sim_resume_ledger_fk FOREIGN KEY
    (ledger_entry_id, organization_id, account_id, run_id, committed_cycle_sequence, committed_cycle_id,
     ledger_head_content_digest_hex)
    REFERENCES trader_historical_simulation_reason_ledger_v2
      (entry_id, organization_id, account_id, run_id, cycle_sequence, cycle_id, content_digest_hex),
  CONSTRAINT historical_sim_resume_schema CHECK
    (schema_version='waia.trader.historical_simulation_resume_cursor.v2'),
  CONSTRAINT historical_sim_resume_split CHECK (split IN ('DEVELOPMENT','WALK_FORWARD')),
  CONSTRAINT historical_sim_resume_sequence CHECK
    (committed_cycle_sequence >= 0 AND next_record_index >= 1 AND
     next_cycle_sequence = committed_cycle_sequence + 1),
  CONSTRAINT historical_sim_resume_digests CHECK
    (ledger_head_content_digest_hex ~ '^[0-9a-f]{64}$' AND checkpoint_content_digest_hex ~ '^[0-9a-f]{64}$'
     AND commit_request_digest_hex ~ '^[0-9a-f]{64}$')
  ,CONSTRAINT historical_sim_resume_request_shape CHECK
    (commit_request_json ->> 'schemaVersion'='waia.trader.historical_simulation_commit_request.v2'
     AND commit_request_json ->> 'contentDigestHex'=commit_request_digest_hex
     AND commit_request_json ->> 'organizationId'=organization_id::text
     AND commit_request_json ->> 'accountId'=account_id
     AND commit_request_json ->> 'runId'=run_id
     AND (commit_request_json ->> 'cycleSequence')::integer=committed_cycle_sequence
     AND commit_request_json ->> 'cycleId'=committed_cycle_id)
);

CREATE TABLE trader_historical_simulation_resume_stage_link_v2 (
  organization_id uuid NOT NULL, account_id text NOT NULL, run_id text NOT NULL,
  committed_cycle_sequence integer NOT NULL, stage text NOT NULL, bundle_content_digest_hex text NOT NULL,
  PRIMARY KEY (organization_id, account_id, run_id, committed_cycle_sequence, stage),
  FOREIGN KEY (organization_id, account_id, run_id, committed_cycle_sequence)
    REFERENCES trader_historical_simulation_resume_checkpoint_v2
      (organization_id, account_id, run_id, committed_cycle_sequence),
  FOREIGN KEY (organization_id, account_id, run_id, committed_cycle_sequence, stage, bundle_content_digest_hex)
    REFERENCES trader_historical_simulation_atomic_stage_v2
      (organization_id, account_id, run_id, cycle_sequence, stage, bundle_content_digest_hex)
);

CREATE TABLE trader_historical_simulation_resume_snapshot_link_v2 (
  organization_id uuid NOT NULL, account_id text NOT NULL, run_id text NOT NULL,
  committed_cycle_sequence integer NOT NULL, state_kind text NOT NULL, snapshot_content_digest_hex text NOT NULL,
  PRIMARY KEY (organization_id, account_id, run_id, committed_cycle_sequence, state_kind),
  FOREIGN KEY (organization_id, account_id, run_id, committed_cycle_sequence)
    REFERENCES trader_historical_simulation_resume_checkpoint_v2
      (organization_id, account_id, run_id, committed_cycle_sequence),
  FOREIGN KEY (organization_id, account_id, run_id, committed_cycle_sequence, state_kind, snapshot_content_digest_hex)
    REFERENCES trader_historical_simulation_durable_snapshot_v2
      (organization_id, account_id, run_id, cycle_sequence, state_kind, snapshot_content_digest_hex)
);

CREATE INDEX historical_sim_resume_latest_idx ON trader_historical_simulation_resume_checkpoint_v2
  (organization_id, account_id, run_id, committed_cycle_sequence DESC);

CREATE TRIGGER historical_sim_atomic_stage_v2_append_only BEFORE UPDATE OR DELETE
  ON trader_historical_simulation_atomic_stage_v2 FOR EACH ROW EXECUTE FUNCTION trader_historical_simulation_v2_append_only();
CREATE TRIGGER historical_sim_durable_snapshot_v2_append_only BEFORE UPDATE OR DELETE
  ON trader_historical_simulation_durable_snapshot_v2 FOR EACH ROW EXECUTE FUNCTION trader_historical_simulation_v2_append_only();
CREATE TRIGGER historical_sim_resume_checkpoint_v2_append_only BEFORE UPDATE OR DELETE
  ON trader_historical_simulation_resume_checkpoint_v2 FOR EACH ROW EXECUTE FUNCTION trader_historical_simulation_v2_append_only();
CREATE TRIGGER historical_sim_resume_stage_link_v2_append_only BEFORE UPDATE OR DELETE
  ON trader_historical_simulation_resume_stage_link_v2 FOR EACH ROW EXECUTE FUNCTION trader_historical_simulation_v2_append_only();
CREATE TRIGGER historical_sim_resume_snapshot_link_v2_append_only BEFORE UPDATE OR DELETE
  ON trader_historical_simulation_resume_snapshot_link_v2 FOR EACH ROW EXECUTE FUNCTION trader_historical_simulation_v2_append_only();

ALTER TABLE trader_historical_simulation_atomic_stage_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE trader_historical_simulation_durable_snapshot_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE trader_historical_simulation_resume_checkpoint_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE trader_historical_simulation_resume_stage_link_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE trader_historical_simulation_resume_snapshot_link_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON trader_historical_simulation_atomic_stage_v2 FROM anon, authenticated;
REVOKE ALL ON trader_historical_simulation_durable_snapshot_v2 FROM anon, authenticated;
REVOKE ALL ON trader_historical_simulation_resume_checkpoint_v2 FROM anon, authenticated;
REVOKE ALL ON trader_historical_simulation_resume_stage_link_v2 FROM anon, authenticated;
REVOKE ALL ON trader_historical_simulation_resume_snapshot_link_v2 FROM anon, authenticated;
