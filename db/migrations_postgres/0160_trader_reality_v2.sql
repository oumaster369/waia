-- DEE-677 / R675-B: Reality V2 bitemporal truth substrate for the ratified HTX spot MVP.
-- Additive PostgreSQL only. Raw bytes remain in the existing encrypted raw-capture storage.

CREATE TABLE public.trader_reality_source_reports_v2 (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
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
  raw_capture_receipt_digest text REFERENCES public.trader_mi_raw_capture_receipt_v1(id),
  raw_bytes_digest text,
  storage_binding_digest text,
  provenance jsonb NOT NULL,
  structural_verification text NOT NULL,
  verification_reason_codes jsonb NOT NULL,
  valid_at timestamptz NOT NULL,
  knowledge_at timestamptz NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_reality_source_reports_v2_id_scope_unique
    UNIQUE (id, organization_id, account_id),
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
      AND raw_capture_receipt_digest IS NULL AND raw_bytes_digest IS NULL
      AND storage_binding_digest IS NULL)
    OR (source_kind <> 'EXECUTION_REPORT_V2' AND lineage_kind = 'RAW_CAPTURE_V1'
      AND execution_report_id IS NULL AND execution_report_digest IS NULL
      AND raw_capture_receipt_digest IS NOT NULL AND raw_bytes_digest IS NOT NULL
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
  account_id text NOT NULL,
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
  account_id text NOT NULL,
  event_sequence bigint NOT NULL,
  event_type text NOT NULL,
  source_report_id text NOT NULL,
  truth_record_id text,
  related_truth_record_id text,
  reason_codes jsonb NOT NULL,
  knowledge_at timestamptz NOT NULL,
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
    AND ((event_sequence = 1 AND previous_event_digest IS NULL)
      OR (event_sequence > 1 AND previous_event_digest IS NOT NULL))
  ),
  CONSTRAINT trader_reality_events_v2_semantics CHECK (
    (event_type = 'OBSERVED' AND related_truth_record_id IS NULL)
    OR (event_type = 'QUARANTINED' AND jsonb_array_length(reason_codes) > 0)
    OR (event_type = 'RELEASED' AND truth_record_id IS NOT NULL
      AND related_truth_record_id IS NULL)
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
CREATE TABLE public.trader_reality_projections_v2 (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
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
CREATE OR REPLACE FUNCTION public.waia_reality_v2_guard_source_report_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.knowledge_at := date_trunc('milliseconds', transaction_timestamp());
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
        AND upper(attempt.venue) = 'HTX'
    ) THEN
      RAISE EXCEPTION 'ExecutionReportV2 lineage does not match scoped immutable HTX source'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.trader_mi_raw_capture_receipt_v1 capture
      WHERE capture.id = NEW.raw_capture_receipt_digest
        AND capture.organization_id = NEW.organization_id
        AND capture.raw_bytes_digest = NEW.raw_bytes_digest
        AND capture.storage_binding_digest = NEW.storage_binding_digest
    ) THEN
      RAISE EXCEPTION 'raw HTX lineage does not match encrypted scoped capture receipt'
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
  NEW.knowledge_at := date_trunc('milliseconds', transaction_timestamp());
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
  NEW.created_at := date_trunc('milliseconds', transaction_timestamp());
  IF NEW.knowledge_as_of > NEW.created_at THEN
    RAISE EXCEPTION 'Reality projection as-of cannot be in the future'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.frontier_sequence > 0 THEN
    SELECT * INTO frontier_row FROM public.trader_reality_events_v2
    WHERE id = NEW.frontier_event_digest AND organization_id = NEW.organization_id
      AND account_id = NEW.account_id;
    IF frontier_row.id IS NULL OR frontier_row.event_sequence <> NEW.frontier_sequence
      OR frontier_row.knowledge_at > NEW.knowledge_as_of
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
ALTER TABLE public.trader_reality_source_reports_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_reality_truth_records_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_reality_events_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_reality_projections_v2 ENABLE ROW LEVEL SECURITY;
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
REVOKE ALL ON TABLE public.trader_reality_source_reports_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_reality_truth_records_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_reality_events_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_reality_projections_v2 FROM authenticated, anon;
