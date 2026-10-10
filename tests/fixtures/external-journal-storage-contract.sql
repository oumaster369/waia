-- DEE-1232 WP-DURABLE-STORAGE. UNNUMBERED LOCAL TEST CONTRACT ONLY.
-- NOT a deployment migration. No migration journal/schema registration or runtime wiring.
-- Prerequisites: organizations, exchange_credentials and the actual 0205 database-owned
-- observation_revision trigger. Apply only to a separately owned throwaway test database.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_external_journal_importer') THEN
    CREATE ROLE waia_external_journal_importer NOLOGIN NOINHERIT NOSUPERUSER
      NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_external_journal_importer'
    AND (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
    OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
      WHERE r.rolname = 'waia_external_journal_importer') THEN
    RAISE EXCEPTION 'UNSAFE_EXTERNAL_JOURNAL_ROLE';
  END IF;
  -- Existing direct grants (including secret columns) or PUBLIC inheritance are
  -- not silently blessed by adding narrow grants beside them.
  IF has_table_privilege('waia_external_journal_importer', 'public.exchange_credentials',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    has_any_column_privilege('waia_external_journal_importer', 'public.exchange_credentials',
      'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'UNSAFE_EXISTING_EXTERNAL_JOURNAL_CREDENTIAL_GRANTS';
  END IF;
END $$;

CREATE TABLE public.trader_external_journal_sources (
  source_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  credential_id uuid NOT NULL REFERENCES public.exchange_credentials(id),
  exchange_account_id text NOT NULL CHECK (length(exchange_account_id) BETWEEN 1 AND 128),
  credential_revision bigint NOT NULL CHECK (credential_revision > 0),
  binding_revision bigint NOT NULL DEFAULT 1 CHECK (binding_revision > 0),
  external_uid text NOT NULL CHECK (length(external_uid) BETWEEN 1 AND 128),
  market text NOT NULL CHECK (market IN ('spot', 'futures', 'unknown')),
  api_mode text NOT NULL CHECK (length(api_mode) BETWEEN 1 AND 128),
  writer_discriminator text NOT NULL CHECK (length(writer_discriminator) BETWEEN 1 AND 128),
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  assigned_login text NOT NULL CHECK (length(assigned_login) BETWEEN 1 AND 63),
  binding_state text NOT NULL DEFAULT 'UNVERIFIED' CHECK (binding_state IN ('UNVERIFIED', 'VERIFIED', 'SUSPENDED')),
  verification_receipt text CHECK (verification_receipt ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz,
  verification_expires_at timestamptz,
  UNIQUE (source_id, organization_id, credential_id, exchange_account_id),
  CHECK (binding_state <> 'VERIFIED' OR (verification_receipt IS NOT NULL AND
    verified_at IS NOT NULL AND verification_expires_at IS NOT NULL AND
    isfinite(verified_at) AND isfinite(verification_expires_at) AND verification_expires_at > verified_at))
);

CREATE TABLE public.trader_external_journal_generations (
  source_id uuid NOT NULL,
  generation_id text NOT NULL CHECK (length(generation_id) BETWEEN 1 AND 128),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  credential_id uuid NOT NULL,
  exchange_account_id text NOT NULL,
  source_binding_revision bigint NOT NULL CHECK (source_binding_revision > 0),
  generation_fingerprint text NOT NULL CHECK (generation_fingerprint ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'CLOSED', 'SUSPENDED')),
  cursor_version bigint NOT NULL DEFAULT 0 CHECK (cursor_version BETWEEN 0 AND 9007199254740991),
  next_offset bigint NOT NULL DEFAULT 0 CHECK (next_offset BETWEEN 0 AND 9007199254740991),
  pending_offset bigint NOT NULL DEFAULT 0 CHECK (pending_offset BETWEEN 0 AND 9007199254740991),
  pending_bytes bytea NOT NULL DEFAULT ''::bytea CHECK (octet_length(pending_bytes) <= 32768),
  discard_line_offset bigint CHECK (discard_line_offset BETWEEN 0 AND 9007199254740991),
  discard_bytes_seen bigint CHECK (discard_bytes_seen BETWEEN 1 AND 9007199254740991),
  lease_token uuid,
  lease_owner text CHECK (length(lease_owner) BETWEEN 1 AND 128),
  lease_claimed_at timestamptz,
  lease_expires_at timestamptz,
  last_commit_token uuid,
  last_commit_digest text CHECK (last_commit_digest ~ '^[0-9a-f]{64}$'),
  last_commit_from_version bigint,
  last_commit_to_version bigint,
  last_commit_from_offset bigint,
  last_commit_to_offset bigint,
  suspension_reason text CHECK (suspension_reason IN ('SOURCE_CHANGED', 'SOURCE_TRUNCATED', 'INTEGRITY_CONFLICT')),
  PRIMARY KEY (source_id, generation_id),
  UNIQUE (source_id, generation_id, organization_id, credential_id, exchange_account_id),
  FOREIGN KEY (source_id, organization_id, credential_id, exchange_account_id)
    REFERENCES public.trader_external_journal_sources (source_id, organization_id, credential_id, exchange_account_id),
  CHECK (pending_offset + octet_length(pending_bytes) = next_offset),
  CHECK ((discard_line_offset IS NULL AND discard_bytes_seen IS NULL) OR
    (discard_line_offset IS NOT NULL AND discard_bytes_seen IS NOT NULL AND
      octet_length(pending_bytes) = 0 AND discard_line_offset + discard_bytes_seen = next_offset)),
  CHECK ((lease_token IS NULL AND lease_owner IS NULL AND lease_claimed_at IS NULL AND lease_expires_at IS NULL) OR
    (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL
      AND isfinite(lease_claimed_at) AND isfinite(lease_expires_at)
      AND lease_expires_at > lease_claimed_at AND lease_expires_at <= lease_claimed_at + interval '60 seconds')),
  CHECK (((last_commit_token IS NULL AND last_commit_digest IS NULL AND last_commit_from_version IS NULL
    AND last_commit_to_version IS NULL AND last_commit_from_offset IS NULL AND last_commit_to_offset IS NULL) OR
    (last_commit_token IS NOT NULL AND last_commit_digest IS NOT NULL AND last_commit_from_version >= 0
      AND last_commit_to_version = last_commit_from_version + 1 AND last_commit_to_version = cursor_version
      AND last_commit_from_offset >= 0 AND last_commit_to_offset >= last_commit_from_offset
      AND last_commit_to_offset = next_offset)) IS TRUE),
  CHECK ((state = 'SUSPENDED') = (suspension_reason IS NOT NULL))
);
CREATE UNIQUE INDEX trader_external_journal_one_active_generation
  ON public.trader_external_journal_generations (source_id) WHERE state = 'ACTIVE';
CREATE INDEX trader_external_journal_sources_credential
  ON public.trader_external_journal_sources (credential_id, source_id);

CREATE FUNCTION public.trader_external_journal_payload_valid(document jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE item record; maximum integer;
BEGIN
  IF jsonb_typeof(document) IS DISTINCT FROM 'object' OR octet_length(document::text) > 16384
    OR jsonb_typeof(document->'source') IS DISTINCT FROM 'object'
    OR jsonb_typeof(document->'provenance') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (document->'source') - ARRAY['sourceId','organizationId','accountId','externalUid','market'] <> '{}'::jsonb
    OR NOT (document->'source' ?& ARRAY['sourceId','organizationId','accountId','externalUid','market'])
    OR (document->'provenance') - ARRAY['normalizerVersion','sourceId','generationId','byteOffset','byteLength','rawSha256'] <> '{}'::jsonb
    OR NOT (document->'provenance' ?& ARRAY['normalizerVersion','sourceId','generationId','byteOffset','byteLength','rawSha256']) THEN
    RETURN false;
  END IF;
  FOR item IN SELECT key, value FROM jsonb_each(document->'source') LOOP
    IF jsonb_typeof(item.value) <> 'string' OR length(item.value #>> '{}') NOT BETWEEN 1 AND 128 THEN RETURN false; END IF;
  END LOOP;
  FOR item IN SELECT key, value FROM jsonb_each(document->'provenance') LOOP
    IF item.key IN ('byteOffset','byteLength') THEN
      IF jsonb_typeof(item.value) <> 'number' THEN RETURN false; END IF;
    ELSIF jsonb_typeof(item.value) <> 'string' OR length(item.value #>> '{}') NOT BETWEEN 1 AND 128 THEN RETURN false;
    END IF;
  END LOOP;
  FOR item IN SELECT key, value FROM jsonb_each(document) WHERE key IN
    ('instrumentKind','sourceEventTime','contract','asset','side','orderId','tradeId','externalEstimatedPnlUsdt') LOOP
    maximum := CASE WHEN item.key = 'side' THEN 32 WHEN item.key IN ('orderId','tradeId') THEN 128
      WHEN item.key = 'externalEstimatedPnlUsdt' THEN 16384 ELSE 64 END;
    IF jsonb_typeof(item.value) <> 'string' OR length(item.value #>> '{}') NOT BETWEEN 1 AND maximum THEN RETURN false; END IF;
    IF item.key = 'instrumentKind' AND (item.value #>> '{}') NOT IN ('contract','asset') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.trader_external_journal_payload_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trader_external_journal_payload_valid(jsonb) TO waia_external_journal_importer;

CREATE TABLE public.trader_external_journal_records (
  source_id uuid NOT NULL,
  generation_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  credential_id uuid NOT NULL,
  exchange_account_id text NOT NULL,
  byte_offset bigint NOT NULL CHECK (byte_offset BETWEEN 0 AND 9007199254740991),
  byte_length bigint NOT NULL CHECK (byte_length BETWEEN 0 AND 9007199254740991
    AND byte_offset + byte_length <= 9007199254740991),
  raw_sha256 text CHECK (raw_sha256 ~ '^[0-9a-f]{64}$'),
  normalizer_version text NOT NULL CHECK (normalizer_version = 'htx-journal-v1'),
  record_kind text NOT NULL CHECK (record_kind IN ('observation', 'quarantine')),
  code text NOT NULL,
  payload jsonb,
  record_digest text NOT NULL CHECK (record_digest ~ '^[0-9a-f]{64}$'),
  batch_digest text NOT NULL CHECK (batch_digest ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_id, generation_id, byte_offset),
  FOREIGN KEY (source_id, generation_id, organization_id, credential_id, exchange_account_id)
    REFERENCES public.trader_external_journal_generations
      (source_id, generation_id, organization_id, credential_id, exchange_account_id),
  CHECK (((record_kind = 'quarantine' AND payload IS NULL AND code IN
    ('line_too_large','invalid_utf8','invalid_json','invalid_event_shape','source_identity_mismatch',
      'conflicting_event_fields','conflicting_instrument_fields') AND (raw_sha256 IS NOT NULL OR code = 'line_too_large')) OR
    (record_kind = 'observation' AND raw_sha256 IS NOT NULL AND payload IS NOT NULL
      AND public.trader_external_journal_payload_valid(payload)
      AND code IN ('entry_placed','entry_filled','close_sent','position_closed','protection_restored',
        'filled','closed','day_result','daily_stop','day_start','entry_cancelled','leverage_set','skipped','unknown')
      AND payload->>'kind' = code AND payload->>'authority' = 'external_executor_observation'
      AND payload->'canonicalFill' = 'false'::jsonb
      AND payload - ARRAY['kind','authority','canonicalFill','source','provenance','instrumentKind',
        'sourceEventTime','contract','asset','side','orderId','tradeId','externalEstimatedPnlUsdt'] = '{}'::jsonb
      AND payload->'source'->>'sourceId' = source_id::text
      AND payload->'source'->>'organizationId' = organization_id::text
      AND payload->'source'->>'accountId' = exchange_account_id
      AND payload->'provenance'->>'sourceId' = source_id::text
      AND payload->'provenance'->>'generationId' = generation_id
      AND payload->'provenance'->>'normalizerVersion' = normalizer_version
      AND payload->'provenance'->>'rawSha256' = raw_sha256
      AND payload->'provenance'->'byteOffset' = to_jsonb(byte_offset)
      AND payload->'provenance'->'byteLength' = to_jsonb(byte_length))) IS TRUE)
);

CREATE FUNCTION public.trader_external_journal_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user = 'waia_external_journal_importer' THEN
    RAISE EXCEPTION 'EXTERNAL_JOURNAL_SOURCE_MUTATION_FORBIDDEN';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'EXTERNAL_JOURNAL_SOURCE_DELETE_FORBIDDEN'; END IF;
  IF ROW(NEW.source_id, NEW.organization_id, NEW.credential_id, NEW.exchange_account_id)
    IS DISTINCT FROM ROW(OLD.source_id, OLD.organization_id, OLD.credential_id, OLD.exchange_account_id)
    OR NEW.binding_revision IS DISTINCT FROM OLD.binding_revision THEN
    RAISE EXCEPTION 'EXTERNAL_JOURNAL_SOURCE_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN NEW.binding_revision := OLD.binding_revision + 1; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trader_external_journal_source_guard() FROM PUBLIC;
CREATE TRIGGER trader_external_journal_source_guard BEFORE UPDATE OR DELETE
  ON public.trader_external_journal_sources FOR EACH ROW EXECUTE FUNCTION public.trader_external_journal_source_guard();

CREATE FUNCTION public.trader_external_journal_record_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'EXTERNAL_JOURNAL_RECORD_IMMUTABLE'; END $$;
REVOKE ALL ON FUNCTION public.trader_external_journal_record_immutable() FROM PUBLIC;
CREATE TRIGGER trader_external_journal_record_immutable BEFORE UPDATE OR DELETE
  ON public.trader_external_journal_records FOR EACH ROW EXECUTE FUNCTION public.trader_external_journal_record_immutable();

CREATE FUNCTION public.trader_external_journal_generation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE same_cursor boolean; same_receipt boolean; live_lease boolean;
BEGIN
  IF ROW(NEW.source_id, NEW.generation_id, NEW.organization_id, NEW.credential_id, NEW.exchange_account_id,
    NEW.source_binding_revision, NEW.generation_fingerprint) IS DISTINCT FROM
    ROW(OLD.source_id, OLD.generation_id, OLD.organization_id, OLD.credential_id, OLD.exchange_account_id,
      OLD.source_binding_revision, OLD.generation_fingerprint) THEN
    RAISE EXCEPTION 'EXTERNAL_JOURNAL_GENERATION_IDENTITY_IMMUTABLE';
  END IF;
  same_cursor := ROW(NEW.cursor_version, NEW.next_offset, NEW.pending_offset, NEW.pending_bytes,
    NEW.discard_line_offset, NEW.discard_bytes_seen) IS NOT DISTINCT FROM
    ROW(OLD.cursor_version, OLD.next_offset, OLD.pending_offset, OLD.pending_bytes,
      OLD.discard_line_offset, OLD.discard_bytes_seen);
  same_receipt := ROW(NEW.last_commit_token, NEW.last_commit_digest, NEW.last_commit_from_version,
    NEW.last_commit_to_version, NEW.last_commit_from_offset, NEW.last_commit_to_offset) IS NOT DISTINCT FROM
    ROW(OLD.last_commit_token, OLD.last_commit_digest, OLD.last_commit_from_version,
      OLD.last_commit_to_version, OLD.last_commit_from_offset, OLD.last_commit_to_offset);
  live_lease := OLD.lease_token::text = current_setting('waia.journal_lease', true)
    AND OLD.lease_owner = current_setting('waia.journal_owner', true)
    AND OLD.lease_expires_at > clock_timestamp();
  IF OLD.state <> 'ACTIVE' THEN RAISE EXCEPTION 'EXTERNAL_JOURNAL_GENERATION_INACTIVE'; END IF;
  IF same_cursor AND same_receipt AND NEW.state = OLD.state AND NEW.suspension_reason IS NULL
    AND (OLD.lease_token IS NULL OR OLD.lease_expires_at <= clock_timestamp())
    AND NEW.lease_token IS NOT NULL AND NEW.lease_owner IS NOT NULL
    AND NEW.lease_claimed_at >= clock_timestamp() - interval '1 second'
    AND NEW.lease_claimed_at <= clock_timestamp() AND NEW.lease_expires_at > clock_timestamp() THEN
    RETURN NEW;
  END IF;
  IF live_lease AND NEW.lease_token IS NULL AND NEW.lease_owner IS NULL
    AND NEW.lease_claimed_at IS NULL AND NEW.lease_expires_at IS NULL THEN
    IF same_cursor AND same_receipt AND NEW.state = 'SUSPENDED' AND NEW.suspension_reason IS NOT NULL THEN RETURN NEW; END IF;
    IF NEW.state IN ('ACTIVE', 'CLOSED') AND NEW.suspension_reason IS NULL
      AND NEW.cursor_version = OLD.cursor_version + 1 AND NEW.next_offset >= OLD.next_offset
      AND NEW.last_commit_token = OLD.lease_token
      AND NEW.last_commit_from_version = OLD.cursor_version AND NEW.last_commit_to_version = NEW.cursor_version
      AND NEW.last_commit_from_offset = OLD.next_offset AND NEW.last_commit_to_offset = NEW.next_offset
      AND NEW.last_commit_digest IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'EXTERNAL_JOURNAL_INVALID_GENERATION_TRANSITION';
END $$;
REVOKE ALL ON FUNCTION public.trader_external_journal_generation_guard() FROM PUBLIC;
CREATE TRIGGER trader_external_journal_generation_guard BEFORE UPDATE
  ON public.trader_external_journal_generations FOR EACH ROW EXECUTE FUNCTION public.trader_external_journal_generation_guard();

ALTER TABLE public.trader_external_journal_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_external_journal_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trader_external_journal_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_external_journal_generations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trader_external_journal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_external_journal_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.trader_external_journal_sources, public.trader_external_journal_generations,
  public.trader_external_journal_records FROM PUBLIC;
-- Optional platform roles may be absent in the isolated native fixture. Explicitly
-- remove inherited default table AND column grants whenever those roles exist.
DO $$ DECLARE role_name text; relation_name text; column_list text; BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN
    ('waia_external_journal_importer','anon','authenticated','service_role','waia_account_observer',
     'waia_account_observation_reader','waia_account_observation_credential') LOOP
    FOREACH relation_name IN ARRAY ARRAY['trader_external_journal_sources',
      'trader_external_journal_generations','trader_external_journal_records'] LOOP
      EXECUTE format('REVOKE ALL ON public.%I FROM %I', relation_name, role_name);
      SELECT string_agg(quote_ident(attname), ',') INTO column_list FROM pg_attribute
        WHERE attrelid = format('public.%I', relation_name)::regclass AND attnum > 0 AND NOT attisdropped;
      EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON public.%I FROM %I',
        column_list, column_list, column_list, column_list, relation_name, role_name);
    END LOOP;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO waia_external_journal_importer;
GRANT SELECT ON public.trader_external_journal_sources, public.trader_external_journal_generations,
  public.trader_external_journal_records TO waia_external_journal_importer;
-- Lock-only privilege: the source trigger refuses every importer UPDATE, even a no-op.
GRANT UPDATE (binding_revision) ON public.trader_external_journal_sources TO waia_external_journal_importer;
GRANT UPDATE (state, cursor_version, next_offset, pending_offset, pending_bytes,
  discard_line_offset, discard_bytes_seen, lease_token, lease_owner, lease_claimed_at, lease_expires_at,
  last_commit_token, last_commit_digest, last_commit_from_version, last_commit_to_version,
  last_commit_from_offset, last_commit_to_offset, suspension_reason)
  ON public.trader_external_journal_generations TO waia_external_journal_importer;
GRANT INSERT (source_id, generation_id, organization_id, credential_id, exchange_account_id,
  byte_offset, byte_length, raw_sha256, normalizer_version, record_kind, code, payload,
  record_digest, batch_digest) ON public.trader_external_journal_records TO waia_external_journal_importer;
GRANT SELECT (id, organization_id, venue, exchange_account_id, status, observation_revision),
  UPDATE (observation_revision) ON public.exchange_credentials TO waia_external_journal_importer;

-- sources -> nothing; credentials -> sources; generations -> sources + credentials;
-- records -> generations + sources. Do not add credential checks to source policies.
CREATE POLICY external_journal_source_read ON public.trader_external_journal_sources
  FOR SELECT TO waia_external_journal_importer USING
  (assigned_login = session_user::text AND source_id::text = current_setting('waia.journal_source', true));
CREATE POLICY external_journal_source_lock ON public.trader_external_journal_sources
  FOR UPDATE TO waia_external_journal_importer USING
  (assigned_login = session_user::text AND source_id::text = current_setting('waia.journal_source', true))
  WITH CHECK (assigned_login = session_user::text AND source_id::text = current_setting('waia.journal_source', true));
CREATE POLICY external_journal_credential_read ON public.exchange_credentials
  FOR SELECT TO waia_external_journal_importer USING
  (EXISTS (SELECT 1 FROM public.trader_external_journal_sources s
    WHERE s.credential_id = exchange_credentials.id AND s.organization_id = exchange_credentials.organization_id
      AND s.exchange_account_id = exchange_credentials.exchange_account_id));
CREATE POLICY external_journal_credential_lock ON public.exchange_credentials
  FOR UPDATE TO waia_external_journal_importer USING
  (EXISTS (SELECT 1 FROM public.trader_external_journal_sources s
    WHERE s.credential_id = exchange_credentials.id AND s.organization_id = exchange_credentials.organization_id
      AND s.exchange_account_id = exchange_credentials.exchange_account_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.trader_external_journal_sources s
    WHERE s.credential_id = exchange_credentials.id AND s.organization_id = exchange_credentials.organization_id
      AND s.exchange_account_id = exchange_credentials.exchange_account_id));

CREATE FUNCTION public.trader_external_journal_binding_current(
  sid uuid, org uuid, credential uuid, account text, expected_binding_revision bigint
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM public.trader_external_journal_sources s
    JOIN public.exchange_credentials c ON c.id = s.credential_id AND c.organization_id = s.organization_id
      AND c.exchange_account_id = s.exchange_account_id
    WHERE s.source_id = sid AND s.organization_id = org AND s.credential_id = credential
      AND s.exchange_account_id = account AND s.binding_revision = expected_binding_revision
      AND s.binding_state = 'VERIFIED' AND s.verification_receipt IS NOT NULL
      AND s.verified_at <= statement_timestamp() AND s.verification_expires_at > statement_timestamp()
      AND c.status = 'active' AND c.venue = 'htx' AND c.observation_revision = s.credential_revision);
$$;
REVOKE ALL ON FUNCTION public.trader_external_journal_binding_current(uuid,uuid,uuid,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trader_external_journal_binding_current(uuid,uuid,uuid,text,bigint)
  TO waia_external_journal_importer;
CREATE POLICY external_journal_generation_read ON public.trader_external_journal_generations
  FOR SELECT TO waia_external_journal_importer USING
  (source_id::text = current_setting('waia.journal_source', true)
    AND generation_id = current_setting('waia.journal_generation', true)
    AND public.trader_external_journal_binding_current(source_id, organization_id, credential_id,
      exchange_account_id, source_binding_revision));
CREATE POLICY external_journal_generation_update ON public.trader_external_journal_generations
  FOR UPDATE TO waia_external_journal_importer USING
  (source_id::text = current_setting('waia.journal_source', true)
    AND generation_id = current_setting('waia.journal_generation', true)
    AND public.trader_external_journal_binding_current(source_id, organization_id, credential_id,
      exchange_account_id, source_binding_revision))
  WITH CHECK (source_id::text = current_setting('waia.journal_source', true)
    AND generation_id = current_setting('waia.journal_generation', true)
    AND public.trader_external_journal_binding_current(source_id, organization_id, credential_id,
      exchange_account_id, source_binding_revision));
CREATE POLICY external_journal_record_read ON public.trader_external_journal_records
  FOR SELECT TO waia_external_journal_importer USING
  (EXISTS (SELECT 1 FROM public.trader_external_journal_generations g
    WHERE g.source_id = trader_external_journal_records.source_id AND g.generation_id = trader_external_journal_records.generation_id
      AND g.organization_id = trader_external_journal_records.organization_id
      AND g.credential_id = trader_external_journal_records.credential_id
      AND g.exchange_account_id = trader_external_journal_records.exchange_account_id));
CREATE POLICY external_journal_record_insert ON public.trader_external_journal_records
  FOR INSERT TO waia_external_journal_importer WITH CHECK
  (EXISTS (SELECT 1 FROM public.trader_external_journal_generations g
    JOIN public.trader_external_journal_sources s ON s.source_id = g.source_id
    WHERE g.source_id = trader_external_journal_records.source_id AND g.generation_id = trader_external_journal_records.generation_id
      AND g.organization_id = trader_external_journal_records.organization_id
      AND g.credential_id = trader_external_journal_records.credential_id
      AND g.exchange_account_id = trader_external_journal_records.exchange_account_id
      AND g.state = 'ACTIVE' AND g.lease_token::text = current_setting('waia.journal_lease', true)
      AND g.lease_owner = current_setting('waia.journal_owner', true)
      AND g.cursor_version::text = current_setting('waia.journal_cursor_version', true)
      AND g.lease_expires_at > clock_timestamp()
      AND (trader_external_journal_records.record_kind = 'quarantine' OR
        (trader_external_journal_records.payload->'source'->>'externalUid' = s.external_uid
          AND trader_external_journal_records.payload->'source'->>'market' = s.market))));
