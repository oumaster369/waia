-- DEE-958: diagnostics only, never qualification, run-start or Human authority.
CREATE TABLE public.trader_historical_preparation_event_v2 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  run_id text NOT NULL,
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  request_id uuid NOT NULL,
  request_content_digest_hex text NOT NULL,
  attempt_id uuid NOT NULL,
  event_sequence integer NOT NULL CHECK (event_sequence >= 0),
  phase text NOT NULL CHECK (phase IN ('STARTED','PROGRESS','FAILED','PROPOSAL_AVAILABLE')),
  progress_phase text CHECK (progress_phase IN ('SCIENTIFIC_PREPARATION','SURFACE_LOAD',
    'FORECAST_ANCHORS','VALIDATION_RESAMPLES','TECHNICAL_CANDIDATE_COMPLETE','PROPOSAL_PERSISTED')),
  surface_key text CHECK (surface_key IN ('BTCUSDT:30','BTCUSDT:60','ETHUSDT:30','ETHUSDT:60')),
  trial_identity_digest_hex text CHECK (trial_identity_digest_hex ~ '^[0-9a-f]{64}$'),
  completed bigint CHECK (completed >= 0),
  total bigint CHECK (total > 0),
  error_code text CHECK (error_code IN ('CANCELLED','CONNECTION_LOST',
    'SCIENTIFIC_PREPARATION_REFUSED','PREPARATION_FAILED')),
  proposal_id uuid REFERENCES public.trader_historical_technical_proposal_v2(id),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (attempt_id,event_sequence),
  FOREIGN KEY (request_id,organization_id,run_id,request_content_digest_hex)
    REFERENCES public.trader_historical_ratification_request_v2
      (id,organization_id,run_id,content_digest_hex),
  CHECK ((phase='STARTED') = (event_sequence=0)),
  CHECK ((phase='FAILED') = (error_code IS NOT NULL)),
  CHECK ((phase='PROPOSAL_AVAILABLE') = (proposal_id IS NOT NULL)),
  CHECK ((phase='PROGRESS') = (progress_phase IS NOT NULL)),
  CHECK (phase='PROGRESS' OR (surface_key IS NULL AND trial_identity_digest_hex IS NULL)),
  CHECK ((completed IS NULL AND total IS NULL) OR
    (phase='PROGRESS' AND completed IS NOT NULL AND total IS NOT NULL AND completed<=total))
);
CREATE INDEX historical_preparation_event_request_order_v2
  ON public.trader_historical_preparation_event_v2 (organization_id,run_id,release_sha,id DESC);
