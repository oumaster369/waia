-- DEE-633: minimal immutable Forecast-V2 outcome/calibration replay payload.
-- Existing rows remain valid; the new DEE-633 persistence seam always supplies every field.
-- Existing append-only triggers and deny-by-default RLS policies remain unchanged.

ALTER TABLE public.trader_forecast_bundle_v2
  ADD COLUMN IF NOT EXISTS forecast_runtime_authorized_outcome_json jsonb,
  ADD COLUMN IF NOT EXISTS forecast_runtime_issuance_sequence integer;
--> statement-breakpoint

ALTER TABLE public.trader_forecast_bundle_v2
  ADD CONSTRAINT tfbv2_dee633_runtime_payload_check CHECK (
    forecast_runtime_authorized_outcome_json IS NULL
    OR jsonb_typeof(forecast_runtime_authorized_outcome_json) = 'object'
  );
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.trader_forecast_pit_bar_v2 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  symbol text NOT NULL,
  interval text NOT NULL CHECK (interval = '1m'),
  bar_close_time timestamptz NOT NULL,
  bar_content_digest text NOT NULL CHECK (bar_content_digest ~ '^[0-9a-f]{64}$'),
  bar_json jsonb NOT NULL CHECK (jsonb_typeof(bar_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, run_id, symbol, interval, bar_close_time)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.trader_forecast_pit_bar_retention_audit_v2 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  request_id uuid NOT NULL,
  cutoff_at timestamptz NOT NULL,
  evaluated_at timestamptz NOT NULL,
  purged_row_count bigint NOT NULL CHECK (purged_row_count >= 0),
  PRIMARY KEY (organization_id, request_id)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.trader_forecast_pit_bar_retention_guard_v2 (
  transaction_id bigint PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id)
);
--> statement-breakpoint

ALTER TABLE public.trader_forecast_pit_bar_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_forecast_pit_bar_retention_audit_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY trader_forecast_pit_bar_v2_deny_select
  ON public.trader_forecast_pit_bar_v2 FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint

CREATE POLICY trader_forecast_pit_bar_v2_deny_write
  ON public.trader_forecast_pit_bar_v2 FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY trader_forecast_pit_bar_retention_audit_v2_deny_all
  ON public.trader_forecast_pit_bar_retention_audit_v2
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint

REVOKE ALL ON TABLE public.trader_forecast_pit_bar_retention_guard_v2
  FROM PUBLIC, authenticated, anon;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.waia_forecast_pit_bar_v2_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.trader_forecast_pit_bar_retention_guard_v2 g
    WHERE g.transaction_id = txid_current()
      AND g.organization_id = OLD.organization_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'trader_forecast_pit_bar_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trader_forecast_pit_bar_v2_block_update
  BEFORE UPDATE ON public.trader_forecast_pit_bar_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_pit_bar_v2_block_mutation();
--> statement-breakpoint

CREATE TRIGGER trader_forecast_pit_bar_v2_block_delete
  BEFORE DELETE ON public.trader_forecast_pit_bar_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_pit_bar_v2_block_mutation();
--> statement-breakpoint

CREATE TRIGGER trader_forecast_pit_bar_retention_audit_v2_block_update
  BEFORE UPDATE ON public.trader_forecast_pit_bar_retention_audit_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_pit_bar_v2_block_mutation();
--> statement-breakpoint

