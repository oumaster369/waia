-- DEE-1159 DRAFT migration payload. Not in the migration journal yet.
-- Assign its canonical number after the preceding 0230 queue is integrated.
-- Local synthetic proof only; not a production apply instruction.

CREATE UNIQUE INDEX trader_admission_family_spec_size_uq
  ON public.trader_strategy_admission_family (spec_sha256, family_size);
--> statement-breakpoint
CREATE TABLE public.trader_research_experiments_v1 (
  spec_sha256 text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  family_size integer NOT NULL CHECK (family_size BETWEEN 1 AND 32),
  spec_canonical_json text NOT NULL,
  registered_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT research_experiment_org_identity_uq UNIQUE (organization_id, spec_sha256),
  CONSTRAINT research_experiment_family_fk FOREIGN KEY (spec_sha256, family_size)
    REFERENCES public.trader_strategy_admission_family (spec_sha256, family_size),
  CONSTRAINT research_experiment_digest_check CHECK (
    spec_sha256 ~ '^[0-9a-f]{64}$'
    AND spec_sha256 = encode(sha256(convert_to(spec_canonical_json, 'UTF8')), 'hex')
  ),
  CONSTRAINT research_experiment_size_check CHECK (octet_length(spec_canonical_json) <= 262144),
  CONSTRAINT research_experiment_scope_check CHECK (COALESCE(
    jsonb_typeof(spec_canonical_json::jsonb) = 'object'
    AND spec_canonical_json::jsonb ->> 'schemaVersion' = 'waia.research.experiment.v1'
    AND spec_canonical_json::jsonb ->> 'organizationId' = organization_id::text
    AND jsonb_typeof(spec_canonical_json::jsonb -> 'orderedTrials') = 'array'
    AND jsonb_array_length(spec_canonical_json::jsonb -> 'orderedTrials') = family_size,
    false
  ))
);
--> statement-breakpoint
CREATE FUNCTION public.trader_research_experiment_registered_at_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.registered_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER research_experiment_registration_clock
  BEFORE INSERT ON public.trader_research_experiments_v1 FOR EACH ROW
  EXECUTE FUNCTION public.trader_research_experiment_registered_at_v1();
--> statement-breakpoint
CREATE TRIGGER research_experiment_append_only
  BEFORE UPDATE OR DELETE ON public.trader_research_experiments_v1 FOR EACH ROW
  EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER research_experiment_no_truncate
  BEFORE TRUNCATE ON public.trader_research_experiments_v1 FOR EACH STATEMENT
  EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_research_experiments_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_research_experiments_v1 FROM PUBLIC, authenticated, anon;
--> statement-breakpoint
CREATE POLICY research_experiment_deny_browser ON public.trader_research_experiments_v1
  AS RESTRICTIVE FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
