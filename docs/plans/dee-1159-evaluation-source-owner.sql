-- DEE-1159 SYNTHETIC TEST DRAFT ONLY. Not in the production migration journal.
-- Apply only to the disposable local/integration schema after the DEE-1211
-- source-owner draft. Never apply to production or use to bypass deferred 0230.

CREATE TABLE public.trader_research_evaluation_source_runs_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  evaluation_source_id text NOT NULL
    CHECK (evaluation_source_id ~ '^research-evaluation-source-v1:[a-f0-9]{64}$'),
  command_id text NOT NULL CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  training_source_run_id text NOT NULL
    CHECK (training_source_run_id ~ '^research-source-v1:[a-f0-9]{64}$'),
  training_source_issuance_digest text NOT NULL CHECK (training_source_issuance_digest ~ '^[a-f0-9]{64}$'),
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  issuance_json jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, evaluation_source_id),
  UNIQUE (organization_id, command_id),
  UNIQUE (organization_id, evaluation_source_id, content_digest),
  FOREIGN KEY (organization_id, training_source_run_id, training_source_issuance_digest)
    REFERENCES public.trader_research_development_source_runs_v1
      (organization_id, source_run_id, content_digest),
  CHECK ((issuance_json->>'schemaVersion' = 'waia.research.development-evaluation-source-issuance.v1') IS TRUE),
  CHECK ((issuance_json->>'authority' = 'RESTRICTED_EVALUATION_SOURCE_WRITER_V1') IS TRUE),
  CHECK ((issuance_json->>'contentDigest' = content_digest) IS TRUE),
  CHECK ((issuance_json#>>'{metadata,request,organizationId}' = organization_id::text) IS TRUE),
  CHECK ((issuance_json#>>'{metadata,request,commandId}' = command_id) IS TRUE),
  CHECK ((issuance_json#>>'{metadata,request,trainingSourceRunId}' = training_source_run_id) IS TRUE),
  CHECK ((issuance_json#>>'{metadata,request,trainingSourceIssuanceDigest}' = training_source_issuance_digest) IS TRUE),
  CHECK ((issuance_json#>>'{metadata,evaluationSourceId}' = evaluation_source_id) IS TRUE),
  CHECK ((issuance_json->>'issuerRole' = 'waia_research_eval_source_writer') IS TRUE),
  CHECK ((issuance_json#>>'{metadata,authority}' = 'PREPARATION_METADATA_ONLY') IS TRUE),
  CHECK ((issuance_json#>>'{metadata,sourceAvailability}' = 'PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED') IS TRUE),
  CHECK ((issuance_json#>'{metadata,scientificQualified}' = 'false'::jsonb) IS TRUE),
  CHECK ((issuance_json#>'{metadata,capitalEligible}' = 'false'::jsonb) IS TRUE),
  CHECK (((issuance_json->>'issuedAt')::timestamptz = issued_at) IS TRUE)
);

CREATE TRIGGER research_evaluation_source_runs_no_mutation
BEFORE UPDATE OR DELETE OR TRUNCATE ON public.trader_research_evaluation_source_runs_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.trader_research_source_append_only_v1();

ALTER TABLE public.trader_research_evaluation_source_runs_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trader_research_evaluation_source_runs_v1 FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='waia_research_eval_source_writer') THEN
    CREATE ROLE waia_research_eval_source_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
      NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='waia_research_eval_source_writer_login') THEN
    -- No password is provisioned by this synthetic SQL. Integration tests use
    -- disposable local authentication; deployment provisioning is separate.
    CREATE ROLE waia_research_eval_source_writer_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
      NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
  END IF;
END $$;

GRANT waia_research_eval_source_writer TO waia_research_eval_source_writer_login;
GRANT USAGE ON SCHEMA public TO waia_research_eval_source_writer;
GRANT SELECT ON public.trader_research_development_source_runs_v1 TO waia_research_eval_source_writer;
GRANT SELECT,INSERT ON public.trader_research_evaluation_source_runs_v1,
  public.trader_historical_dataset_authority_v2 TO waia_research_eval_source_writer;

CREATE POLICY research_eval_source_training_read_v1
ON public.trader_research_development_source_runs_v1 FOR SELECT TO waia_research_eval_source_writer
USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);

CREATE POLICY research_eval_source_read_v1
ON public.trader_research_evaluation_source_runs_v1 FOR SELECT TO waia_research_eval_source_writer
USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);

CREATE POLICY research_eval_source_insert_v1
ON public.trader_research_evaluation_source_runs_v1 FOR INSERT TO waia_research_eval_source_writer
WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);

CREATE POLICY research_eval_source_dataset_read_v1
ON public.trader_historical_dataset_authority_v2 FOR SELECT TO waia_research_eval_source_writer
USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
  AND (run_id ~ '^research-source-v1:[a-f0-9]{64}$'
    OR run_id ~ '^research-evaluation-source-v1:[a-f0-9]{64}$'));

CREATE POLICY research_eval_source_dataset_insert_v1
ON public.trader_historical_dataset_authority_v2 FOR INSERT TO waia_research_eval_source_writer
WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
  AND dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
  AND membership_json->>'partition'='DEVELOPMENT'
  AND run_id ~ '^research-evaluation-source-v1:[a-f0-9]{64}$');
