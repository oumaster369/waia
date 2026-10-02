-- DEE-1211 SYNTHETIC TEST DRAFT ONLY. Not in the production migration journal.
-- Never apply this draft to production, or use it to bypass 0229/0230 decisions.

CREATE TABLE public.trader_research_development_source_runs_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  source_run_id text NOT NULL CHECK (source_run_id ~ '^research-source-v1:[a-f0-9]{64}$'),
  command_id text NOT NULL CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  issuance_json jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, source_run_id),
  UNIQUE (organization_id, command_id),
  UNIQUE (organization_id, source_run_id, content_digest),
  CHECK ((issuance_json->>'schemaVersion' = 'waia.research.development-source-issuance.v1') IS TRUE),
  CHECK ((issuance_json->>'authority' = 'RESTRICTED_DEVELOPMENT_SOURCE_WRITER_V1') IS TRUE),
  CHECK ((issuance_json->>'sourceRunId' = source_run_id) IS TRUE),
  CHECK ((issuance_json->>'contentDigest' = content_digest) IS TRUE),
  CHECK ((issuance_json#>>'{request,organizationId}' = organization_id::text) IS TRUE),
  CHECK ((issuance_json#>>'{request,commandId}' = command_id) IS TRUE),
  CHECK ((issuance_json->>'issuerRole' = 'waia_research_source_writer') IS TRUE),
  CHECK ((issuance_json->>'sourceAvailability' = 'PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED') IS TRUE),
  CHECK ((issuance_json->'scientificallyQualified' = 'false'::jsonb) IS TRUE),
  CHECK ((issuance_json->'capitalEligible' = 'false'::jsonb) IS TRUE),
  CHECK (((issuance_json->>'issuedAt')::timestamptz = issued_at) IS TRUE)
);

CREATE TABLE public.trader_research_issued_attempts_v2 (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  schema_version text NOT NULL DEFAULT 'waia.research.issued-attempt.v2'
    CHECK (schema_version='waia.research.issued-attempt.v2'),
  spec_sha256 text NOT NULL,
  source_run_id text NOT NULL,
  source_issuance_digest text NOT NULL,
  command_id text NOT NULL CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,id),
  UNIQUE (organization_id,command_id),
  FOREIGN KEY (organization_id,spec_sha256)
    REFERENCES public.trader_research_experiments_v1(organization_id,spec_sha256),
  FOREIGN KEY (organization_id,source_run_id,source_issuance_digest)
    REFERENCES public.trader_research_development_source_runs_v1
      (organization_id,source_run_id,content_digest)
);

CREATE FUNCTION public.trader_research_source_append_only_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'RESEARCH_SOURCE_APPEND_ONLY';
END;
$$;
CREATE TRIGGER research_source_runs_no_mutation
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.trader_research_development_source_runs_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.trader_research_source_append_only_v1();
CREATE TRIGGER research_issued_attempts_no_mutation
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.trader_research_issued_attempts_v2
FOR EACH STATEMENT EXECUTE FUNCTION public.trader_research_source_append_only_v1();

ALTER TABLE public.trader_research_development_source_runs_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_research_issued_attempts_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trader_research_development_source_runs_v1,
  public.trader_research_issued_attempts_v2 FROM PUBLIC,anon,authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='waia_research_source_writer') THEN
    CREATE ROLE waia_research_source_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
      NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='waia_research_source_writer_login') THEN
    -- Password provisioning is deliberately absent. Tests use disposable local
    -- authentication; a future operator deployment needs its own approved setup.
    CREATE ROLE waia_research_source_writer_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
      NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
  END IF;
END $$;
GRANT waia_research_source_writer TO waia_research_source_writer_login;
GRANT USAGE ON SCHEMA public TO waia_research_source_writer;
GRANT SELECT,INSERT ON public.trader_research_development_source_runs_v1,
  public.trader_historical_dataset_authority_v2 TO waia_research_source_writer;

CREATE POLICY research_source_writer_read_v1
ON public.trader_research_development_source_runs_v1 FOR SELECT TO waia_research_source_writer
USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY research_source_writer_insert_v1
ON public.trader_research_development_source_runs_v1 FOR INSERT TO waia_research_source_writer
WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY research_source_writer_dataset_read_v1
ON public.trader_historical_dataset_authority_v2 FOR SELECT TO waia_research_source_writer
USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
  AND dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
  AND membership_json->>'partition'='DEVELOPMENT'
  AND run_id ~ '^research-source-v1:[a-f0-9]{64}$');
CREATE POLICY research_source_writer_dataset_insert_v1
ON public.trader_historical_dataset_authority_v2 FOR INSERT TO waia_research_source_writer
WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
  AND dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
  AND membership_json->>'partition'='DEVELOPMENT'
  AND run_id ~ '^research-source-v1:[a-f0-9]{64}$');
