-- DEE-904: least-privilege knowledge-state reads for the dedicated Historical V2 runner.
-- The runner remains NOLOGIN-managed externally, non-superuser, and without BYPASSRLS.
-- This migration grants SELECT only and pins access to the single authorized organization.

ALTER TABLE public.trader_mi_hypothesis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waia_historical_runner_org_select ON public.trader_mi_hypothesis;
CREATE POLICY waia_historical_runner_org_select
  ON public.trader_mi_hypothesis
  FOR SELECT
  TO PUBLIC
  USING (
    current_user = 'waia_historical_runner'
    AND organization_id = '3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
  );
--> statement-breakpoint

ALTER TABLE public.trader_mi_hypothesis_lifecycle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waia_historical_runner_org_select ON public.trader_mi_hypothesis_lifecycle;
CREATE POLICY waia_historical_runner_org_select
  ON public.trader_mi_hypothesis_lifecycle
  FOR SELECT
  TO PUBLIC
  USING (
    current_user = 'waia_historical_runner'
    AND organization_id = '3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
  );
--> statement-breakpoint

ALTER TABLE public.trader_mi_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waia_historical_runner_org_select ON public.trader_mi_evidence;
CREATE POLICY waia_historical_runner_org_select
  ON public.trader_mi_evidence
  FOR SELECT
  TO PUBLIC
  USING (
    current_user = 'waia_historical_runner'
    AND organization_id = '3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
  );
--> statement-breakpoint

ALTER TABLE public.trader_knowledge_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waia_historical_runner_org_select ON public.trader_knowledge_edges;
CREATE POLICY waia_historical_runner_org_select
  ON public.trader_knowledge_edges
  FOR SELECT
  TO PUBLIC
  USING (
    current_user = 'waia_historical_runner'
    AND organization_id = '3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
  );
--> statement-breakpoint

DO $do$
DECLARE
  runner record;
BEGIN
  SELECT rolsuper, rolbypassrls INTO runner
  FROM pg_roles WHERE rolname = 'waia_historical_runner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'waia_historical_runner role must be provisioned before migration 0193';
  END IF;
  IF runner.rolsuper OR runner.rolbypassrls OR EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles member ON member.oid = membership.member
    WHERE member.rolname = 'waia_historical_runner'
  ) THEN
    RAISE EXCEPTION 'waia_historical_runner must be unprivileged and inherit no roles';
  END IF;

  REVOKE ALL PRIVILEGES ON TABLE
    public.trader_mi_hypothesis,
    public.trader_mi_hypothesis_lifecycle,
    public.trader_mi_evidence,
    public.trader_knowledge_edges
  FROM waia_historical_runner;
  GRANT SELECT ON TABLE
    public.trader_mi_hypothesis,
    public.trader_mi_hypothesis_lifecycle,
    public.trader_mi_evidence,
    public.trader_knowledge_edges
  TO waia_historical_runner;
END
$do$;
