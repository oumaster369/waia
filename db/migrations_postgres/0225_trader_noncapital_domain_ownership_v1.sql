-- DEE-1136: fixed noncapital exclusion only. Full225 predecessor required.
-- DEE-1147: a pre-0225 receipt may store a runtime_instance_id or lease_epoch that
-- differs from the lease history row of the same digest. That was legal: the
-- old foreign key was digest-only, and the fence checked the mutable head.
-- Keep both rows byte-for-byte. Record the pair in the closed divergence
-- ledger. Bind the receipt to that historical lease by organization and digest.
-- Do not copy either holder onto the other. Later inserts must match the
-- ownership-ref tuple exactly.
-- DEE-1151: apply this file only with writers of the locked tables stopped.
-- Do not apply it during a live session or while those writers are running.
-- A timeout failure means stop the writers and retry the whole file; it is not
-- permission to apply concurrently. No original receipt or body is rewritten.
-- Each statement chunk sets transaction-local lock_timeout (5s) and
-- statement_timeout (120s), the SET LOCAL form via set_config(..., true), so a
-- lock wait fails fast instead of blocking writers. The closing chunk restores
-- both to 0 so a later migration in the same transaction is not left on this budget.
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
LOCK TABLE trader_recorded_analysis_companions_v1,
  trader_recorded_analysis_packets_v1,
  trader_recorded_analysis_sessions_v1,
  trader_research_application_assignments_v1,
  trader_research_application_availability_v1,
  trader_research_application_consumptions_v1,
  trader_research_applications_v1,
  trader_research_understanding_assignments_v1,
  trader_research_understanding_completions_v1,
  trader_runtime_control_lease_epoch_history_v2,
  trader_runtime_noncapital_cycles_v2 IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_runtime_control_lease_epoch_history_v2 ADD CONSTRAINT noncapital_legacy_parent_tuple UNIQUE (organization_id,runtime_instance_id,lease_epoch,content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TABLE trader_recorded_acquisition_lease_history_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  runtime_instance_id text NOT NULL CHECK (runtime_instance_id=btrim(runtime_instance_id) AND length(runtime_instance_id)>0 AND octet_length(runtime_instance_id)<=1024),
  lease_epoch integer NOT NULL CHECK (lease_epoch>0),
  content_digest text PRIMARY KEY CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  prior_content_digest text CHECK (prior_content_digest IS NULL OR prior_content_digest ~ '^[0-9a-f]{64}$'),
  adjudicated_at_utc timestamptz NOT NULL CHECK (isfinite(adjudicated_at_utc) AND date_trunc('milliseconds',adjudicated_at_utc)=adjudicated_at_utc),
  valid_until_utc timestamptz NOT NULL CHECK (isfinite(valid_until_utc) AND date_trunc('milliseconds',valid_until_utc)=valid_until_utc),
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 1 AND 2147483647),
  body_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT noncapital_acq_epoch UNIQUE (organization_id,lease_epoch),
  CONSTRAINT noncapital_acq_tuple UNIQUE (organization_id,runtime_instance_id,lease_epoch,content_digest),
  CONSTRAINT noncapital_acq_head_parent UNIQUE (organization_id,runtime_instance_id,lease_epoch,content_digest,valid_until_utc),
  CONSTRAINT noncapital_acq_org_digest UNIQUE (organization_id,content_digest),
  CONSTRAINT noncapital_acq_prior FOREIGN KEY (organization_id,prior_content_digest) REFERENCES trader_recorded_acquisition_lease_history_v1(organization_id,content_digest),
  CHECK ((lease_epoch=1) = (prior_content_digest IS NULL)),
  CHECK (valid_until_utc=adjudicated_at_utc+duration_ms*interval '1 millisecond'),
  CONSTRAINT noncapital_acq_body CHECK ((
    octet_length(body_json)<=4096 AND jsonb_typeof(body_json::jsonb)='object'
    AND body_json::jsonb - ARRAY['schemaVersion','ownershipDomain','organizationId','runtimeInstanceId','leaseEpoch','expectedPreviousDigest','adjudicatedAtUtc','validUntilUtc','durationMs'] = '{}'::jsonb
    AND body_json::jsonb->'schemaVersion' = to_jsonb('waia.trader.noncapital_domain_lease.v1'::text)
    AND body_json::jsonb->'ownershipDomain' = to_jsonb('RECORDED_ACQUISITION_V1'::text)
    AND body_json::jsonb->'organizationId' = to_jsonb(organization_id::text)
    AND body_json::jsonb->'runtimeInstanceId' = to_jsonb(runtime_instance_id)
    AND body_json::jsonb->'leaseEpoch' = to_jsonb(lease_epoch)
    AND body_json::jsonb->'expectedPreviousDigest' = coalesce(to_jsonb(prior_content_digest),'null'::jsonb)
    AND body_json::jsonb->'adjudicatedAtUtc' = to_jsonb(to_char(adjudicated_at_utc at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    AND body_json::jsonb->'validUntilUtc' = to_jsonb(to_char(valid_until_utc at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    AND body_json::jsonb->'durationMs' = to_jsonb(duration_ms)
    AND content_digest=encode(sha256(convert_to(body_json,'UTF8')),'hex')
  ) IS TRUE)
);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TABLE trader_recorded_acquisition_lease_heads_v1 (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  runtime_instance_id text NOT NULL,
  lease_epoch integer NOT NULL CHECK (lease_epoch>0),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  valid_until_utc timestamptz NOT NULL CHECK (isfinite(valid_until_utc) AND date_trunc('milliseconds',valid_until_utc)=valid_until_utc),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT noncapital_acq_head_history FOREIGN KEY (organization_id,runtime_instance_id,lease_epoch,content_digest,valid_until_utc)
    REFERENCES trader_recorded_acquisition_lease_history_v1(organization_id,runtime_instance_id,lease_epoch,content_digest,valid_until_utc)
);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TABLE trader_saved_research_lease_history_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  runtime_instance_id text NOT NULL CHECK (runtime_instance_id=btrim(runtime_instance_id) AND length(runtime_instance_id)>0 AND octet_length(runtime_instance_id)<=1024),
  lease_epoch integer NOT NULL CHECK (lease_epoch>0),
  content_digest text PRIMARY KEY CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  prior_content_digest text CHECK (prior_content_digest IS NULL OR prior_content_digest ~ '^[0-9a-f]{64}$'),
  adjudicated_at_utc timestamptz NOT NULL CHECK (isfinite(adjudicated_at_utc) AND date_trunc('milliseconds',adjudicated_at_utc)=adjudicated_at_utc),
  valid_until_utc timestamptz NOT NULL CHECK (isfinite(valid_until_utc) AND date_trunc('milliseconds',valid_until_utc)=valid_until_utc),
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 1 AND 120000),
  body_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT noncapital_saved_epoch UNIQUE (organization_id,lease_epoch),
  CONSTRAINT noncapital_saved_tuple UNIQUE (organization_id,runtime_instance_id,lease_epoch,content_digest),
  CONSTRAINT noncapital_saved_head_parent UNIQUE (organization_id,runtime_instance_id,lease_epoch,content_digest,valid_until_utc),
  CONSTRAINT noncapital_saved_org_digest UNIQUE (organization_id,content_digest),
  CONSTRAINT noncapital_saved_prior FOREIGN KEY (organization_id,prior_content_digest) REFERENCES trader_saved_research_lease_history_v1(organization_id,content_digest),
  CHECK ((lease_epoch=1) = (prior_content_digest IS NULL)),
  CHECK (valid_until_utc=adjudicated_at_utc+duration_ms*interval '1 millisecond'),
  CONSTRAINT noncapital_saved_body CHECK ((
    octet_length(body_json)<=4096 AND jsonb_typeof(body_json::jsonb)='object'
    AND body_json::jsonb - ARRAY['schemaVersion','ownershipDomain','organizationId','runtimeInstanceId','leaseEpoch','expectedPreviousDigest','adjudicatedAtUtc','validUntilUtc','durationMs'] = '{}'::jsonb
    AND body_json::jsonb->'schemaVersion' = to_jsonb('waia.trader.noncapital_domain_lease.v1'::text)
    AND body_json::jsonb->'ownershipDomain' = to_jsonb('SAVED_RESEARCH_V1'::text)
    AND body_json::jsonb->'organizationId' = to_jsonb(organization_id::text)
    AND body_json::jsonb->'runtimeInstanceId' = to_jsonb(runtime_instance_id)
    AND body_json::jsonb->'leaseEpoch' = to_jsonb(lease_epoch)
    AND body_json::jsonb->'expectedPreviousDigest' = coalesce(to_jsonb(prior_content_digest),'null'::jsonb)
    AND body_json::jsonb->'adjudicatedAtUtc' = to_jsonb(to_char(adjudicated_at_utc at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    AND body_json::jsonb->'validUntilUtc' = to_jsonb(to_char(valid_until_utc at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    AND body_json::jsonb->'durationMs' = to_jsonb(duration_ms)
    AND content_digest=encode(sha256(convert_to(body_json,'UTF8')),'hex')
  ) IS TRUE)
);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TABLE trader_saved_research_lease_heads_v1 (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  runtime_instance_id text NOT NULL,
  lease_epoch integer NOT NULL CHECK (lease_epoch>0),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  valid_until_utc timestamptz NOT NULL CHECK (isfinite(valid_until_utc) AND date_trunc('milliseconds',valid_until_utc)=valid_until_utc),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT noncapital_saved_head_history FOREIGN KEY (organization_id,runtime_instance_id,lease_epoch,content_digest,valid_until_utc)
    REFERENCES trader_saved_research_lease_history_v1(organization_id,runtime_instance_id,lease_epoch,content_digest,valid_until_utc)
);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TABLE trader_runtime_ownership_refs_v1 (
  ownership_domain text NOT NULL CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','RECORDED_ACQUISITION_V1','SAVED_RESEARCH_V1')),
  organization_id uuid NOT NULL REFERENCES organizations(id), runtime_instance_id text NOT NULL,
  lease_epoch integer NOT NULL CHECK (lease_epoch>0),
  lease_content_digest text NOT NULL CHECK (lease_content_digest ~ '^[0-9a-f]{64}$'),
  capital_parent_digest text CHECK (capital_parent_digest IS NULL OR capital_parent_digest ~ '^[0-9a-f]{64}$'),
  acquisition_parent_digest text CHECK (acquisition_parent_digest IS NULL OR acquisition_parent_digest ~ '^[0-9a-f]{64}$'),
  research_parent_digest text CHECK (research_parent_digest IS NULL OR research_parent_digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (ownership_domain,organization_id,lease_content_digest),
  CONSTRAINT noncapital_ownership_tuple UNIQUE (ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest),
  CONSTRAINT noncapital_ownership_exact_parent CHECK ((
    (ownership_domain='CAPITAL_LEGACY_V2' AND capital_parent_digest=lease_content_digest AND capital_parent_digest IS NOT NULL AND acquisition_parent_digest IS NULL AND research_parent_digest IS NULL)
    OR (ownership_domain='RECORDED_ACQUISITION_V1' AND acquisition_parent_digest=lease_content_digest AND acquisition_parent_digest IS NOT NULL AND capital_parent_digest IS NULL AND research_parent_digest IS NULL)
    OR (ownership_domain='SAVED_RESEARCH_V1' AND research_parent_digest=lease_content_digest AND research_parent_digest IS NOT NULL AND capital_parent_digest IS NULL AND acquisition_parent_digest IS NULL)
  ) IS TRUE),
  CONSTRAINT noncapital_ref_capital_parent FOREIGN KEY (organization_id,runtime_instance_id,lease_epoch,capital_parent_digest)
    REFERENCES trader_runtime_control_lease_epoch_history_v2(organization_id,runtime_instance_id,lease_epoch,content_digest),
  CONSTRAINT noncapital_ref_acquisition_parent FOREIGN KEY (organization_id,runtime_instance_id,lease_epoch,acquisition_parent_digest)
    REFERENCES trader_recorded_acquisition_lease_history_v1(organization_id,runtime_instance_id,lease_epoch,content_digest),
  CONSTRAINT noncapital_ref_research_parent FOREIGN KEY (organization_id,runtime_instance_id,lease_epoch,research_parent_digest)
    REFERENCES trader_saved_research_lease_history_v1(organization_id,runtime_instance_id,lease_epoch,content_digest)
);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_ref_capital_idx ON trader_runtime_ownership_refs_v1 (organization_id,runtime_instance_id,lease_epoch,capital_parent_digest) WHERE capital_parent_digest IS NOT NULL;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_ref_acquisition_idx ON trader_runtime_ownership_refs_v1 (organization_id,runtime_instance_id,lease_epoch,acquisition_parent_digest) WHERE acquisition_parent_digest IS NOT NULL;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_ref_research_idx ON trader_runtime_ownership_refs_v1 (organization_id,runtime_instance_id,lease_epoch,research_parent_digest) WHERE research_parent_digest IS NOT NULL;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE FUNCTION public.trader_noncapital_ownership_reference_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME='trader_runtime_control_lease_epoch_history_v2' THEN
    INSERT INTO public.trader_runtime_ownership_refs_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest,capital_parent_digest)
    VALUES ('CAPITAL_LEGACY_V2',NEW.organization_id,NEW.runtime_instance_id,NEW.lease_epoch,NEW.content_digest,NEW.content_digest);
  ELSIF TG_TABLE_NAME='trader_recorded_acquisition_lease_history_v1' THEN
    INSERT INTO public.trader_runtime_ownership_refs_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest,acquisition_parent_digest)
    VALUES ('RECORDED_ACQUISITION_V1',NEW.organization_id,NEW.runtime_instance_id,NEW.lease_epoch,NEW.content_digest,NEW.content_digest);
  ELSIF TG_TABLE_NAME='trader_saved_research_lease_history_v1' THEN
    INSERT INTO public.trader_runtime_ownership_refs_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest,research_parent_digest)
    VALUES ('SAVED_RESEARCH_V1',NEW.organization_id,NEW.runtime_instance_id,NEW.lease_epoch,NEW.content_digest,NEW.content_digest);
  ELSE RAISE EXCEPTION 'NONCAPITAL_REFERENCE_TABLE_REFUSED'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
INSERT INTO trader_runtime_ownership_refs_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest,capital_parent_digest)
SELECT 'CAPITAL_LEGACY_V2',organization_id,runtime_instance_id,lease_epoch,content_digest,content_digest
FROM trader_runtime_control_lease_epoch_history_v2;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER noncapital_fixed_reference AFTER INSERT ON trader_runtime_control_lease_epoch_history_v2 FOR EACH ROW EXECUTE FUNCTION public.trader_noncapital_ownership_reference_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER noncapital_fixed_reference AFTER INSERT ON trader_recorded_acquisition_lease_history_v1 FOR EACH ROW EXECUTE FUNCTION public.trader_noncapital_ownership_reference_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER noncapital_fixed_reference AFTER INSERT ON trader_saved_research_lease_history_v1 FOR EACH ROW EXECUTE FUNCTION public.trader_noncapital_ownership_reference_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE FUNCTION public.noncapital_acq_history_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE prior public.trader_recorded_acquisition_lease_heads_v1%ROWTYPE; has_prior boolean; observed timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(1121001,hashtext(NEW.organization_id::text));
  SELECT * INTO prior FROM public.trader_recorded_acquisition_lease_heads_v1 WHERE organization_id=NEW.organization_id FOR UPDATE;
  has_prior := FOUND; observed := clock_timestamp();
  IF NEW.adjudicated_at_utc > observed OR observed > NEW.valid_until_utc
    OR (has_prior AND (observed <= prior.valid_until_utc OR NEW.adjudicated_at_utc <= prior.valid_until_utc
      OR NEW.lease_epoch::bigint <> prior.lease_epoch::bigint+1 OR NEW.prior_content_digest IS DISTINCT FROM prior.content_digest))
    OR (NOT has_prior AND (NEW.lease_epoch<>1 OR NEW.prior_content_digest IS NOT NULL))
  THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_CLAIM_REFUSED'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE FUNCTION public.noncapital_acq_head_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE lease public.trader_recorded_acquisition_lease_history_v1%ROWTYPE; observed timestamptz;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_HEAD_DELETE_REFUSED'; END IF;
  PERFORM pg_advisory_xact_lock(1121001,hashtext(NEW.organization_id::text));
  SELECT * INTO lease FROM public.trader_recorded_acquisition_lease_history_v1 WHERE organization_id=NEW.organization_id AND content_digest=NEW.content_digest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_HISTORY_REQUIRED'; END IF;
  observed := clock_timestamp();
  IF lease.runtime_instance_id IS DISTINCT FROM NEW.runtime_instance_id OR lease.lease_epoch IS DISTINCT FROM NEW.lease_epoch
    OR lease.valid_until_utc IS DISTINCT FROM NEW.valid_until_utc OR observed > lease.valid_until_utc OR lease.adjudicated_at_utc > observed
  THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_HEAD_REFUSED'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.lease_epoch<>1 OR lease.prior_content_digest IS NOT NULL THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_FIRST_HEAD_REFUSED'; END IF;
  ELSE
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR observed <= OLD.valid_until_utc
      OR lease.adjudicated_at_utc <= OLD.valid_until_utc OR NEW.lease_epoch::bigint <> OLD.lease_epoch::bigint+1
      OR lease.prior_content_digest IS DISTINCT FROM OLD.content_digest
    THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_SUCCESSOR_REFUSED'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE FUNCTION public.noncapital_acq_commit_fence_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE current_head public.trader_recorded_acquisition_lease_heads_v1%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(1121001,hashtext(NEW.organization_id::text));
  SELECT * INTO current_head FROM public.trader_recorded_acquisition_lease_heads_v1 WHERE organization_id=NEW.organization_id FOR UPDATE;
  IF NOT FOUND OR current_head.runtime_instance_id IS DISTINCT FROM NEW.runtime_instance_id
    OR current_head.lease_epoch IS DISTINCT FROM NEW.lease_epoch OR current_head.content_digest IS DISTINCT FROM NEW.content_digest
    OR current_head.valid_until_utc IS DISTINCT FROM NEW.valid_until_utc OR clock_timestamp()>current_head.valid_until_utc
  THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_COMMIT_FENCE'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER noncapital_history_claim BEFORE INSERT ON trader_recorded_acquisition_lease_history_v1 FOR EACH ROW EXECUTE FUNCTION public.noncapital_acq_history_guard_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER noncapital_head_change BEFORE INSERT OR UPDATE OR DELETE ON trader_recorded_acquisition_lease_heads_v1 FOR EACH ROW EXECUTE FUNCTION public.noncapital_acq_head_guard_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE CONSTRAINT TRIGGER noncapital_lease_commit_fence AFTER INSERT OR UPDATE ON trader_recorded_acquisition_lease_history_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.noncapital_acq_commit_fence_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE CONSTRAINT TRIGGER noncapital_lease_commit_fence AFTER INSERT OR UPDATE ON trader_recorded_acquisition_lease_heads_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.noncapital_acq_commit_fence_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE FUNCTION public.noncapital_saved_history_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE prior public.trader_saved_research_lease_heads_v1%ROWTYPE; has_prior boolean; observed timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(1126001,hashtext(NEW.organization_id::text));
  SELECT * INTO prior FROM public.trader_saved_research_lease_heads_v1 WHERE organization_id=NEW.organization_id FOR UPDATE;
  has_prior := FOUND; observed := clock_timestamp();
  IF NEW.adjudicated_at_utc > observed OR observed > NEW.valid_until_utc
    OR (has_prior AND (observed <= prior.valid_until_utc OR NEW.adjudicated_at_utc <= prior.valid_until_utc
      OR NEW.lease_epoch::bigint <> prior.lease_epoch::bigint+1 OR NEW.prior_content_digest IS DISTINCT FROM prior.content_digest))
    OR (NOT has_prior AND (NEW.lease_epoch<>1 OR NEW.prior_content_digest IS NOT NULL))
  THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_CLAIM_REFUSED'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE FUNCTION public.noncapital_saved_head_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE lease public.trader_saved_research_lease_history_v1%ROWTYPE; observed timestamptz;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_HEAD_DELETE_REFUSED'; END IF;
  PERFORM pg_advisory_xact_lock(1126001,hashtext(NEW.organization_id::text));
  SELECT * INTO lease FROM public.trader_saved_research_lease_history_v1 WHERE organization_id=NEW.organization_id AND content_digest=NEW.content_digest;
  IF NOT FOUND THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_HISTORY_REQUIRED'; END IF;
  observed := clock_timestamp();
  IF lease.runtime_instance_id IS DISTINCT FROM NEW.runtime_instance_id OR lease.lease_epoch IS DISTINCT FROM NEW.lease_epoch
    OR lease.valid_until_utc IS DISTINCT FROM NEW.valid_until_utc OR observed > lease.valid_until_utc OR lease.adjudicated_at_utc > observed
  THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_HEAD_REFUSED'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.lease_epoch<>1 OR lease.prior_content_digest IS NOT NULL THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_FIRST_HEAD_REFUSED'; END IF;
  ELSE
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR observed <= OLD.valid_until_utc
      OR lease.adjudicated_at_utc <= OLD.valid_until_utc OR NEW.lease_epoch::bigint <> OLD.lease_epoch::bigint+1
      OR lease.prior_content_digest IS DISTINCT FROM OLD.content_digest
    THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_SUCCESSOR_REFUSED'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE FUNCTION public.noncapital_saved_commit_fence_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE current_head public.trader_saved_research_lease_heads_v1%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(1126001,hashtext(NEW.organization_id::text));
  SELECT * INTO current_head FROM public.trader_saved_research_lease_heads_v1 WHERE organization_id=NEW.organization_id FOR UPDATE;
  IF NOT FOUND OR current_head.runtime_instance_id IS DISTINCT FROM NEW.runtime_instance_id
    OR current_head.lease_epoch IS DISTINCT FROM NEW.lease_epoch OR current_head.content_digest IS DISTINCT FROM NEW.content_digest
    OR current_head.valid_until_utc IS DISTINCT FROM NEW.valid_until_utc OR clock_timestamp()>current_head.valid_until_utc
  THEN RAISE EXCEPTION 'NONCAPITAL_LEASE_COMMIT_FENCE'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER noncapital_history_claim BEFORE INSERT ON trader_saved_research_lease_history_v1 FOR EACH ROW EXECUTE FUNCTION public.noncapital_saved_history_guard_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER noncapital_head_change BEFORE INSERT OR UPDATE OR DELETE ON trader_saved_research_lease_heads_v1 FOR EACH ROW EXECUTE FUNCTION public.noncapital_saved_head_guard_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE CONSTRAINT TRIGGER noncapital_lease_commit_fence AFTER INSERT OR UPDATE ON trader_saved_research_lease_history_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.noncapital_saved_commit_fence_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE CONSTRAINT TRIGGER noncapital_lease_commit_fence AFTER INSERT OR UPDATE ON trader_saved_research_lease_heads_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.noncapital_saved_commit_fence_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER noncapital_append_only BEFORE UPDATE OR DELETE ON trader_recorded_acquisition_lease_history_v1 FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER noncapital_append_only BEFORE UPDATE OR DELETE ON trader_saved_research_lease_history_v1 FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER noncapital_append_only BEFORE UPDATE OR DELETE ON trader_runtime_ownership_refs_v1 FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_acquisition_lease_history_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE POLICY noncapital_browser_deny ON trader_recorded_acquisition_lease_history_v1 FOR ALL TO authenticated,anon USING(false) WITH CHECK(false);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
REVOKE ALL ON public.trader_recorded_acquisition_lease_history_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_acquisition_lease_heads_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE POLICY noncapital_browser_deny ON trader_recorded_acquisition_lease_heads_v1 FOR ALL TO authenticated,anon USING(false) WITH CHECK(false);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
REVOKE ALL ON public.trader_recorded_acquisition_lease_heads_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_saved_research_lease_history_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE POLICY noncapital_browser_deny ON trader_saved_research_lease_history_v1 FOR ALL TO authenticated,anon USING(false) WITH CHECK(false);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
REVOKE ALL ON public.trader_saved_research_lease_history_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_saved_research_lease_heads_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE POLICY noncapital_browser_deny ON trader_saved_research_lease_heads_v1 FOR ALL TO authenticated,anon USING(false) WITH CHECK(false);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
REVOKE ALL ON public.trader_saved_research_lease_heads_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_runtime_ownership_refs_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE POLICY noncapital_browser_deny ON trader_runtime_ownership_refs_v1 FOR ALL TO authenticated,anon USING(false) WITH CHECK(false);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
REVOKE ALL ON public.trader_runtime_ownership_refs_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TABLE trader_runtime_legacy_holder_divergence_v1 (
  divergence_id text PRIMARY KEY CHECK (divergence_id ~ '^[0-9a-f]{64}$'),
  receipt_table text NOT NULL CHECK (receipt_table IN ('trader_runtime_noncapital_cycles_v2','trader_recorded_analysis_sessions_v1','trader_recorded_analysis_packets_v1','trader_recorded_analysis_companions_v1','trader_research_understanding_assignments_v1','trader_research_understanding_completions_v1','trader_research_application_assignments_v1','trader_research_applications_v1','trader_research_application_availability_v1','trader_research_application_consumptions_v1')),
  receipt_key text NOT NULL CHECK (octet_length(receipt_key) BETWEEN 1 AND 2048),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  receipt_runtime_instance_id text NOT NULL CHECK (length(btrim(receipt_runtime_instance_id))>0),
  receipt_lease_epoch integer NOT NULL CHECK (receipt_lease_epoch>0),
  lease_content_digest text NOT NULL CHECK (lease_content_digest ~ '^[0-9a-f]{64}$'),
  lease_runtime_instance_id text NOT NULL CHECK (length(btrim(lease_runtime_instance_id))>0),
  lease_epoch integer NOT NULL CHECK (lease_epoch>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_holder_divergence_distinct CHECK ((receipt_runtime_instance_id IS DISTINCT FROM lease_runtime_instance_id OR receipt_lease_epoch IS DISTINCT FROM lease_epoch) IS TRUE),
  CONSTRAINT legacy_holder_divergence_lease FOREIGN KEY (organization_id,lease_runtime_instance_id,lease_epoch,lease_content_digest)
    REFERENCES trader_runtime_control_lease_epoch_history_v2(organization_id,runtime_instance_id,lease_epoch,content_digest),
  CONSTRAINT legacy_holder_divergence_receipt UNIQUE (receipt_table,organization_id,receipt_key)
);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
DO $dee1147$
DECLARE spec record; remaining int;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('trader_runtime_noncapital_cycles_v2', $k$c.account_id || E'\n' || c.symbol || E'\n' || c.bar_interval || E'\n' || to_char(c.pit_anchor AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')$k$),
    ('trader_recorded_analysis_sessions_v1', $k$c.session_id$k$),
    ('trader_recorded_analysis_packets_v1', $k$c.session_id || E'\n' || c.sequence::text$k$),
    ('trader_recorded_analysis_companions_v1', $k$c.session_id || E'\n' || c.sequence::text$k$),
    ('trader_research_understanding_assignments_v1', $k$c.session_id$k$),
    ('trader_research_understanding_completions_v1', $k$c.session_id || E'\n' || c.sequence::text$k$),
    ('trader_research_application_assignments_v1', $k$c.assignment_digest$k$),
    ('trader_research_applications_v1', $k$c.application_id$k$),
    ('trader_research_application_availability_v1', $k$c.application_id$k$),
    ('trader_research_application_consumptions_v1', $k$c.assignment_digest || E'\n' || c.sequence::text$k$)
  ) AS t(rel, key_expr) LOOP
    EXECUTE format($q$SELECT count(*) FROM %1$I c JOIN trader_runtime_control_lease_epoch_history_v2 h ON h.content_digest=c.lease_content_digest WHERE c.organization_id IS DISTINCT FROM h.organization_id$q$, spec.rel) INTO remaining;
    IF remaining <> 0 THEN RAISE EXCEPTION 'LEGACY_CROSS_ORG_LEASE_REFUSED:%', spec.rel; END IF;
    EXECUTE format($q$INSERT INTO trader_runtime_legacy_holder_divergence_v1(divergence_id,receipt_table,receipt_key,organization_id,receipt_runtime_instance_id,receipt_lease_epoch,lease_content_digest,lease_runtime_instance_id,lease_epoch)
      SELECT encode(sha256(convert_to(%1$L || E'\n' || c.organization_id::text || E'\n' || (%2$s) || E'\n' || c.runtime_instance_id || E'\n' || c.lease_epoch::text || E'\n' || c.lease_content_digest || E'\n' || h.runtime_instance_id || E'\n' || h.lease_epoch::text,'UTF8')),'hex'),
        %1$L, %2$s, c.organization_id, c.runtime_instance_id, c.lease_epoch, c.lease_content_digest, h.runtime_instance_id, h.lease_epoch
      FROM %1$I c JOIN trader_runtime_control_lease_epoch_history_v2 h ON h.content_digest=c.lease_content_digest
      WHERE c.organization_id=h.organization_id AND (c.runtime_instance_id IS DISTINCT FROM h.runtime_instance_id OR c.lease_epoch IS DISTINCT FROM h.lease_epoch)$q$, spec.rel, spec.key_expr);
    EXECUTE format($q$SELECT count(*) FROM %1$I c JOIN trader_runtime_control_lease_epoch_history_v2 h ON h.content_digest=c.lease_content_digest
      WHERE c.organization_id=h.organization_id AND (c.runtime_instance_id IS DISTINCT FROM h.runtime_instance_id OR c.lease_epoch IS DISTINCT FROM h.lease_epoch)
        AND NOT EXISTS (SELECT 1 FROM trader_runtime_legacy_holder_divergence_v1 d WHERE d.receipt_table=%1$L AND d.organization_id=c.organization_id
          AND d.receipt_key=(%2$s) AND d.receipt_runtime_instance_id=c.runtime_instance_id AND d.receipt_lease_epoch=c.lease_epoch
          AND d.lease_content_digest=c.lease_content_digest AND d.lease_runtime_instance_id=h.runtime_instance_id AND d.lease_epoch=h.lease_epoch)$q$, spec.rel, spec.key_expr) INTO remaining;
    IF remaining <> 0 THEN RAISE EXCEPTION 'LEGACY_HOLDER_DIVERGENCE_INCOMPLETE:%', spec.rel; END IF;
  END LOOP;
  SELECT count(*) INTO remaining FROM trader_runtime_ownership_refs_v1 r
    JOIN trader_runtime_control_lease_epoch_history_v2 h ON h.content_digest=r.lease_content_digest
    WHERE r.ownership_domain='CAPITAL_LEGACY_V2' AND (r.organization_id IS DISTINCT FROM h.organization_id
      OR r.runtime_instance_id IS DISTINCT FROM h.runtime_instance_id OR r.lease_epoch IS DISTINCT FROM h.lease_epoch
      OR r.capital_parent_digest IS DISTINCT FROM h.content_digest);
  IF remaining <> 0 THEN RAISE EXCEPTION 'NONCAPITAL_HOLDER_SUBSTITUTION_REFUSED'; END IF;
END $dee1147$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE FUNCTION public.trader_legacy_holder_divergence_closed_v1() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'LEGACY_HOLDER_DIVERGENCE_CLOSED'; END $$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER legacy_holder_divergence_closed BEFORE INSERT ON trader_runtime_legacy_holder_divergence_v1 FOR EACH ROW EXECUTE FUNCTION public.trader_legacy_holder_divergence_closed_v1();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE TRIGGER legacy_holder_divergence_append_only BEFORE UPDATE OR DELETE ON trader_runtime_legacy_holder_divergence_v1 FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_runtime_legacy_holder_divergence_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE POLICY legacy_holder_divergence_browser_deny ON trader_runtime_legacy_holder_divergence_v1 FOR ALL TO authenticated,anon USING(false) WITH CHECK(false);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
REVOKE ALL ON public.trader_runtime_legacy_holder_divergence_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_runtime_noncapital_cycles_v2 ADD COLUMN ownership_domain text NOT NULL DEFAULT 'CAPITAL_LEGACY_V2', ADD CONSTRAINT noncapital_receipt_domain_0 CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','RECORDED_ACQUISITION_V1'));
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_runtime_noncapital_cycles_v2 ADD CONSTRAINT noncapital_receipt_holder_0 FOREIGN KEY (ownership_domain,organization_id,lease_content_digest) REFERENCES trader_runtime_ownership_refs_v1(ownership_domain,organization_id,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_receipt_holder_0_idx ON trader_runtime_noncapital_cycles_v2(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_sessions_v1 ADD COLUMN ownership_domain text NOT NULL DEFAULT 'CAPITAL_LEGACY_V2', ADD CONSTRAINT noncapital_receipt_domain_1 CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','RECORDED_ACQUISITION_V1'));
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_sessions_v1 ADD CONSTRAINT noncapital_receipt_holder_1 FOREIGN KEY (ownership_domain,organization_id,lease_content_digest) REFERENCES trader_runtime_ownership_refs_v1(ownership_domain,organization_id,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_receipt_holder_1_idx ON trader_recorded_analysis_sessions_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_packets_v1 ADD COLUMN ownership_domain text NOT NULL DEFAULT 'CAPITAL_LEGACY_V2', ADD CONSTRAINT noncapital_receipt_domain_2 CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','RECORDED_ACQUISITION_V1'));
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_packets_v1 ADD CONSTRAINT noncapital_receipt_holder_2 FOREIGN KEY (ownership_domain,organization_id,lease_content_digest) REFERENCES trader_runtime_ownership_refs_v1(ownership_domain,organization_id,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_receipt_holder_2_idx ON trader_recorded_analysis_packets_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_companions_v1 ADD COLUMN ownership_domain text NOT NULL DEFAULT 'CAPITAL_LEGACY_V2', ADD CONSTRAINT noncapital_receipt_domain_3 CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','RECORDED_ACQUISITION_V1'));
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_companions_v1 ADD CONSTRAINT noncapital_receipt_holder_3 FOREIGN KEY (ownership_domain,organization_id,lease_content_digest) REFERENCES trader_runtime_ownership_refs_v1(ownership_domain,organization_id,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_receipt_holder_3_idx ON trader_recorded_analysis_companions_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_understanding_assignments_v1 ADD COLUMN ownership_domain text NOT NULL DEFAULT 'CAPITAL_LEGACY_V2', ADD CONSTRAINT noncapital_receipt_domain_4 CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','SAVED_RESEARCH_V1'));
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_understanding_assignments_v1 ADD CONSTRAINT noncapital_receipt_holder_4 FOREIGN KEY (ownership_domain,organization_id,lease_content_digest) REFERENCES trader_runtime_ownership_refs_v1(ownership_domain,organization_id,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_receipt_holder_4_idx ON trader_research_understanding_assignments_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_understanding_completions_v1 ADD COLUMN ownership_domain text NOT NULL DEFAULT 'CAPITAL_LEGACY_V2', ADD CONSTRAINT noncapital_receipt_domain_5 CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','SAVED_RESEARCH_V1'));
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_understanding_completions_v1 ADD CONSTRAINT noncapital_receipt_holder_5 FOREIGN KEY (ownership_domain,organization_id,lease_content_digest) REFERENCES trader_runtime_ownership_refs_v1(ownership_domain,organization_id,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_receipt_holder_5_idx ON trader_research_understanding_completions_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_assignments_v1 ADD COLUMN ownership_domain text NOT NULL DEFAULT 'CAPITAL_LEGACY_V2', ADD CONSTRAINT noncapital_receipt_domain_6 CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','SAVED_RESEARCH_V1'));
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_assignments_v1 ADD CONSTRAINT noncapital_receipt_holder_6 FOREIGN KEY (ownership_domain,organization_id,lease_content_digest) REFERENCES trader_runtime_ownership_refs_v1(ownership_domain,organization_id,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_receipt_holder_6_idx ON trader_research_application_assignments_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_applications_v1 ADD COLUMN ownership_domain text NOT NULL DEFAULT 'CAPITAL_LEGACY_V2', ADD CONSTRAINT noncapital_receipt_domain_7 CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','SAVED_RESEARCH_V1'));
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_applications_v1 ADD CONSTRAINT noncapital_receipt_holder_7 FOREIGN KEY (ownership_domain,organization_id,lease_content_digest) REFERENCES trader_runtime_ownership_refs_v1(ownership_domain,organization_id,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_receipt_holder_7_idx ON trader_research_applications_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_availability_v1 ADD COLUMN ownership_domain text NOT NULL DEFAULT 'CAPITAL_LEGACY_V2', ADD CONSTRAINT noncapital_receipt_domain_8 CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','SAVED_RESEARCH_V1'));
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_availability_v1 ADD CONSTRAINT noncapital_receipt_holder_8 FOREIGN KEY (ownership_domain,organization_id,lease_content_digest) REFERENCES trader_runtime_ownership_refs_v1(ownership_domain,organization_id,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_receipt_holder_8_idx ON trader_research_application_availability_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_consumptions_v1 ADD COLUMN ownership_domain text NOT NULL DEFAULT 'CAPITAL_LEGACY_V2', ADD CONSTRAINT noncapital_receipt_domain_9 CHECK (ownership_domain IN ('CAPITAL_LEGACY_V2','SAVED_RESEARCH_V1'));
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_consumptions_v1 ADD CONSTRAINT noncapital_receipt_holder_9 FOREIGN KEY (ownership_domain,organization_id,lease_content_digest) REFERENCES trader_runtime_ownership_refs_v1(ownership_domain,organization_id,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_receipt_holder_9_idx ON trader_research_application_consumptions_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_sessions_v1 ADD CONSTRAINT noncapital_affinity_parent_0 UNIQUE (organization_id,session_id,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_packets_v1 ADD CONSTRAINT noncapital_affinity_0 FOREIGN KEY (organization_id,session_id,config_digest,ownership_domain) REFERENCES trader_recorded_analysis_sessions_v1(organization_id,session_id,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_affinity_0_idx ON trader_recorded_analysis_packets_v1(organization_id,session_id,config_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_packets_v1 ADD CONSTRAINT noncapital_affinity_parent_1 UNIQUE (organization_id,session_id,sequence,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_companions_v1 ADD CONSTRAINT noncapital_affinity_1 FOREIGN KEY (organization_id,session_id,sequence,packet_digest,ownership_domain) REFERENCES trader_recorded_analysis_packets_v1(organization_id,session_id,sequence,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_affinity_1_idx ON trader_recorded_analysis_companions_v1(organization_id,session_id,sequence,packet_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_runtime_noncapital_cycles_v2 ADD CONSTRAINT noncapital_affinity_parent_2 UNIQUE (organization_id,account_id,symbol,bar_interval,pit_anchor,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_recorded_analysis_companions_v1 ADD CONSTRAINT noncapital_affinity_2 FOREIGN KEY (organization_id,account_id,symbol,bar_interval,scheduled_bar_close_time,ownership_domain) REFERENCES trader_runtime_noncapital_cycles_v2(organization_id,account_id,symbol,bar_interval,pit_anchor,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_affinity_2_idx ON trader_recorded_analysis_companions_v1(organization_id,account_id,symbol,bar_interval,scheduled_bar_close_time,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_understanding_assignments_v1 ADD CONSTRAINT noncapital_affinity_parent_3 UNIQUE (organization_id,session_id,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_understanding_completions_v1 ADD CONSTRAINT noncapital_affinity_3 FOREIGN KEY (organization_id,session_id,assignment_digest,ownership_domain) REFERENCES trader_research_understanding_assignments_v1(organization_id,session_id,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_affinity_3_idx ON trader_research_understanding_completions_v1(organization_id,session_id,assignment_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_assignments_v1 ADD CONSTRAINT noncapital_affinity_parent_4 UNIQUE (organization_id,assignment_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_applications_v1 ADD CONSTRAINT noncapital_affinity_4 FOREIGN KEY (organization_id,assignment_digest,ownership_domain) REFERENCES trader_research_application_assignments_v1(organization_id,assignment_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_affinity_4_idx ON trader_research_applications_v1(organization_id,assignment_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_applications_v1 ADD CONSTRAINT noncapital_affinity_parent_5 UNIQUE (organization_id,application_id,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_availability_v1 ADD CONSTRAINT noncapital_affinity_5 FOREIGN KEY (organization_id,application_id,application_digest,ownership_domain) REFERENCES trader_research_applications_v1(organization_id,application_id,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_affinity_5_idx ON trader_research_application_availability_v1(organization_id,application_id,application_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_consumptions_v1 ADD CONSTRAINT noncapital_affinity_6 FOREIGN KEY (organization_id,application_id,application_digest,ownership_domain) REFERENCES trader_research_applications_v1(organization_id,application_id,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_affinity_6_idx ON trader_research_application_consumptions_v1(organization_id,application_id,application_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_availability_v1 ADD CONSTRAINT noncapital_affinity_parent_7 UNIQUE (organization_id,application_id,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_consumptions_v1 ADD CONSTRAINT noncapital_affinity_7 FOREIGN KEY (organization_id,application_id,availability_digest,ownership_domain) REFERENCES trader_research_application_availability_v1(organization_id,application_id,content_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE INDEX noncapital_affinity_7_idx ON trader_research_application_consumptions_v1(organization_id,application_id,availability_digest,ownership_domain);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_assignments_v1 ADD CONSTRAINT noncapital_command_profile_0 CHECK (
  ownership_domain <> 'SAVED_RESEARCH_V1' OR (
    jsonb_typeof(body_json::jsonb->'commandManifestDigest')='string'
    AND (body_json::jsonb->>'commandManifestDigest') ~ '^[0-9a-f]{64}$'
    AND (body_json::jsonb->>'commandManifestDigest') <> '5070c0aa8e42824892dd2915c5d70b21cac4e9a22aec5947a7255d62a3d8faf2'
  ) IS TRUE);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_applications_v1 ADD CONSTRAINT noncapital_command_profile_1 CHECK (
  ownership_domain <> 'SAVED_RESEARCH_V1' OR (
    jsonb_typeof(body_json::jsonb->'commandManifestDigest')='string'
    AND (body_json::jsonb->>'commandManifestDigest') ~ '^[0-9a-f]{64}$'
    AND (body_json::jsonb->>'commandManifestDigest') <> '5070c0aa8e42824892dd2915c5d70b21cac4e9a22aec5947a7255d62a3d8faf2'
  ) IS TRUE);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_availability_v1 ADD CONSTRAINT noncapital_command_profile_2 CHECK (
  ownership_domain <> 'SAVED_RESEARCH_V1' OR (
    jsonb_typeof(body_json::jsonb->'commandManifestDigest')='string'
    AND (body_json::jsonb->>'commandManifestDigest') ~ '^[0-9a-f]{64}$'
    AND (body_json::jsonb->>'commandManifestDigest') <> '5070c0aa8e42824892dd2915c5d70b21cac4e9a22aec5947a7255d62a3d8faf2'
  ) IS TRUE);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
ALTER TABLE trader_research_application_consumptions_v1 ADD CONSTRAINT noncapital_command_profile_3 CHECK (
  ownership_domain <> 'SAVED_RESEARCH_V1' OR (
    jsonb_typeof(body_json::jsonb->'commandManifestDigest')='string'
    AND (body_json::jsonb->>'commandManifestDigest') ~ '^[0-9a-f]{64}$'
    AND (body_json::jsonb->>'commandManifestDigest') <> '5070c0aa8e42824892dd2915c5d70b21cac4e9a22aec5947a7255d62a3d8faf2'
  ) IS TRUE);
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
DO $$
DECLARE target text; matched text[];
BEGIN
  FOREACH target IN ARRAY ARRAY['trader_runtime_noncapital_cycles_v2','trader_recorded_analysis_sessions_v1','trader_recorded_analysis_packets_v1','trader_recorded_analysis_companions_v1','trader_research_understanding_assignments_v1','trader_research_understanding_completions_v1','trader_research_application_assignments_v1','trader_research_applications_v1','trader_research_application_availability_v1','trader_research_application_consumptions_v1'] LOOP
    SELECT array_agg(c.conname ORDER BY c.conname) INTO matched FROM pg_constraint c
      WHERE c.conrelid=target::regclass AND c.contype='f'
      AND c.confrelid='trader_runtime_control_lease_epoch_history_v2'::regclass
      AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=target::regclass AND attname='lease_content_digest')]::smallint[]
      AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='content_digest')]::smallint[];
    IF cardinality(matched) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'NONCAPITAL_OLD_FK_IDENTITY_REFUSED:%',target; END IF;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',target,matched[1]);
  END LOOP;
END $$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE OR REPLACE FUNCTION public.trader_runtime_noncapital_cycles_v2_fence() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE owner record;
BEGIN
  IF NEW.ownership_domain='CAPITAL_LEGACY_V2' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text,637));
    SELECT * INTO owner FROM public.trader_runtime_control_lease_heads_v2 WHERE organization_id=NEW.organization_id FOR UPDATE;
  ELSIF NEW.ownership_domain='RECORDED_ACQUISITION_V1' AND TG_TABLE_NAME IN ('trader_runtime_noncapital_cycles_v2') THEN
    PERFORM pg_advisory_xact_lock(1121001,hashtext(NEW.organization_id::text));
    SELECT * INTO owner FROM public.trader_recorded_acquisition_lease_heads_v1 WHERE organization_id=NEW.organization_id FOR UPDATE;
  ELSE RAISE EXCEPTION 'NONCAPITAL_RECEIPT_DOMAIN_REFUSED'; END IF;
  IF NOT FOUND OR owner.runtime_instance_id <> NEW.runtime_instance_id OR owner.lease_epoch <> NEW.lease_epoch
    OR owner.content_digest <> NEW.lease_content_digest OR clock_timestamp()>owner.valid_until_utc
  THEN RAISE EXCEPTION 'RUNTIME_CONTROL_LEASE_STALE_HOLDER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trader_runtime_ownership_refs_v1 r WHERE r.ownership_domain=NEW.ownership_domain
    AND r.organization_id=NEW.organization_id AND r.runtime_instance_id=NEW.runtime_instance_id
    AND r.lease_epoch=NEW.lease_epoch AND r.lease_content_digest=NEW.lease_content_digest)
  THEN RAISE EXCEPTION 'NONCAPITAL_RECEIPT_HOLDER_REFUSED'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
SELECT set_config('lock_timeout', '5s', true), set_config('statement_timeout', '120s', true);
CREATE OR REPLACE FUNCTION public.trader_recorded_analysis_v1_fence() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE owner record;
BEGIN
  IF NEW.ownership_domain='CAPITAL_LEGACY_V2' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text,637));
    SELECT * INTO owner FROM public.trader_runtime_control_lease_heads_v2 WHERE organization_id=NEW.organization_id FOR UPDATE;
  ELSIF NEW.ownership_domain='RECORDED_ACQUISITION_V1' AND TG_TABLE_NAME IN ('trader_recorded_analysis_sessions_v1','trader_recorded_analysis_packets_v1','trader_recorded_analysis_companions_v1') THEN
    PERFORM pg_advisory_xact_lock(1121001,hashtext(NEW.organization_id::text));
    SELECT * INTO owner FROM public.trader_recorded_acquisition_lease_heads_v1 WHERE organization_id=NEW.organization_id FOR UPDATE;
  ELSIF NEW.ownership_domain='SAVED_RESEARCH_V1' AND TG_TABLE_NAME IN ('trader_research_understanding_assignments_v1','trader_research_understanding_completions_v1','trader_research_application_assignments_v1','trader_research_applications_v1','trader_research_application_availability_v1','trader_research_application_consumptions_v1') THEN
    PERFORM pg_advisory_xact_lock(1126001,hashtext(NEW.organization_id::text));
    SELECT * INTO owner FROM public.trader_saved_research_lease_heads_v1 WHERE organization_id=NEW.organization_id FOR UPDATE;
  ELSE RAISE EXCEPTION 'NONCAPITAL_RECEIPT_DOMAIN_REFUSED'; END IF;
  IF NOT FOUND OR owner.runtime_instance_id <> NEW.runtime_instance_id OR owner.lease_epoch <> NEW.lease_epoch
    OR owner.content_digest <> NEW.lease_content_digest OR clock_timestamp()>owner.valid_until_utc
  THEN RAISE EXCEPTION 'RUNTIME_CONTROL_LEASE_STALE_HOLDER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trader_runtime_ownership_refs_v1 r WHERE r.ownership_domain=NEW.ownership_domain
    AND r.organization_id=NEW.organization_id AND r.runtime_instance_id=NEW.runtime_instance_id
    AND r.lease_epoch=NEW.lease_epoch AND r.lease_content_digest=NEW.lease_content_digest)
  THEN RAISE EXCEPTION 'NONCAPITAL_RECEIPT_HOLDER_REFUSED'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

SELECT set_config('lock_timeout', '0', true), set_config('statement_timeout', '0', true);