CREATE TRIGGER trader_forecast_pit_bar_retention_audit_v2_block_delete
  BEFORE DELETE ON public.trader_forecast_pit_bar_retention_audit_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_pit_bar_v2_block_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.waia_forecast_pit_bar_v2_purge_retained(
  scope_organization_id uuid,
  purge_request_id uuid,
  cutoff_at timestamptz
)
RETURNS TABLE(request_id uuid, purged_row_count bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  evaluated_at timestamptz := statement_timestamp();
  existing_audit public.trader_forecast_pit_bar_retention_audit_v2%ROWTYPE;
  deleted_count bigint := 0;
BEGIN
  IF scope_organization_id IS NULL OR purge_request_id IS NULL OR cutoff_at IS NULL THEN
    RAISE EXCEPTION 'Forecast-V2 PIT retention purge requires organization, request, and cutoff'
      USING ERRCODE = 'check_violation';
  END IF;
  IF cutoff_at > evaluated_at - interval '30 days' THEN
    RAISE EXCEPTION 'Forecast-V2 PIT retention cutoff must be at least 30 days old'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(scope_organization_id::text, 633));
  SELECT * INTO existing_audit
  FROM public.trader_forecast_pit_bar_retention_audit_v2 a
  WHERE a.organization_id = scope_organization_id
    AND a.request_id = purge_request_id;
  IF FOUND THEN
    IF existing_audit.cutoff_at IS DISTINCT FROM cutoff_at THEN
      RAISE EXCEPTION 'Forecast-V2 PIT retention request conflict'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN QUERY SELECT existing_audit.request_id, existing_audit.purged_row_count;
    RETURN;
  END IF;

  INSERT INTO public.trader_forecast_pit_bar_retention_guard_v2 (
    transaction_id, organization_id
  ) VALUES (txid_current(), scope_organization_id);
  DELETE FROM public.trader_forecast_pit_bar_v2 p
  WHERE p.organization_id = scope_organization_id
    AND p.created_at < cutoff_at
    AND NOT EXISTS (
      SELECT 1
      FROM public.trader_forecast_bundle_v2 b
      WHERE b.organization_id = p.organization_id
        AND b.run_id = p.run_id
        AND b.symbol = p.symbol
        AND NOT EXISTS (
          SELECT 1
          FROM public.trader_forecast_outcome_v2 o
          WHERE o.organization_id = b.organization_id
            AND o.bundle_id = b.id
            AND o.outcome_class = 'RESOLVED'
        )
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  DELETE FROM public.trader_forecast_pit_bar_retention_guard_v2
  WHERE transaction_id = txid_current()
    AND organization_id = scope_organization_id;

  INSERT INTO public.trader_forecast_pit_bar_retention_audit_v2 (
    organization_id, request_id, cutoff_at, evaluated_at, purged_row_count
  ) VALUES (
    scope_organization_id, purge_request_id, cutoff_at, evaluated_at, deleted_count
  );
  RETURN QUERY SELECT purge_request_id, deleted_count;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.waia_forecast_pit_bar_v2_purge_retained(uuid, uuid, timestamptz)
  FROM PUBLIC, authenticated, anon;
--> statement-breakpoint

ALTER TABLE public.trader_forecast_bundle_v2
  ADD CONSTRAINT tfbv2_dee633_runtime_sequence_check CHECK (
    (forecast_runtime_authorized_outcome_json IS NULL AND forecast_runtime_issuance_sequence IS NULL)
    OR (forecast_runtime_authorized_outcome_json IS NOT NULL AND forecast_runtime_issuance_sequence >= 0)
  );
--> statement-breakpoint

ALTER TABLE public.trader_forecast_outcome_v2
  ADD COLUMN IF NOT EXISTS pit_measurement_identity_digest bytea,
  ADD COLUMN IF NOT EXISTS observed_terminal_return double precision,
  ADD COLUMN IF NOT EXISTS observed_bucket_ordinal smallint,
  ADD COLUMN IF NOT EXISTS objective_evidence_json jsonb,
  ADD COLUMN IF NOT EXISTS forecast_runtime_authority_content_digest bytea,
  ADD COLUMN IF NOT EXISTS predictive_package_content_digest text,
  ADD COLUMN IF NOT EXISTS terminal_target_definition_digest text,
  ADD COLUMN IF NOT EXISTS terminal_distribution_semantic_digest bytea,
  ADD COLUMN IF NOT EXISTS knowledge_edge_id text,
  ADD COLUMN IF NOT EXISTS knowledge_content_digest bytea;
--> statement-breakpoint

ALTER TABLE public.trader_forecast_outcome_v2
  ADD CONSTRAINT tfov2_dee633_payload_check CHECK (
    (pit_measurement_identity_digest IS NULL OR octet_length(pit_measurement_identity_digest) = 32)
    AND (observed_bucket_ordinal IS NULL OR observed_bucket_ordinal BETWEEN 0 AND 6)
    AND (objective_evidence_json IS NULL OR jsonb_typeof(objective_evidence_json) = 'object')
    AND (forecast_runtime_authority_content_digest IS NULL OR octet_length(forecast_runtime_authority_content_digest) = 32)
    AND (predictive_package_content_digest IS NULL OR predictive_package_content_digest ~ '^[0-9a-f]{64}$')
    AND (terminal_target_definition_digest IS NULL OR terminal_target_definition_digest ~ '^[0-9a-f]{64}$')
    AND (terminal_distribution_semantic_digest IS NULL OR octet_length(terminal_distribution_semantic_digest) = 32)
    AND (knowledge_edge_id IS NULL OR length(knowledge_edge_id) > 0)
    AND (knowledge_content_digest IS NULL OR octet_length(knowledge_content_digest) = 32)
  );
--> statement-breakpoint

ALTER TABLE public.trader_forecast_calibration_observation_v2
  ADD COLUMN IF NOT EXISTS scoring_version text,
  ADD COLUMN IF NOT EXISTS observed_bucket_ordinal smallint,
  ADD COLUMN IF NOT EXISTS probability_vector_json jsonb,
  ADD COLUMN IF NOT EXISTS normalized_brier_score double precision,
  ADD COLUMN IF NOT EXISTS log_loss_score double precision,
  ADD COLUMN IF NOT EXISTS calibration_payload_json jsonb;
--> statement-breakpoint

ALTER TABLE public.trader_forecast_calibration_observation_v2
  ADD CONSTRAINT tfcov2_dee633_payload_check CHECK (
    scoring_version IS NULL
    OR (
      scoring_version = 'waia.trader.forecast_v2_multiclass_scoring.v1'
      AND observed_bucket_ordinal BETWEEN 0 AND 6
      AND jsonb_typeof(probability_vector_json) = 'array'
      AND jsonb_array_length(probability_vector_json) = 7
      AND normalized_brier_score BETWEEN 0.0 AND 1.0
      AND log_loss_score >= 0.0
      AND jsonb_typeof(calibration_payload_json) = 'object'
    )
  );
--> statement-breakpoint

COMMENT ON COLUMN public.trader_forecast_calibration_observation_v2.normalized_brier_score IS
  'DEE-633 v1: (1/2)*sum_k((p_k-o_k)^2), full-precision non-capital scientific evidence.';
--> statement-breakpoint
COMMENT ON COLUMN public.trader_forecast_calibration_observation_v2.log_loss_score IS
  'DEE-633 v1: -ln(max(p_observed,1e-15)), full-precision non-capital scientific evidence.';
