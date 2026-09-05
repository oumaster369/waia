-- DEE-920 tranche D: append-only, owner-service run lifecycle shared by the
-- operator and tenant-scoped historical observation projections.
CREATE TABLE trader_historical_simulation_run_lifecycle_event_v2 (
  organization_id uuid NOT NULL,
  run_id text NOT NULL,
  event_sequence integer NOT NULL,
  account_id text NOT NULL,
  partition text NOT NULL,
  symbol text NOT NULL,
  phase text NOT NULL,
  initial_record_index integer NOT NULL,
  terminal_record_index_exclusive integer NOT NULL,
  qualified_total_cycles integer NOT NULL,
  committed_cycles integer NOT NULL,
  next_cycle_sequence integer NOT NULL,
  latest_committed_cycle_id text,
  requested_by_operator_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  error_code text,
  previous_content_digest_hex text,
  content_digest_hex text NOT NULL,
  event_json jsonb NOT NULL,
  schema_version text NOT NULL,
  PRIMARY KEY (organization_id,run_id,event_sequence),
  UNIQUE (organization_id,run_id,content_digest_hex),
  FOREIGN KEY (organization_id,run_id)
    REFERENCES trader_historical_simulation_run_start_v2 (organization_id,run_id),
  FOREIGN KEY (organization_id,run_id,previous_content_digest_hex)
    REFERENCES trader_historical_simulation_run_lifecycle_event_v2
      (organization_id,run_id,content_digest_hex),
  CONSTRAINT historical_simulation_run_lifecycle_scope CHECK (
    length(btrim(run_id)) > 0 AND length(btrim(account_id)) > 0
    AND partition IN ('DEVELOPMENT','WALK_FORWARD')
    AND symbol IN ('BTCUSDT','ETHUSDT')
  ),
  CONSTRAINT historical_simulation_run_lifecycle_phase CHECK (
    phase IN ('QUEUED','RUNNING','COMPLETED','FAILED','STOPPED')
  ),
  CONSTRAINT historical_simulation_run_lifecycle_progress CHECK (
    event_sequence >= 0
    AND initial_record_index >= 0
    AND terminal_record_index_exclusive > initial_record_index
    AND qualified_total_cycles = terminal_record_index_exclusive - initial_record_index
    AND committed_cycles BETWEEN 0 AND qualified_total_cycles
    AND next_cycle_sequence = committed_cycles
    AND ((committed_cycles = 0 AND latest_committed_cycle_id IS NULL)
      OR (committed_cycles > 0 AND length(btrim(latest_committed_cycle_id)) > 0))
    AND ((phase = 'COMPLETED' AND committed_cycles = qualified_total_cycles)
      OR (phase <> 'COMPLETED' AND committed_cycles < qualified_total_cycles))
    AND ((event_sequence = 0 AND previous_content_digest_hex IS NULL)
      OR (event_sequence > 0 AND previous_content_digest_hex ~ '^[0-9a-f]{64}$'))
  ),
  CONSTRAINT historical_simulation_run_lifecycle_digest CHECK (
    content_digest_hex ~ '^[0-9a-f]{64}$'
    AND content_digest_hex = encode(sha256(convert_to(
      public.waia_canonical_jsonb_v1(event_json - 'contentDigestHex'),'UTF8'
    )),'hex')
  ),
  CONSTRAINT historical_simulation_run_lifecycle_event_binding CHECK (
    public.waia_jsonb_exact_keys_v2(event_json,ARRAY[
      'schemaVersion','organizationId','accountId','runId','partition','symbol',
      'eventSequence','phase','initialRecordIndex','terminalRecordIndexExclusive',
      'qualifiedTotalCycles','committedCycles','nextCycleSequence',
      'latestCommittedCycleId','requestedByOperatorId','observedAt','errorCode',
      'previousContentDigestHex','contentDigestHex'
    ])
    AND event_json->>'schemaVersion' = schema_version
    AND event_json->>'organizationId' = organization_id::text
    AND event_json->>'accountId' = account_id
    AND event_json->>'runId' = run_id
    AND event_json->>'partition' = partition
    AND event_json->>'symbol' = symbol
    AND (event_json->>'eventSequence')::integer = event_sequence
    AND event_json->>'phase' = phase
    AND (event_json->>'initialRecordIndex')::integer = initial_record_index
    AND (event_json->>'terminalRecordIndexExclusive')::integer = terminal_record_index_exclusive
    AND (event_json->>'qualifiedTotalCycles')::integer = qualified_total_cycles
    AND (event_json->>'committedCycles')::integer = committed_cycles
    AND (event_json->>'nextCycleSequence')::integer = next_cycle_sequence
    AND event_json->>'latestCommittedCycleId' IS NOT DISTINCT FROM latest_committed_cycle_id
    AND event_json->>'requestedByOperatorId' = requested_by_operator_id
    AND (event_json->>'observedAt')::timestamptz = observed_at
    AND event_json->>'errorCode' IS NOT DISTINCT FROM error_code
    AND event_json->>'previousContentDigestHex' IS NOT DISTINCT FROM previous_content_digest_hex
    AND event_json->>'contentDigestHex' = content_digest_hex
  ),
  CONSTRAINT historical_simulation_run_lifecycle_schema CHECK (
    schema_version='waia.trader.historical_simulation_run_lifecycle.v2'
  )
);

CREATE INDEX historical_simulation_run_lifecycle_latest_v2_idx
  ON trader_historical_simulation_run_lifecycle_event_v2
    (organization_id,run_id,event_sequence DESC);

CREATE TRIGGER historical_simulation_run_lifecycle_append_only_v2
  BEFORE UPDATE OR DELETE ON trader_historical_simulation_run_lifecycle_event_v2
  FOR EACH ROW EXECUTE FUNCTION trader_historical_simulation_v2_append_only();

ALTER TABLE trader_historical_simulation_run_lifecycle_event_v2 ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE trader_historical_simulation_run_lifecycle_event_v2 IS
  'Owner-only append-only Historical Simulation V2 lifecycle. Tenant visibility is available only through scoped service projections.';
REVOKE ALL ON trader_historical_simulation_run_lifecycle_event_v2 FROM anon,authenticated;
