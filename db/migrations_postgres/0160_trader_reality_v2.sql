-- DEE-677 / R675-B: Reality V2 bitemporal truth substrate for the ratified HTX spot MVP.
-- Additive PostgreSQL only. Raw bytes remain in the existing encrypted raw-capture storage.

CREATE TABLE public.trader_reality_raw_source_admissions_v2 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (account_id ~ '[^[:space:]]'),
  capture_source_id uuid NOT NULL,
  reality_source_kind text NOT NULL,
  provider text NOT NULL,
  feed_class text NOT NULL,
  transport text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_reality_raw_source_admissions_v2_pk PRIMARY KEY (
    organization_id, account_id, capture_source_id, reality_source_kind
  ),
  CONSTRAINT trader_reality_raw_source_admissions_v2_source_account_unique UNIQUE (
    organization_id, capture_source_id
  ),
  CONSTRAINT trader_reality_raw_source_admissions_v2_source_fk FOREIGN KEY (
    capture_source_id, organization_id
  ) REFERENCES public.trader_mi_source(id, organization_id),
  CONSTRAINT trader_reality_raw_source_admissions_v2_exact_class CHECK (
    provider = 'HTX' AND transport = 'REST' AND feed_class = 'raw-foundation'
    AND reality_source_kind IN (
      'HTX_SPOT_ORDER_REST', 'HTX_SPOT_FILL_REST',
      'HTX_SPOT_BALANCE_REST', 'HTX_SPOT_ACCOUNT_REST'
    )
  )
);
--> statement-breakpoint
CREATE TABLE public.trader_reality_knowledge_frontiers_v2 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (account_id ~ '[^[:space:]]'),
  last_knowledge_at timestamptz,
  pending_reservation_id uuid,
  pending_transaction_id bigint,
  pending_knowledge_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_reality_knowledge_frontiers_v2_pk PRIMARY KEY (
    organization_id, account_id
  ),
  CONSTRAINT trader_reality_knowledge_frontiers_v2_pending_shape CHECK (
    (pending_reservation_id IS NULL AND pending_transaction_id IS NULL
      AND pending_knowledge_at IS NULL)
    OR (pending_reservation_id IS NOT NULL AND pending_transaction_id IS NOT NULL
      AND pending_knowledge_at IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE public.trader_reality_source_reports_v2 (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (account_id ~ '[^[:space:]]'),
  source_kind text NOT NULL,
  source_native_identity_kind text,
  source_native_id text,
  source_native_revision text,
  supersedes_native_revision text,
  attribution_status text NOT NULL,
  subject_class text NOT NULL,
  subject_key text NOT NULL,
  primitive_assertion jsonb,
  lineage_kind text NOT NULL,
  execution_report_id uuid REFERENCES public.trader_execution_reports_v2(id),
  execution_report_digest text,
  raw_capture_source_id uuid,
  raw_capture_receipt_digest text,
  raw_bytes_digest text,
  storage_binding_digest text,
  provenance jsonb NOT NULL,
  structural_verification text NOT NULL,
  verification_reason_codes jsonb NOT NULL,
  valid_at timestamptz NOT NULL,
  knowledge_at timestamptz NOT NULL,
  knowledge_reservation_id uuid NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_reality_source_reports_v2_id_scope_unique
    UNIQUE (id, organization_id, account_id),
  CONSTRAINT trader_reality_source_reports_v2_capture_source_fk FOREIGN KEY (
    raw_capture_receipt_digest, organization_id, raw_capture_source_id
  ) REFERENCES public.trader_mi_raw_capture_receipt_v1(id, organization_id, source_id),
  CONSTRAINT trader_reality_source_reports_v2_raw_admission_fk FOREIGN KEY (
    organization_id, account_id, raw_capture_source_id, source_kind
  ) REFERENCES public.trader_reality_raw_source_admissions_v2(
    organization_id, account_id, capture_source_id, reality_source_kind
  ),
  CONSTRAINT trader_reality_source_reports_v2_id_digest CHECK (
    id = content_digest AND id ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT trader_reality_source_reports_v2_schema CHECK (
    schema_version = 'reality-source-report/v2'
    AND source_kind IN (
      'EXECUTION_REPORT_V2', 'HTX_SPOT_ORDER_REST', 'HTX_SPOT_FILL_REST',
      'HTX_SPOT_BALANCE_REST', 'HTX_SPOT_ACCOUNT_REST'
    )
    AND subject_class IN (
      'ORDER', 'VENUE_EVENT', 'FILL', 'BALANCE', 'ACCOUNT',
      'POSITION_INVENTORY', 'REALIZED_CASHFLOW'
    )
    AND jsonb_typeof(provenance) = 'object'
    AND jsonb_typeof(verification_reason_codes) = 'array'
    AND valid_at <= knowledge_at
  ),
  CONSTRAINT trader_reality_source_reports_v2_provenance CHECK (
    provenance ?& ARRAY[
      'venue', 'transport', 'connectorId', 'connectorVersion',
      'adapterVersion', 'sourceFinalityMetadata'
    ]
    AND provenance - ARRAY[
      'venue', 'transport', 'connectorId', 'connectorVersion',
      'adapterVersion', 'sourceFinalityMetadata'
    ] = '{}'::jsonb
    AND provenance->>'venue' = 'HTX'
    AND jsonb_typeof(provenance->'connectorId') = 'string'
    AND jsonb_typeof(provenance->'connectorVersion') = 'string'
    AND jsonb_typeof(provenance->'adapterVersion') = 'string'
    AND provenance->>'connectorId' ~ '^[A-Za-z0-9._:/=-]{1,128}$'
    AND provenance->>'connectorVersion' ~ '^[A-Za-z0-9._:/=-]{1,128}$'
    AND provenance->>'adapterVersion' ~ '^[A-Za-z0-9._:/=-]{1,128}$'
    AND provenance->>'connectorId' !~* '(access[-_]?key|api[-_]?key|authorization|cookie|credential|password|secret|signature|token)'
    AND provenance->>'connectorVersion' !~* '(access[-_]?key|api[-_]?key|authorization|cookie|credential|password|secret|signature|token)'
    AND provenance->>'adapterVersion' !~* '(access[-_]?key|api[-_]?key|authorization|cookie|credential|password|secret|signature|token)'
    AND jsonb_typeof(provenance->'sourceFinalityMetadata') = 'array'
    AND (
      (source_kind = 'EXECUTION_REPORT_V2'
        AND provenance->>'transport' = 'INTERNAL_APPEND_ONLY'
        AND provenance->>'connectorId' = 'execution-v2'
        AND provenance->>'connectorVersion' = 'execution-report/v2'
        AND provenance->>'adapterVersion' = 'reality-execution-v2-v1'
        AND jsonb_array_length(provenance->'sourceFinalityMetadata') = 2
        AND jsonb_typeof(provenance #> '{sourceFinalityMetadata,0}') = 'object'
        AND (provenance #> '{sourceFinalityMetadata,0}') ?& ARRAY['key', 'value']
        AND (provenance #> '{sourceFinalityMetadata,0}') - ARRAY['key', 'value'] = '{}'::jsonb
        AND provenance #>> '{sourceFinalityMetadata,0,key}' = 'reportSequence'
        AND jsonb_typeof(provenance #> '{sourceFinalityMetadata,0,value}') = 'string'
        AND provenance #>> '{sourceFinalityMetadata,0,value}' ~ '^[1-9][0-9]{0,18}$'
        AND (
          length(provenance #>> '{sourceFinalityMetadata,0,value}') < 19
          OR provenance #>> '{sourceFinalityMetadata,0,value}' <= '9223372036854775807'
        )
        AND jsonb_typeof(provenance #> '{sourceFinalityMetadata,1}') = 'object'
        AND (provenance #> '{sourceFinalityMetadata,1}') ?& ARRAY['key', 'value']
        AND (provenance #> '{sourceFinalityMetadata,1}') - ARRAY['key', 'value'] = '{}'::jsonb
        AND provenance #>> '{sourceFinalityMetadata,1,key}' = 'reportType'
        AND jsonb_typeof(provenance #> '{sourceFinalityMetadata,1,value}') = 'string'
        AND provenance #>> '{sourceFinalityMetadata,1,value}' IN (
          'PLAN_SEALED', 'ALLOWANCE_CLAIMED', 'ATTEMPT_BOUND', 'SUBMIT_STARTED',
          'VENUE_ACCEPTED', 'VENUE_REJECTED', 'VENUE_STATUS_OBSERVED',
          'CANCEL_REQUESTED', 'CANCEL_ACKNOWLEDGED', 'FILL_REPORT_OBSERVED',
          'CONNECTOR_UNCERTAIN', 'RECONCILIATION_REQUIRED'
        ))
      OR
      (source_kind <> 'EXECUTION_REPORT_V2'
        AND provenance->>'transport' = 'REST'
        AND provenance->>'connectorId' = 'htx-exchange-connector'
        AND provenance->>'adapterVersion' = 'reality-htx-spot-v1'
        AND provenance->'sourceFinalityMetadata' = '[]'::jsonb)
    )
  ),
  CONSTRAINT trader_reality_source_reports_v2_attribution CHECK (
    (attribution_status = 'ATTRIBUTED' AND source_native_identity_kind IS NOT NULL
      AND source_native_id IS NOT NULL)
    OR (attribution_status = 'UNATTRIBUTED' AND source_native_identity_kind IS NULL
      AND source_native_id IS NULL AND source_native_revision IS NULL
      AND supersedes_native_revision IS NULL)
  ),
  CONSTRAINT trader_reality_source_reports_v2_revision CHECK (
    supersedes_native_revision IS NULL
    OR (source_native_revision IS NOT NULL AND source_native_revision <> supersedes_native_revision)
  ),
  CONSTRAINT trader_reality_source_reports_v2_verification CHECK (
    (structural_verification = 'VERIFIED' AND primitive_assertion IS NOT NULL
      AND jsonb_typeof(primitive_assertion) = 'object'
      AND jsonb_array_length(verification_reason_codes) = 0)
    OR (structural_verification = 'UNVERIFIABLE' AND primitive_assertion IS NULL
      AND jsonb_array_length(verification_reason_codes) > 0)
  ),
  CONSTRAINT trader_reality_source_reports_v2_lineage CHECK (
    (source_kind = 'EXECUTION_REPORT_V2' AND lineage_kind = 'EXECUTION_REPORT_V2'
      AND execution_report_id IS NOT NULL AND execution_report_digest IS NOT NULL
      AND raw_capture_source_id IS NULL
      AND raw_capture_receipt_digest IS NULL AND raw_bytes_digest IS NULL
      AND storage_binding_digest IS NULL)
    OR (source_kind <> 'EXECUTION_REPORT_V2' AND lineage_kind = 'RAW_CAPTURE_V1'
      AND execution_report_id IS NULL AND execution_report_digest IS NULL
      AND raw_capture_source_id IS NOT NULL AND raw_capture_receipt_digest IS NOT NULL
      AND raw_bytes_digest IS NOT NULL
      AND storage_binding_digest IS NOT NULL)
  ),
  CONSTRAINT trader_reality_source_reports_v2_lineage_digests CHECK (
    (execution_report_digest IS NULL OR execution_report_digest ~ '^[0-9a-f]{64}$')
    AND (raw_capture_receipt_digest IS NULL OR raw_capture_receipt_digest ~ '^[0-9a-f]{64}$')
    AND (raw_bytes_digest IS NULL OR raw_bytes_digest ~ '^[0-9a-f]{64}$')
    AND (storage_binding_digest IS NULL OR storage_binding_digest ~ '^[0-9a-f]{64}$')
  )
);
--> statement-breakpoint
CREATE INDEX trader_reality_source_reports_v2_native_revision_idx
  ON public.trader_reality_source_reports_v2 (
    organization_id, account_id, source_kind, source_native_identity_kind,
    source_native_id, COALESCE(source_native_revision, ''), subject_class, subject_key
  ) WHERE source_native_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX trader_reality_source_reports_v2_scope_knowledge_idx
  ON public.trader_reality_source_reports_v2 (
    organization_id, account_id, knowledge_at, id
  );
--> statement-breakpoint
CREATE TABLE public.trader_reality_truth_records_v2 (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (account_id ~ '[^[:space:]]'),
  source_report_id text NOT NULL,
  source_report_digest text NOT NULL,
  source_kind text NOT NULL,
  source_native_identity_kind text,
  source_native_id text,
  source_native_revision text,
  supersedes_native_revision text,
  subject_class text NOT NULL,
  subject_key text NOT NULL,
  primitive_assertion jsonb NOT NULL,
  valid_at timestamptz NOT NULL,
  knowledge_at timestamptz NOT NULL,
  supersedes_truth_record_id text,
  markers jsonb NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_reality_truth_records_v2_id_scope_unique
    UNIQUE (id, organization_id, account_id),
  CONSTRAINT trader_reality_truth_records_v2_source_unique
    UNIQUE (organization_id, account_id, source_report_id),
  CONSTRAINT trader_reality_truth_records_v2_source_fk FOREIGN KEY (
    source_report_id, organization_id, account_id
  ) REFERENCES public.trader_reality_source_reports_v2(id, organization_id, account_id),
  CONSTRAINT trader_reality_truth_records_v2_supersedes_fk FOREIGN KEY (
    supersedes_truth_record_id, organization_id, account_id
  ) REFERENCES public.trader_reality_truth_records_v2(id, organization_id, account_id),
  CONSTRAINT trader_reality_truth_records_v2_id_digest CHECK (
    id = content_digest AND id ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT trader_reality_truth_records_v2_source_digest CHECK (
    source_report_id = source_report_digest
    AND source_report_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT trader_reality_truth_records_v2_schema CHECK (
    schema_version = 'truth-record/v2'
    AND jsonb_typeof(primitive_assertion) = 'object'
    AND jsonb_typeof(markers) = 'array'
    AND valid_at <= knowledge_at
  ),
  CONSTRAINT trader_reality_truth_records_v2_markers CHECK (
    markers <@ '["SOURCE_CONTRADICTION", "UNATTRIBUTED"]'::jsonb
  )
);
--> statement-breakpoint
CREATE INDEX trader_reality_truth_records_v2_subject_knowledge_idx
  ON public.trader_reality_truth_records_v2 (
    organization_id, account_id, subject_class, subject_key, knowledge_at, id
  );
--> statement-breakpoint
CREATE TABLE public.trader_reality_events_v2 (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (account_id ~ '[^[:space:]]'),
  event_sequence bigint NOT NULL,
  event_type text NOT NULL,
  source_report_id text NOT NULL,
  truth_record_id text,
  related_truth_record_id text,
  quarantine_event_id text,
  reason_codes jsonb NOT NULL,
  knowledge_at timestamptz NOT NULL,
  knowledge_reservation_id uuid NOT NULL,
  previous_event_digest text,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_reality_events_v2_id_scope_unique
    UNIQUE (id, organization_id, account_id),
  CONSTRAINT trader_reality_events_v2_scope_sequence_unique
    UNIQUE (organization_id, account_id, event_sequence),
  CONSTRAINT trader_reality_events_v2_source_fk FOREIGN KEY (
    source_report_id, organization_id, account_id
  ) REFERENCES public.trader_reality_source_reports_v2(id, organization_id, account_id),
  CONSTRAINT trader_reality_events_v2_truth_fk FOREIGN KEY (
    truth_record_id, organization_id, account_id
  ) REFERENCES public.trader_reality_truth_records_v2(id, organization_id, account_id),
  CONSTRAINT trader_reality_events_v2_related_truth_fk FOREIGN KEY (
    related_truth_record_id, organization_id, account_id
  ) REFERENCES public.trader_reality_truth_records_v2(id, organization_id, account_id),
  CONSTRAINT trader_reality_events_v2_previous_fk FOREIGN KEY (
    previous_event_digest, organization_id, account_id
  ) REFERENCES public.trader_reality_events_v2(id, organization_id, account_id),
  CONSTRAINT trader_reality_events_v2_quarantine_fk FOREIGN KEY (
    quarantine_event_id, organization_id, account_id
  ) REFERENCES public.trader_reality_events_v2(id, organization_id, account_id),
  CONSTRAINT trader_reality_events_v2_id_digest CHECK (
    id = content_digest AND id ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT trader_reality_events_v2_schema CHECK (
    schema_version = 'reality-event/v2'
    AND event_sequence > 0
    AND event_type IN (
      'OBSERVED', 'QUARANTINED', 'RELEASED', 'SUPERSEDED', 'SOURCE_CONTRADICTION'
    )
    AND jsonb_typeof(reason_codes) = 'array'
    AND ((event_type = 'RELEASED' AND quarantine_event_id IS NOT NULL)
      OR (event_type <> 'RELEASED' AND quarantine_event_id IS NULL))
    AND ((event_sequence = 1 AND previous_event_digest IS NULL)
      OR (event_sequence > 1 AND previous_event_digest IS NOT NULL))
  ),
  CONSTRAINT trader_reality_events_v2_semantics CHECK (
    (event_type = 'OBSERVED' AND related_truth_record_id IS NULL)
    OR (event_type = 'QUARANTINED' AND jsonb_array_length(reason_codes) > 0)
    OR (event_type = 'RELEASED' AND truth_record_id IS NOT NULL)
    OR (event_type = 'SUPERSEDED' AND truth_record_id IS NOT NULL
      AND related_truth_record_id IS NOT NULL
      AND truth_record_id <> related_truth_record_id)
    OR (event_type = 'SOURCE_CONTRADICTION' AND truth_record_id IS NOT NULL
      AND related_truth_record_id IS NOT NULL
      AND truth_record_id <> related_truth_record_id
      AND jsonb_array_length(reason_codes) > 0)
  )
);
--> statement-breakpoint
CREATE INDEX trader_reality_events_v2_scope_knowledge_idx
  ON public.trader_reality_events_v2 (
    organization_id, account_id, knowledge_at, event_sequence
  );
--> statement-breakpoint
CREATE UNIQUE INDEX trader_reality_events_v2_one_release_per_quarantine
  ON public.trader_reality_events_v2 (
    organization_id, account_id, quarantine_event_id
  ) WHERE event_type = 'RELEASED';
--> statement-breakpoint
CREATE TABLE public.trader_reality_projections_v2 (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (account_id ~ '[^[:space:]]'),
  projection_policy_version text NOT NULL,
  knowledge_as_of timestamptz NOT NULL,
  frontier_sequence bigint NOT NULL,
  frontier_event_digest text,
  stable_entries jsonb NOT NULL,
  uncertainties jsonb NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_reality_projections_v2_id_scope_unique
    UNIQUE (id, organization_id, account_id),
  CONSTRAINT trader_reality_projections_v2_frontier_fk FOREIGN KEY (
    frontier_event_digest, organization_id, account_id
  ) REFERENCES public.trader_reality_events_v2(id, organization_id, account_id),
  CONSTRAINT trader_reality_projections_v2_id_digest CHECK (
    id = content_digest AND id ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT trader_reality_projections_v2_schema CHECK (
    schema_version = 'reality-projection/v2'
    AND projection_policy_version = 'reality-fold/htx-spot-v1'
    AND frontier_sequence >= 0
    AND jsonb_typeof(stable_entries) = 'array'
    AND jsonb_typeof(uncertainties) = 'array'
    AND ((frontier_sequence = 0 AND frontier_event_digest IS NULL)
      OR (frontier_sequence > 0 AND frontier_event_digest IS NOT NULL))
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_reality_projections_v2_scope_asof_content_unique
  ON public.trader_reality_projections_v2 (
    organization_id, account_id, projection_policy_version, knowledge_as_of, content_digest
  );
--> statement-breakpoint
CREATE INDEX trader_reality_projections_v2_scope_frontier_idx
  ON public.trader_reality_projections_v2 (
    organization_id, account_id, frontier_sequence, knowledge_as_of
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_reality_v2_block_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_reality_v2_guard_raw_source_admission_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.trader_mi_source source
    WHERE source.id = NEW.capture_source_id
      AND source.organization_id = NEW.organization_id
      AND source.status = 'active'
      AND upper(source.venue) = NEW.provider
      AND source.feed_kind = NEW.feed_class
      AND NEW.transport = 'REST'
  ) THEN
    RAISE EXCEPTION 'Reality raw-source admission requires an active exact provider/feed registry identity'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.created_at := date_trunc('milliseconds', transaction_timestamp());
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_reality_raw_source_admissions_v2_guard_insert
  BEFORE INSERT ON public.trader_reality_raw_source_admissions_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_guard_raw_source_admission_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_reality_v2_guard_admitted_source_identity_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.trader_reality_raw_source_admissions_v2 admission
    WHERE admission.organization_id = OLD.organization_id
      AND admission.capture_source_id = OLD.id
  ) AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.venue IS DISTINCT FROM OLD.venue
    OR NEW.feed_kind IS DISTINCT FROM OLD.feed_kind
    OR NEW.symbol IS DISTINCT FROM OLD.symbol
    OR (OLD.status = 'deprecated' AND NEW.status = 'active')
  ) THEN
    RAISE EXCEPTION 'admitted Reality capture-source identity is immutable and cannot be reactivated'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_mi_source_reality_admission_identity_guard
  BEFORE UPDATE ON public.trader_mi_source
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_guard_admitted_source_identity_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_reality_v2_allocate_knowledge_at(
  scope_organization_id uuid,
  scope_account_id text
)
RETURNS TABLE(reservation_id uuid, knowledge_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  frontier public.trader_reality_knowledge_frontiers_v2%ROWTYPE;
  allocated_reservation_id uuid;
  next_knowledge_at timestamptz;
BEGIN
  IF scope_organization_id IS NULL OR scope_account_id IS NULL
    OR scope_account_id !~ '[^[:space:]]'
  THEN
    RAISE EXCEPTION 'Reality knowledge allocation requires a nonblank account scope'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    scope_organization_id::text || ':' || scope_account_id, 675
  ));
  INSERT INTO public.trader_reality_knowledge_frontiers_v2 (
    organization_id, account_id
  ) VALUES (scope_organization_id, scope_account_id)
  ON CONFLICT (organization_id, account_id) DO NOTHING;
  SELECT * INTO frontier
  FROM public.trader_reality_knowledge_frontiers_v2
  WHERE organization_id = scope_organization_id AND account_id = scope_account_id
  FOR UPDATE;
  IF frontier.pending_transaction_id = txid_current() THEN
    RAISE EXCEPTION 'Reality transaction already owns an unconsumed knowledge reservation'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  next_knowledge_at := date_trunc('milliseconds', transaction_timestamp());
  IF frontier.last_knowledge_at IS NOT NULL
    AND next_knowledge_at <= frontier.last_knowledge_at
  THEN
    next_knowledge_at := frontier.last_knowledge_at + interval '1 millisecond';
  END IF;
  allocated_reservation_id := gen_random_uuid();
  UPDATE public.trader_reality_knowledge_frontiers_v2 SET
    pending_reservation_id = allocated_reservation_id,
    pending_transaction_id = txid_current(),
    pending_knowledge_at = next_knowledge_at,
    updated_at = date_trunc('milliseconds', clock_timestamp())
  WHERE organization_id = scope_organization_id AND account_id = scope_account_id;
  RETURN QUERY SELECT allocated_reservation_id, next_knowledge_at;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_reality_v2_consume_knowledge_reservation(
  scope_organization_id uuid,
  scope_account_id text,
  supplied_reservation_id uuid,
  supplied_knowledge_at timestamptz
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  consumed_rows integer;
BEGIN
  IF scope_organization_id IS NULL OR scope_account_id IS NULL
    OR scope_account_id !~ '[^[:space:]]'
  THEN
    RAISE EXCEPTION 'Reality knowledge reservation consumption requires a nonblank account scope'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    scope_organization_id::text || ':' || scope_account_id, 675
  ));
  UPDATE public.trader_reality_knowledge_frontiers_v2 SET
    last_knowledge_at = supplied_knowledge_at,
    pending_reservation_id = NULL,
    pending_transaction_id = NULL,
    pending_knowledge_at = NULL,
    updated_at = date_trunc('milliseconds', clock_timestamp())
  WHERE organization_id = scope_organization_id
    AND account_id = scope_account_id
    AND pending_reservation_id = supplied_reservation_id
    AND pending_transaction_id = txid_current()
    AND pending_knowledge_at = supplied_knowledge_at
    AND (last_knowledge_at IS NULL OR supplied_knowledge_at > last_knowledge_at);
  GET DIAGNOSTICS consumed_rows = ROW_COUNT;
  IF consumed_rows <> 1 THEN
    RAISE EXCEPTION 'Reality knowledge reservation is forged, stale, reused, or cross-scope'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_reality_v2_guard_source_report_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.organization_id::text || ':' || NEW.account_id, 675
  ));
  PERFORM public.waia_reality_v2_consume_knowledge_reservation(
    NEW.organization_id, NEW.account_id, NEW.knowledge_reservation_id, NEW.knowledge_at
  );
  NEW.created_at := NEW.knowledge_at;
  IF NEW.valid_at > NEW.knowledge_at THEN
    RAISE EXCEPTION 'Reality valid time cannot follow database-authored knowledge time'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.source_kind = 'EXECUTION_REPORT_V2' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.trader_execution_reports_v2 report
      JOIN public.trader_execution_attempts_v2 attempt
        ON attempt.id = report.execution_attempt_id
       AND attempt.organization_id = report.organization_id
       AND attempt.account_id = report.account_id
      WHERE report.id = NEW.execution_report_id
        AND report.organization_id = NEW.organization_id
        AND report.account_id = NEW.account_id
        AND report.content_digest = NEW.execution_report_digest
        AND report.report_sequence::text =
          NEW.provenance #>> '{sourceFinalityMetadata,0,value}'
        AND report.report_type = NEW.provenance #>> '{sourceFinalityMetadata,1,value}'
        AND upper(attempt.venue) = 'HTX'
    ) THEN
      RAISE EXCEPTION 'ExecutionReportV2 lineage does not match scoped immutable HTX source'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.trader_mi_raw_capture_receipt_v1 capture
      JOIN public.trader_reality_raw_source_admissions_v2 admission
        ON admission.organization_id = capture.organization_id
       AND admission.account_id = NEW.account_id
       AND admission.capture_source_id = capture.source_id
       AND admission.reality_source_kind = NEW.source_kind
      JOIN public.trader_mi_source source
        ON source.id = capture.source_id
       AND source.organization_id = capture.organization_id
      WHERE capture.id = NEW.raw_capture_receipt_digest
        AND capture.organization_id = NEW.organization_id
        AND capture.source_id = NEW.raw_capture_source_id
        AND capture.raw_bytes_digest = NEW.raw_bytes_digest
        AND capture.storage_binding_digest = NEW.storage_binding_digest
        AND source.status = 'active'
        AND upper(source.venue) = admission.provider
        AND source.feed_kind = admission.feed_class
        AND admission.transport = 'REST'
    ) THEN
      RAISE EXCEPTION 'raw HTX lineage does not match the encrypted scoped capture receipt and registered private REST source class'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_reality_source_reports_v2_guard_insert
  BEFORE INSERT ON public.trader_reality_source_reports_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_guard_source_report_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_reality_v2_guard_truth_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_row public.trader_reality_source_reports_v2%ROWTYPE;
  superseded_row public.trader_reality_truth_records_v2%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.organization_id::text || ':' || NEW.account_id, 675
  ));
  SELECT * INTO source_row FROM public.trader_reality_source_reports_v2
  WHERE id = NEW.source_report_id AND organization_id = NEW.organization_id
    AND account_id = NEW.account_id;
  IF source_row.id IS NULL OR source_row.structural_verification <> 'VERIFIED'
    OR source_row.content_digest <> NEW.source_report_digest
    OR source_row.source_kind <> NEW.source_kind
    OR source_row.source_native_identity_kind IS DISTINCT FROM NEW.source_native_identity_kind
    OR source_row.source_native_id IS DISTINCT FROM NEW.source_native_id
    OR source_row.source_native_revision IS DISTINCT FROM NEW.source_native_revision
    OR source_row.supersedes_native_revision IS DISTINCT FROM NEW.supersedes_native_revision
    OR source_row.subject_class <> NEW.subject_class
    OR source_row.subject_key <> NEW.subject_key
    OR source_row.primitive_assertion IS DISTINCT FROM NEW.primitive_assertion
    OR source_row.valid_at <> NEW.valid_at
    OR source_row.knowledge_at <> NEW.knowledge_at
  THEN
    RAISE EXCEPTION 'TruthRecordV2 must exactly match its verified scoped source report'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.supersedes_truth_record_id IS NOT NULL THEN
    SELECT * INTO superseded_row FROM public.trader_reality_truth_records_v2
    WHERE id = NEW.supersedes_truth_record_id AND organization_id = NEW.organization_id
      AND account_id = NEW.account_id;
    IF superseded_row.id IS NULL OR NEW.source_native_revision IS NULL
      OR NEW.supersedes_native_revision IS NULL
      OR superseded_row.source_kind <> NEW.source_kind
      OR superseded_row.source_native_identity_kind IS DISTINCT FROM NEW.source_native_identity_kind
      OR superseded_row.source_native_id IS DISTINCT FROM NEW.source_native_id
      OR superseded_row.source_native_revision IS DISTINCT FROM NEW.supersedes_native_revision
      OR superseded_row.subject_class <> NEW.subject_class
      OR superseded_row.subject_key <> NEW.subject_key
    THEN
      RAISE EXCEPTION 'Only explicit source-native correction may supersede scoped truth'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_reality_truth_records_v2_guard_insert
  BEFORE INSERT ON public.trader_reality_truth_records_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_guard_truth_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_reality_v2_guard_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prior_sequence bigint;
  prior_digest text;
  truth_row public.trader_reality_truth_records_v2%ROWTYPE;
  related_row public.trader_reality_truth_records_v2%ROWTYPE;
  quarantine_row public.trader_reality_events_v2%ROWTYPE;
  source_row public.trader_reality_source_reports_v2%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.organization_id::text || ':' || NEW.account_id, 675
  ));
  SELECT event_sequence, content_digest INTO prior_sequence, prior_digest
  FROM public.trader_reality_events_v2
  WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id
  ORDER BY event_sequence DESC LIMIT 1;
  IF prior_sequence IS NULL THEN
    IF NEW.event_sequence <> 1 OR NEW.previous_event_digest IS NOT NULL THEN
      RAISE EXCEPTION 'Reality event must start at sequence 1 with no predecessor'
        USING ERRCODE = 'serialization_failure';
    END IF;
  ELSIF NEW.event_sequence <> prior_sequence + 1
    OR NEW.previous_event_digest IS DISTINCT FROM prior_digest
  THEN
    RAISE EXCEPTION 'Reality event sequence/digest head mismatch'
      USING ERRCODE = 'serialization_failure';
  END IF;
  PERFORM public.waia_reality_v2_consume_knowledge_reservation(
    NEW.organization_id, NEW.account_id, NEW.knowledge_reservation_id, NEW.knowledge_at
  );
  SELECT * INTO source_row FROM public.trader_reality_source_reports_v2
    WHERE id = NEW.source_report_id AND organization_id = NEW.organization_id
      AND account_id = NEW.account_id;
  IF NEW.truth_record_id IS NOT NULL THEN
    SELECT * INTO truth_row FROM public.trader_reality_truth_records_v2
      WHERE id = NEW.truth_record_id AND organization_id = NEW.organization_id
        AND account_id = NEW.account_id;
  END IF;
  IF NEW.related_truth_record_id IS NOT NULL THEN
    SELECT * INTO related_row FROM public.trader_reality_truth_records_v2
      WHERE id = NEW.related_truth_record_id AND organization_id = NEW.organization_id
        AND account_id = NEW.account_id;
  END IF;
  IF NEW.quarantine_event_id IS NOT NULL THEN
    SELECT * INTO quarantine_row FROM public.trader_reality_events_v2
      WHERE id = NEW.quarantine_event_id AND organization_id = NEW.organization_id
        AND account_id = NEW.account_id;
  END IF;
  IF NEW.event_type IN ('QUARANTINED', 'SOURCE_CONTRADICTION') AND EXISTS (
    SELECT 1 FROM public.trader_reality_events_v2 prior_quarantine
    WHERE prior_quarantine.organization_id = NEW.organization_id
      AND prior_quarantine.account_id = NEW.account_id
      AND prior_quarantine.source_report_id = NEW.source_report_id
      AND prior_quarantine.truth_record_id IS NOT DISTINCT FROM NEW.truth_record_id
      AND prior_quarantine.event_type IN ('QUARANTINED', 'SOURCE_CONTRADICTION')
      AND NOT EXISTS (
        SELECT 1 FROM public.trader_reality_events_v2 release_event
        WHERE release_event.organization_id = NEW.organization_id
          AND release_event.account_id = NEW.account_id
          AND release_event.event_type = 'RELEASED'
          AND release_event.quarantine_event_id = prior_quarantine.id
      )
  ) THEN
    RAISE EXCEPTION 'Reality causal episode already has an unresolved quarantine'
      USING ERRCODE = 'unique_violation';
  END IF;
  IF NEW.event_type = 'OBSERVED' THEN
    IF truth_row.id IS NULL OR NEW.related_truth_record_id IS NOT NULL
      OR truth_row.source_report_id <> NEW.source_report_id
      OR truth_row.supersedes_truth_record_id IS NOT NULL
      OR truth_row.markers <> '[]'::jsonb
      OR EXISTS (
        SELECT 1 FROM public.trader_reality_truth_records_v2 prior_truth
        WHERE prior_truth.organization_id = NEW.organization_id
          AND prior_truth.account_id = NEW.account_id
          AND prior_truth.subject_class = truth_row.subject_class
          AND prior_truth.subject_key = truth_row.subject_key
          AND prior_truth.id <> truth_row.id
          AND prior_truth.markers = '[]'::jsonb
      )
    THEN
      RAISE EXCEPTION 'OBSERVED must introduce exactly one unsuperseding stable truth from its source'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.event_type = 'SUPERSEDED' THEN
    IF truth_row.id IS NULL OR related_row.id IS NULL
      OR truth_row.source_report_id <> NEW.source_report_id
      OR truth_row.supersedes_truth_record_id IS DISTINCT FROM related_row.id
      OR truth_row.markers <> '[]'::jsonb OR related_row.markers <> '[]'::jsonb
      OR truth_row.subject_class <> related_row.subject_class
      OR truth_row.subject_key <> related_row.subject_key
      OR NOT EXISTS (
        SELECT 1 FROM public.trader_reality_events_v2 stable_event
        WHERE stable_event.organization_id = NEW.organization_id
          AND stable_event.account_id = NEW.account_id
          AND stable_event.truth_record_id = related_row.id
          AND stable_event.event_type IN ('OBSERVED', 'SUPERSEDED')
      )
      OR EXISTS (
        SELECT 1 FROM public.trader_reality_events_v2 later_correction
        WHERE later_correction.organization_id = NEW.organization_id
          AND later_correction.account_id = NEW.account_id
          AND later_correction.related_truth_record_id = related_row.id
          AND later_correction.event_type = 'SUPERSEDED'
      )
    THEN
      RAISE EXCEPTION 'SUPERSEDED must exactly link a source-native correction to current stable truth'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.event_type = 'QUARANTINED' THEN
    IF source_row.id IS NULL OR NEW.truth_record_id IS NOT NULL
      OR NEW.related_truth_record_id IS NOT NULL
      OR jsonb_array_length(NEW.reason_codes) = 0
      OR NOT (
        (
          source_row.structural_verification = 'UNVERIFIABLE'
          AND NOT (NEW.reason_codes ? 'CORRECTION_TARGET_NOT_FOUND')
        )
        OR (
          source_row.structural_verification = 'VERIFIED'
          AND source_row.attribution_status = 'ATTRIBUTED'
          AND source_row.source_native_identity_kind IS NOT NULL
          AND source_row.source_native_id IS NOT NULL
          AND source_row.source_native_revision IS NOT NULL
          AND source_row.supersedes_native_revision IS NOT NULL
          AND NEW.reason_codes = '["CORRECTION_TARGET_NOT_FOUND"]'::jsonb
          AND NOT EXISTS (
            SELECT 1 FROM public.trader_reality_truth_records_v2 target_truth
            WHERE target_truth.organization_id = NEW.organization_id
              AND target_truth.account_id = NEW.account_id
              AND target_truth.source_kind = source_row.source_kind
              AND target_truth.source_native_identity_kind IS NOT DISTINCT FROM
                source_row.source_native_identity_kind
              AND target_truth.source_native_id IS NOT DISTINCT FROM source_row.source_native_id
              AND target_truth.source_native_revision IS NOT DISTINCT FROM
                source_row.supersedes_native_revision
              AND target_truth.subject_class = source_row.subject_class
              AND target_truth.subject_key = source_row.subject_key
              AND target_truth.markers = '[]'::jsonb
              AND EXISTS (
                SELECT 1 FROM public.trader_reality_events_v2 stable_event
                WHERE stable_event.organization_id = target_truth.organization_id
                  AND stable_event.account_id = target_truth.account_id
                  AND stable_event.truth_record_id = target_truth.id
                  AND stable_event.event_type IN ('OBSERVED', 'SUPERSEDED')
              )
              AND NOT EXISTS (
                SELECT 1 FROM public.trader_reality_events_v2 later_correction
                WHERE later_correction.organization_id = target_truth.organization_id
                  AND later_correction.account_id = target_truth.account_id
                  AND later_correction.related_truth_record_id = target_truth.id
                  AND later_correction.event_type = 'SUPERSEDED'
              )
          )
        )
      )
    THEN
      RAISE EXCEPTION 'QUARANTINED must exactly preserve one source-only causal episode with an absent correction target'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.event_type = 'SOURCE_CONTRADICTION' THEN
    IF truth_row.id IS NULL OR related_row.id IS NULL
      OR truth_row.source_report_id <> NEW.source_report_id
      OR truth_row.markers <> '["SOURCE_CONTRADICTION"]'::jsonb
      OR related_row.markers <> '[]'::jsonb
      OR truth_row.subject_class <> related_row.subject_class
      OR truth_row.subject_key <> related_row.subject_key
      OR NOT EXISTS (
        SELECT 1 FROM public.trader_reality_events_v2 stable_event
        WHERE stable_event.organization_id = NEW.organization_id
          AND stable_event.account_id = NEW.account_id
          AND stable_event.truth_record_id = related_row.id
          AND stable_event.event_type IN ('OBSERVED', 'SUPERSEDED')
      )
      OR EXISTS (
        SELECT 1 FROM public.trader_reality_events_v2 later_correction
        WHERE later_correction.organization_id = NEW.organization_id
          AND later_correction.account_id = NEW.account_id
          AND later_correction.related_truth_record_id = related_row.id
          AND later_correction.event_type = 'SUPERSEDED'
      )
    THEN
      RAISE EXCEPTION 'SOURCE_CONTRADICTION must exactly link disputed and current stable truth for one source subject'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.event_type = 'RELEASED' THEN
    IF quarantine_row.id IS NULL OR truth_row.id IS NULL
      OR quarantine_row.event_type NOT IN ('QUARANTINED', 'SOURCE_CONTRADICTION')
      OR quarantine_row.source_report_id <> NEW.source_report_id
      OR quarantine_row.truth_record_id IS DISTINCT FROM truth_row.id
      OR quarantine_row.related_truth_record_id IS DISTINCT FROM NEW.related_truth_record_id
      OR truth_row.source_report_id <> NEW.source_report_id
      OR truth_row.markers <> '["SOURCE_CONTRADICTION"]'::jsonb
      OR (related_row.id IS NOT NULL AND (
        related_row.markers <> '[]'::jsonb
        OR truth_row.subject_class <> related_row.subject_class
        OR truth_row.subject_key <> related_row.subject_key
      ))
      OR EXISTS (
        SELECT 1 FROM public.trader_reality_events_v2 prior_release
        WHERE prior_release.organization_id = NEW.organization_id
          AND prior_release.account_id = NEW.account_id
          AND prior_release.quarantine_event_id = quarantine_row.id
          AND prior_release.event_type = 'RELEASED'
      )
    THEN
      RAISE EXCEPTION 'RELEASED must exactly resolve one causally linked truth-bearing quarantine'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.created_at := NEW.knowledge_at;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_reality_events_v2_guard_insert
  BEFORE INSERT ON public.trader_reality_events_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_guard_event_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_reality_v2_guard_projection_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  frontier_row public.trader_reality_events_v2%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.organization_id::text || ':' || NEW.account_id, 675
  ));
  NEW.created_at := greatest(
    date_trunc('milliseconds', clock_timestamp()),
    NEW.knowledge_as_of
  );
  SELECT * INTO frontier_row FROM public.trader_reality_events_v2
  WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id
    AND knowledge_at <= NEW.knowledge_as_of
  ORDER BY knowledge_at DESC, event_sequence DESC LIMIT 1;
  IF frontier_row.id IS NULL THEN
    IF NEW.frontier_sequence <> 0 OR NEW.frontier_event_digest IS NOT NULL THEN
      RAISE EXCEPTION 'Reality projection zero frontier is not exact at requested as-of time'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF frontier_row.id IS DISTINCT FROM NEW.frontier_event_digest
      OR frontier_row.event_sequence <> NEW.frontier_sequence
      OR frontier_row.knowledge_at <> NEW.knowledge_as_of
    THEN
      RAISE EXCEPTION 'Reality projection frontier is not exact at requested as-of time'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_reality_projections_v2_guard_insert
  BEFORE INSERT ON public.trader_reality_projections_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_guard_projection_insert();
--> statement-breakpoint
CREATE TRIGGER trader_reality_raw_source_admissions_v2_block_update
  BEFORE UPDATE ON public.trader_reality_raw_source_admissions_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_reality_raw_source_admissions_v2_block_delete
  BEFORE DELETE ON public.trader_reality_raw_source_admissions_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_reality_source_reports_v2_block_update
  BEFORE UPDATE ON public.trader_reality_source_reports_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_reality_source_reports_v2_block_delete
  BEFORE DELETE ON public.trader_reality_source_reports_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_reality_truth_records_v2_block_update
  BEFORE UPDATE ON public.trader_reality_truth_records_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_reality_truth_records_v2_block_delete
  BEFORE DELETE ON public.trader_reality_truth_records_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_reality_events_v2_block_update
  BEFORE UPDATE ON public.trader_reality_events_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_reality_events_v2_block_delete
  BEFORE DELETE ON public.trader_reality_events_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_reality_projections_v2_block_update
  BEFORE UPDATE ON public.trader_reality_projections_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_reality_projections_v2_block_delete
  BEFORE DELETE ON public.trader_reality_projections_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_reality_v2_block_append_only_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_reality_raw_source_admissions_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_reality_knowledge_frontiers_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_reality_source_reports_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_reality_truth_records_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_reality_events_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_reality_projections_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trader_reality_raw_source_admissions_v2_deny_client_all
  ON public.trader_reality_raw_source_admissions_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_reality_knowledge_frontiers_v2_deny_client_all
  ON public.trader_reality_knowledge_frontiers_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_reality_source_reports_v2_deny_client_all
  ON public.trader_reality_source_reports_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_reality_truth_records_v2_deny_client_all
  ON public.trader_reality_truth_records_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_reality_events_v2_deny_client_all
  ON public.trader_reality_events_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_reality_projections_v2_deny_client_all
  ON public.trader_reality_projections_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_reality_raw_source_admissions_v2
  FROM PUBLIC, authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_reality_knowledge_frontiers_v2
  FROM PUBLIC, authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_reality_source_reports_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_reality_truth_records_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_reality_events_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_reality_projections_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waia_reality_v2_allocate_knowledge_at(uuid, text)
  FROM PUBLIC, authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.waia_reality_v2_consume_knowledge_reservation(
  uuid, text, uuid, timestamptz
)
  FROM PUBLIC, authenticated, anon;
