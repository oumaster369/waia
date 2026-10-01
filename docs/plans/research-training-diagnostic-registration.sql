-- DEE-1159 DRAFT, synthetic PostgreSQL proof only. Not a canonical migration or
-- production apply instruction. Depends on the registered experiment/attempt
-- draft tables and the existing mutation-rejection trigger function.
CREATE TABLE public.trader_research_training_diagnostics_v1 (
  organization_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  trial_index integer NOT NULL CHECK (trial_index BETWEEN 0 AND 31),
  stage_run_id uuid NOT NULL,
  experiment_spec_sha256 text NOT NULL CHECK (experiment_spec_sha256 ~ '^[0-9a-f]{64}$'),
  scope_digest_hex text NOT NULL CHECK (scope_digest_hex ~ '^[0-9a-f]{64}$'),
  policy_digest_hex text NOT NULL CHECK (policy_digest_hex ~ '^[0-9a-f]{64}$'),
  trace_canonical_json text NOT NULL CHECK (octet_length(trace_canonical_json) BETWEEN 1 AND 16777216),
  trace_sha256 text NOT NULL CHECK (
    trace_sha256 ~ '^[0-9a-f]{64}$'
    AND trace_sha256 = encode(sha256(convert_to(trace_canonical_json, 'UTF8')), 'hex')
  ),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, attempt_id, trial_index),
  CONSTRAINT research_training_diagnostic_attempt_fk
    FOREIGN KEY (organization_id, attempt_id)
    REFERENCES public.trader_research_attempts_v1 (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT research_training_diagnostic_stage_uq UNIQUE (stage_run_id)
);
--> statement-breakpoint
CREATE TRIGGER research_training_diagnostic_append_only
  BEFORE UPDATE OR DELETE ON public.trader_research_training_diagnostics_v1 FOR EACH ROW
  EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER research_training_diagnostic_no_truncate
  BEFORE TRUNCATE ON public.trader_research_training_diagnostics_v1 FOR EACH STATEMENT
  EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_research_training_diagnostics_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_research_training_diagnostics_v1 FROM PUBLIC, authenticated, anon;
--> statement-breakpoint
CREATE POLICY research_training_diagnostic_deny_browser
  ON public.trader_research_training_diagnostics_v1 AS RESTRICTIVE
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
