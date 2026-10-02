-- DEE-1222 synthetic-only draft. No production journal entry or apply authority.
CREATE TABLE public.trader_research_training_family_selections_v1 (
  organization_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  experiment_spec_sha256 text NOT NULL,
  source_run_id text NOT NULL,
  source_issuance_digest text NOT NULL,
  receipt_canonical_json text NOT NULL CHECK (octet_length(receipt_canonical_json) BETWEEN 1 AND 262144
    AND receipt_canonical_json::jsonb->>'schemaVersion' = 'waia.research.training-family-selection.v1'),
  receipt_sha256 text NOT NULL CHECK (receipt_sha256 ~ '^[0-9a-f]{64}$'
    AND receipt_sha256 = encode(sha256(convert_to(receipt_canonical_json, 'UTF8')), 'hex')),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT research_training_family_selection_pkey PRIMARY KEY (organization_id, attempt_id),
  CONSTRAINT research_training_family_selection_attempt_fk
    FOREIGN KEY (organization_id, attempt_id, experiment_spec_sha256, source_run_id, source_issuance_digest)
    REFERENCES public.trader_research_issued_attempts_v2
      (organization_id, id, spec_sha256, source_run_id, source_issuance_digest) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TRIGGER research_training_family_selection_append_only
  BEFORE UPDATE OR DELETE ON public.trader_research_training_family_selections_v1 FOR EACH ROW
  EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER research_training_family_selection_no_truncate
  BEFORE TRUNCATE ON public.trader_research_training_family_selections_v1 FOR EACH STATEMENT
  EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_research_training_family_selections_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_research_training_family_selections_v1 FROM PUBLIC, authenticated, anon;
--> statement-breakpoint
CREATE POLICY research_training_family_selection_deny_browser
  ON public.trader_research_training_family_selections_v1 AS RESTRICTIVE
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
