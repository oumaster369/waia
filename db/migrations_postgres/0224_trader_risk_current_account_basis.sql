-- DEE-1135: additive current-account basis, explicit governed profile and retained source lineage.
-- Existing migrations and existing Reality/Risk seals remain unchanged. No migration execution is implied.
--> statement-breakpoint
CREATE TABLE public.trader_risk_account_profiles_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK(octet_length(body_text)<=131072
    AND jsonb_typeof(body_text::jsonb)='object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'risk-account-source-profile/v1'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND NOT(body_text::jsonb ? 'contentDigest')
    AND content_digest=encode(sha256(convert_to(body_text,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  actor_id uuid NOT NULL REFERENCES users(id), audit_id uuid NOT NULL REFERENCES audit_logs(id),
  PRIMARY KEY(organization_id,account_id,content_digest)
);
--> statement-breakpoint
CREATE TABLE public.trader_risk_account_profile_events_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK(octet_length(body_text)<=32768
    AND jsonb_typeof(body_text::jsonb)='object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'risk-account-profile-event/v1'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND NOT(body_text::jsonb ? 'contentDigest')
    AND content_digest=encode(sha256(convert_to(body_text,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  command_id uuid NOT NULL, profile_digest text NOT NULL, event_sequence bigint NOT NULL CHECK(event_sequence>0), previous_event_digest text, action text NOT NULL CHECK(action IN ('PROPOSE','CONFIRM','ACTIVATE','CANCEL','REVOKE')), actor_id uuid NOT NULL REFERENCES users(id), audit_id uuid NOT NULL REFERENCES audit_logs(id),
  PRIMARY KEY(organization_id,account_id,content_digest),
  UNIQUE(organization_id,account_id,command_id),
  UNIQUE(organization_id,account_id,event_sequence),
  FOREIGN KEY(organization_id,account_id,profile_digest) REFERENCES trader_risk_account_profiles_v1(organization_id,account_id,content_digest),
  CHECK(body_text::jsonb->>'profileDigest' IS NOT DISTINCT FROM profile_digest AND body_text::jsonb->>'action' IS NOT DISTINCT FROM action AND body_text::jsonb->>'actorId' IS NOT DISTINCT FROM actor_id::text AND (body_text::jsonb->>'eventSequence')::bigint IS NOT DISTINCT FROM event_sequence AND body_text::jsonb->>'previousEventDigest' IS NOT DISTINCT FROM previous_event_digest)
);
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_validation_receipt_v1
  ADD CONSTRAINT tmrvr_v1_id_organization_uq UNIQUE (id, organization_id);
--> statement-breakpoint
CREATE TABLE public.trader_risk_account_reference_members_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK(octet_length(body_text)<=16384
    AND jsonb_typeof(body_text::jsonb)='object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'risk-reference-member/v1'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND NOT(body_text::jsonb ? 'contentDigest')
    AND content_digest=encode(sha256(convert_to(body_text,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  profile_digest text NOT NULL, window_id text NOT NULL, slot integer NOT NULL CHECK(slot>=0 AND slot<512), instrument_digest text NOT NULL, source_id uuid NOT NULL, capture_digest text NOT NULL, validation_digest text NOT NULL, observation_id text NOT NULL, gateway_digest text NOT NULL,
  PRIMARY KEY(organization_id,account_id,content_digest),
  UNIQUE(organization_id,account_id,profile_digest,window_id,instrument_digest,slot),
  FOREIGN KEY(organization_id,account_id,profile_digest) REFERENCES trader_risk_account_profiles_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(capture_digest,organization_id,source_id) REFERENCES trader_mi_raw_capture_receipt_v1(id,organization_id,source_id),
  FOREIGN KEY(validation_digest, organization_id) REFERENCES public.trader_mi_raw_validation_receipt_v1(id, organization_id),
  CHECK(body_text::jsonb->>'profileDigest' IS NOT DISTINCT FROM profile_digest AND body_text::jsonb->>'windowId' IS NOT DISTINCT FROM window_id AND (body_text::jsonb->>'slot')::integer IS NOT DISTINCT FROM slot AND body_text::jsonb->>'instrumentIdentityDigestHex' IS NOT DISTINCT FROM instrument_digest AND body_text::jsonb->>'sourceId' IS NOT DISTINCT FROM source_id::text AND body_text::jsonb->>'captureReceiptDigest' IS NOT DISTINCT FROM capture_digest AND body_text::jsonb->>'validationReceiptDigest' IS NOT DISTINCT FROM validation_digest AND body_text::jsonb->>'observationId' IS NOT DISTINCT FROM observation_id AND body_text::jsonb->>'gatewayReceiptDigest' IS NOT DISTINCT FROM gateway_digest)
);
--> statement-breakpoint
CREATE TABLE public.trader_risk_account_references_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK(octet_length(body_text)<=1048576
    AND jsonb_typeof(body_text::jsonb)='object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'risk-account-reference/v1'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND NOT(body_text::jsonb ? 'contentDigest')
    AND content_digest=encode(sha256(convert_to(body_text,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  profile_digest text NOT NULL, window_id text NOT NULL,
  PRIMARY KEY(organization_id,account_id,content_digest),
  UNIQUE(organization_id,account_id,profile_digest,window_id),
  FOREIGN KEY(organization_id,account_id,profile_digest) REFERENCES trader_risk_account_profiles_v1(organization_id,account_id,content_digest),
  CHECK(body_text::jsonb->>'profileDigest' IS NOT DISTINCT FROM profile_digest AND body_text::jsonb->>'windowId' IS NOT DISTINCT FROM window_id)
);
--> statement-breakpoint
CREATE TABLE public.trader_risk_account_acquisition_jobs_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK(octet_length(body_text)<=4194304
    AND jsonb_typeof(body_text::jsonb)='object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'risk-account-acquisition-job/v1'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND NOT(body_text::jsonb ? 'contentDigest')
    AND content_digest=encode(sha256(convert_to(body_text,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  id uuid NOT NULL, profile_digest text NOT NULL, reference_digest text NOT NULL,
  PRIMARY KEY(organization_id,account_id,content_digest),
  UNIQUE(organization_id,account_id,id),
  FOREIGN KEY(organization_id,account_id,profile_digest) REFERENCES trader_risk_account_profiles_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(organization_id,account_id,reference_digest) REFERENCES trader_risk_account_references_v1(organization_id,account_id,content_digest),
  CHECK(body_text::jsonb->>'id' IS NOT DISTINCT FROM id::text AND body_text::jsonb->>'profileDigest' IS NOT DISTINCT FROM profile_digest AND body_text::jsonb->>'referenceDigest' IS NOT DISTINCT FROM reference_digest)
);
--> statement-breakpoint
CREATE TABLE public.trader_htx_account_acquisitions_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK(octet_length(body_text)<=4194304
    AND jsonb_typeof(body_text::jsonb)='object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'htx-account-acquisition/v1'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND NOT(body_text::jsonb ? 'contentDigest')
    AND content_digest=encode(sha256(convert_to(body_text,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  acquisition_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence>=0 AND sequence<=1025),
  previous_digest text, kind text NOT NULL CHECK(kind IN ('START','PREPARED','PAGE','TERMINAL')),
  replay_key text NOT NULL CHECK(length(replay_key) BETWEEN 1 AND 512),
  PRIMARY KEY(organization_id,account_id,content_digest),
  UNIQUE(organization_id,account_id,acquisition_id,sequence),
  UNIQUE(organization_id,account_id,acquisition_id,replay_key),
  FOREIGN KEY(organization_id,account_id,acquisition_id) REFERENCES trader_risk_account_acquisition_jobs_v1(organization_id,account_id,id),
  FOREIGN KEY(organization_id,account_id,previous_digest) REFERENCES trader_htx_account_acquisitions_v1(organization_id,account_id,content_digest),
  CHECK((sequence=0 AND previous_digest IS NULL) OR (sequence>0 AND previous_digest IS NOT NULL)),
  CHECK(body_text::jsonb->>'acquisitionId' IS NOT DISTINCT FROM acquisition_id::text
    AND (body_text::jsonb->>'sequence')::integer IS NOT DISTINCT FROM sequence
    AND body_text::jsonb->>'previousDigest' IS NOT DISTINCT FROM previous_digest
    AND body_text::jsonb->>'kind' IS NOT DISTINCT FROM kind
    AND body_text::jsonb->>'replayKey' IS NOT DISTINCT FROM replay_key)
);
--> statement-breakpoint
CREATE TABLE public.trader_risk_account_bases_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK(octet_length(body_text)<=4194304
    AND jsonb_typeof(body_text::jsonb)='object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'risk-account-basis/v1'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND NOT(body_text::jsonb ? 'contentDigest')
    AND content_digest=encode(sha256(convert_to(body_text,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  profile_digest text NOT NULL, reference_digest text NOT NULL, acquisition_digest text NOT NULL, reality_projection_id text NOT NULL, predecessor_basis_digest text,
  PRIMARY KEY(organization_id,account_id,content_digest),
  UNIQUE(organization_id,account_id,acquisition_digest),
  FOREIGN KEY(organization_id,account_id,profile_digest) REFERENCES trader_risk_account_profiles_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(organization_id,account_id,reference_digest) REFERENCES trader_risk_account_references_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(organization_id,account_id,acquisition_digest) REFERENCES trader_htx_account_acquisitions_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(reality_projection_id,organization_id,account_id) REFERENCES trader_reality_projections_v2(id,organization_id,account_id),
  FOREIGN KEY(organization_id,account_id,predecessor_basis_digest) REFERENCES trader_risk_account_bases_v1(organization_id,account_id,content_digest),
  CHECK(body_text::jsonb->>'profileDigest' IS NOT DISTINCT FROM profile_digest AND body_text::jsonb->>'referenceDigest' IS NOT DISTINCT FROM reference_digest AND body_text::jsonb->>'acquisitionDigest' IS NOT DISTINCT FROM acquisition_digest AND body_text::jsonb->'reality'->>'snapshotId' IS NOT DISTINCT FROM reality_projection_id AND body_text::jsonb->>'predecessorBasisDigest' IS NOT DISTINCT FROM predecessor_basis_digest)
);
--> statement-breakpoint
CREATE TABLE public.trader_risk_account_inclusions_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK(octet_length(body_text)<=16384
    AND jsonb_typeof(body_text::jsonb)='object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'risk-account-inclusion/v1'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND NOT(body_text::jsonb ? 'contentDigest')
    AND content_digest=encode(sha256(convert_to(body_text,'UTF8')),'hex')),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  basis_digest text NOT NULL, truth_record_id text NOT NULL, allowance_id uuid NOT NULL, order_id uuid NOT NULL,
  PRIMARY KEY(organization_id,account_id,content_digest),
  UNIQUE(organization_id,account_id,truth_record_id),
  UNIQUE(organization_id,account_id,allowance_id),
  FOREIGN KEY(organization_id,account_id,basis_digest) REFERENCES trader_risk_account_bases_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(truth_record_id,organization_id,account_id) REFERENCES trader_reality_truth_records_v2(id,organization_id,account_id),
  CHECK(body_text::jsonb->>'basisDigest' IS NOT DISTINCT FROM basis_digest AND body_text::jsonb->'fact'->>'truthRecordId' IS NOT DISTINCT FROM truth_record_id AND body_text::jsonb->'fact'->>'allowanceId' IS NOT DISTINCT FROM allowance_id::text AND body_text::jsonb->'fact'->>'orderId' IS NOT DISTINCT FROM order_id::text)
);
--> statement-breakpoint
CREATE TABLE public.trader_risk_account_current_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 256),
  revision bigint NOT NULL CHECK(revision>=0),
  active_profile_digest text, candidate_profile_digest text,
  candidate_state text CHECK(candidate_state IN ('PROPOSED','CONFIRMED')),
  candidate_effective_at timestamptz, reference_digest text, basis_digest text,
  event_sequence bigint NOT NULL CHECK(event_sequence>=0), event_head_digest text,
  active_acquisition_id uuid, updated_at timestamptz NOT NULL,
  PRIMARY KEY(organization_id,account_id),
  FOREIGN KEY(organization_id,account_id,active_profile_digest) REFERENCES trader_risk_account_profiles_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(organization_id,account_id,candidate_profile_digest) REFERENCES trader_risk_account_profiles_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(organization_id,account_id,reference_digest) REFERENCES trader_risk_account_references_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(organization_id,account_id,basis_digest) REFERENCES trader_risk_account_bases_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(organization_id,account_id,event_head_digest) REFERENCES trader_risk_account_profile_events_v1(organization_id,account_id,content_digest),
  FOREIGN KEY(organization_id,account_id,active_acquisition_id) REFERENCES trader_risk_account_acquisition_jobs_v1(organization_id,account_id,id),
  CHECK((candidate_profile_digest IS NULL)=(candidate_state IS NULL)),
  CHECK((candidate_state IS NOT DISTINCT FROM 'CONFIRMED')=(candidate_effective_at IS NOT NULL)),
  CHECK((event_sequence=0)=(event_head_digest IS NULL)),
  CHECK(active_profile_digest IS NOT NULL OR reference_digest IS NULL),
  CHECK(reference_digest IS NOT NULL OR basis_digest IS NULL)
);
--> statement-breakpoint
CREATE FUNCTION public.waia_risk_current_account_v1_block_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE='check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER risk_current_account_no_mutation BEFORE UPDATE OR DELETE ON public.trader_risk_account_profiles_v1
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER risk_current_account_no_mutation BEFORE UPDATE OR DELETE ON public.trader_risk_account_profile_events_v1
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER risk_current_account_no_mutation BEFORE UPDATE OR DELETE ON public.trader_risk_account_reference_members_v1
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER risk_current_account_no_mutation BEFORE UPDATE OR DELETE ON public.trader_risk_account_references_v1
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER risk_current_account_no_mutation BEFORE UPDATE OR DELETE ON public.trader_risk_account_acquisition_jobs_v1
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER risk_current_account_no_mutation BEFORE UPDATE OR DELETE ON public.trader_htx_account_acquisitions_v1
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER risk_current_account_no_mutation BEFORE UPDATE OR DELETE ON public.trader_risk_account_bases_v1
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER risk_current_account_no_mutation BEFORE UPDATE OR DELETE ON public.trader_risk_account_inclusions_v1
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_risk_account_profiles_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_risk_account_profiles_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY risk_current_account_server_only ON public.trader_risk_account_profiles_v1 FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
--> statement-breakpoint
ALTER TABLE public.trader_risk_account_profile_events_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_risk_account_profile_events_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY risk_current_account_server_only ON public.trader_risk_account_profile_events_v1 FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
--> statement-breakpoint
ALTER TABLE public.trader_risk_account_reference_members_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_risk_account_reference_members_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY risk_current_account_server_only ON public.trader_risk_account_reference_members_v1 FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
--> statement-breakpoint
ALTER TABLE public.trader_risk_account_references_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_risk_account_references_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY risk_current_account_server_only ON public.trader_risk_account_references_v1 FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
--> statement-breakpoint
ALTER TABLE public.trader_risk_account_acquisition_jobs_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_risk_account_acquisition_jobs_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY risk_current_account_server_only ON public.trader_risk_account_acquisition_jobs_v1 FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
--> statement-breakpoint
ALTER TABLE public.trader_htx_account_acquisitions_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_htx_account_acquisitions_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY risk_current_account_server_only ON public.trader_htx_account_acquisitions_v1 FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
--> statement-breakpoint
ALTER TABLE public.trader_risk_account_bases_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_risk_account_bases_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY risk_current_account_server_only ON public.trader_risk_account_bases_v1 FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
--> statement-breakpoint
ALTER TABLE public.trader_risk_account_inclusions_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_risk_account_inclusions_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY risk_current_account_server_only ON public.trader_risk_account_inclusions_v1 FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
--> statement-breakpoint
ALTER TABLE public.trader_risk_account_current_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_risk_account_current_v1 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY risk_current_account_server_only ON public.trader_risk_account_current_v1 FOR ALL TO anon, authenticated USING(false) WITH CHECK(false);
