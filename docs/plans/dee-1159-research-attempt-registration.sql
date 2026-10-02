-- DEE-1159 DRAFT; follows research-experiment-registration.sql in synthetic proof.
-- No canonical migration number or production apply is assigned here.
CREATE TABLE public.trader_research_attempts_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  spec_sha256 text NOT NULL,
  source_run_id text NOT NULL CHECK (source_run_id COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
  command_id text NOT NULL CHECK (command_id COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT research_attempt_org_command_uq UNIQUE (organization_id, command_id),
  CONSTRAINT research_attempt_org_id_uq UNIQUE (organization_id, id),
  CONSTRAINT research_attempt_experiment_fk FOREIGN KEY (organization_id, spec_sha256)
    REFERENCES public.trader_research_experiments_v1 (organization_id, spec_sha256) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TRIGGER research_attempt_registration_clock
  BEFORE INSERT ON public.trader_research_attempts_v1 FOR EACH ROW
  EXECUTE FUNCTION public.trader_research_experiment_registered_at_v1();
--> statement-breakpoint
CREATE TRIGGER research_attempt_append_only
  BEFORE UPDATE OR DELETE ON public.trader_research_attempts_v1 FOR EACH ROW
  EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER research_attempt_no_truncate
  BEFORE TRUNCATE ON public.trader_research_attempts_v1 FOR EACH STATEMENT
  EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_research_attempts_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_research_attempts_v1 FROM PUBLIC, authenticated, anon;
--> statement-breakpoint
CREATE POLICY research_attempt_deny_browser ON public.trader_research_attempts_v1
  AS RESTRICTIVE FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