--> statement-breakpoint
CREATE FUNCTION public.waia_historical_preparation_event_guard_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.trader_historical_preparation_event_v2;
DECLARE latest_attempt uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('historical-preparation-events:'||NEW.request_id::text,0));
  IF NOT EXISTS (SELECT 1 FROM public.trader_historical_ratification_request_v2 request
    WHERE request.id=NEW.request_id AND request.organization_id=NEW.organization_id
      AND request.run_id=NEW.run_id AND request.release_sha=NEW.release_sha
      AND request.content_digest_hex=NEW.request_content_digest_hex) THEN
    RAISE EXCEPTION 'HISTORICAL_PREPARATION_EVENT_REQUEST_BINDING' USING ERRCODE='check_violation';
  END IF;
  SELECT * INTO prior FROM public.trader_historical_preparation_event_v2
    WHERE attempt_id=NEW.attempt_id ORDER BY event_sequence DESC LIMIT 1;
  IF NEW.phase='STARTED' THEN
    IF prior.id IS NOT NULL THEN
      RAISE EXCEPTION 'HISTORICAL_PREPARATION_ATTEMPT_EXISTS' USING ERRCODE='check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.trader_historical_preparation_event_v2
      WHERE request_id=NEW.request_id AND id>=NEW.id) THEN
      RAISE EXCEPTION 'HISTORICAL_PREPARATION_START_ORDER' USING ERRCODE='check_violation';
    END IF;
  ELSE
    SELECT attempt_id INTO latest_attempt FROM public.trader_historical_preparation_event_v2
      WHERE organization_id=NEW.organization_id AND run_id=NEW.run_id
        AND release_sha=NEW.release_sha AND phase='STARTED' ORDER BY id DESC LIMIT 1;
    IF prior.id IS NULL OR prior.request_id<>NEW.request_id OR prior.release_sha<>NEW.release_sha
      OR prior.organization_id<>NEW.organization_id OR prior.run_id<>NEW.run_id
      OR prior.request_content_digest_hex<>NEW.request_content_digest_hex
      OR prior.phase IN ('FAILED','PROPOSAL_AVAILABLE')
      OR prior.event_sequence+1<>NEW.event_sequence
      OR latest_attempt IS DISTINCT FROM NEW.attempt_id THEN
      RAISE EXCEPTION 'HISTORICAL_PREPARATION_EVENT_SEQUENCE' USING ERRCODE='check_violation';
    END IF;
  END IF;
  IF NEW.phase='PROPOSAL_AVAILABLE' AND NOT EXISTS (
    SELECT 1 FROM public.trader_historical_technical_proposal_v2 proposal
      WHERE proposal.id=NEW.proposal_id AND proposal.request_id=NEW.request_id
        AND proposal.organization_id=NEW.organization_id AND proposal.run_id=NEW.run_id
        AND proposal.release_sha=NEW.release_sha
        AND proposal.request_content_digest_hex=NEW.request_content_digest_hex
  ) THEN RAISE EXCEPTION 'HISTORICAL_PREPARATION_EVENT_PROPOSAL_BINDING'
    USING ERRCODE='check_violation'; END IF;
  NEW.observed_at=clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.waia_historical_preparation_event_guard_v2() FROM PUBLIC;
CREATE TRIGGER historical_preparation_event_validate_v2 BEFORE INSERT
  ON public.trader_historical_preparation_event_v2 FOR EACH ROW
  EXECUTE FUNCTION public.waia_historical_preparation_event_guard_v2();
CREATE TRIGGER historical_preparation_event_immutable_v2 BEFORE UPDATE OR DELETE
  ON public.trader_historical_preparation_event_v2 FOR EACH ROW
  EXECUTE FUNCTION public.waia_historical_ratification_split_v2_block_mutation();
CREATE TRIGGER historical_preparation_event_no_truncate_v2 BEFORE TRUNCATE
  ON public.trader_historical_preparation_event_v2 FOR EACH STATEMENT
  EXECUTE FUNCTION public.waia_historical_ratification_split_v2_block_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_historical_preparation_event_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_historical_preparation_event_v2 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.trader_historical_preparation_event_v2 FROM PUBLIC,anon,authenticated,waia_historical_runner;
GRANT SELECT ON public.trader_historical_preparation_event_v2 TO waia_historical_runner;
GRANT INSERT (organization_id,run_id,release_sha,request_id,request_content_digest_hex,
  attempt_id,event_sequence,phase,progress_phase,surface_key,trial_identity_digest_hex,
  completed,total,error_code,proposal_id)
  ON public.trader_historical_preparation_event_v2 TO waia_historical_runner;
-- Existing trusted application owner-service reads only; HTTP auth/org scope
-- remains mandatory. This does not grant tenant or runner cross-org access.
CREATE POLICY historical_preparation_event_owner_read_v2
  ON public.trader_historical_preparation_event_v2 FOR SELECT
  USING (current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid='public.trader_historical_preparation_event_v2'::regclass));
CREATE POLICY historical_preparation_event_deny_browser_v2
  ON public.trader_historical_preparation_event_v2 FOR ALL TO anon,authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY historical_preparation_event_runner_read_v2
  ON public.trader_historical_preparation_event_v2 FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY historical_preparation_event_runner_insert_v2
  ON public.trader_historical_preparation_event_v2 FOR INSERT TO waia_historical_runner
  WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
