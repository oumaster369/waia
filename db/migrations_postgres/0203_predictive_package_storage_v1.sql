-- DEE-946: additive, lossless package storage. No existing package is rewritten.
-- Chunks are inserted first; their deferred FK prevents an unsealed commit.
-- The final manifest validates coverage once, avoiding an O(chunks^2) guard.
CREATE TABLE public.trader_predictive_package_manifest_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  package_id uuid NOT NULL,
  codec_version text NOT NULL CHECK (codec_version = 'predictive-package-codec/v1'),
  generation_digest_hex text NOT NULL CHECK (generation_digest_hex ~ '^[0-9a-f]{64}$'),
  content_digest_hex text NOT NULL CHECK (content_digest_hex ~ '^[0-9a-f]{64}$'),
  manifest_digest_hex text NOT NULL CHECK (manifest_digest_hex ~ '^[0-9a-f]{64}$'),
  chunk_byte_limit integer NOT NULL CHECK (chunk_byte_limit BETWEEN 1 AND 65536),
  source_count integer NOT NULL CHECK (source_count > 0),
  replica_count integer NOT NULL CHECK (replica_count > 0),
  chunk_count integer NOT NULL CHECK (chunk_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, package_id, codec_version),
  CONSTRAINT tppm_v1_package_lineage_fk FOREIGN KEY
    (package_id, organization_id, content_digest_hex)
    REFERENCES public.trader_forecast_predictive_package_v2
    (id, organization_id, predictive_package_content_digest)
);
--> statement-breakpoint
CREATE TABLE public.trader_predictive_package_chunk_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  package_id uuid NOT NULL,
  codec_version text NOT NULL CHECK (codec_version = 'predictive-package-codec/v1'),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 65536),
  record_count integer NOT NULL CHECK (record_count > 0),
  sha256_hex text NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  payload bytea NOT NULL,
  PRIMARY KEY (organization_id, package_id, codec_version, ordinal),
  CONSTRAINT tppc_v1_payload_length CHECK (octet_length(payload) = byte_length),
  CONSTRAINT tppc_v1_payload_digest CHECK (encode(sha256(payload), 'hex') = sha256_hex),
  CONSTRAINT tppc_v1_manifest_fk FOREIGN KEY (organization_id, package_id, codec_version)
    REFERENCES public.trader_predictive_package_manifest_v1
    (organization_id, package_id, codec_version) DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE FUNCTION public.trader_predictive_package_storage_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  actual_count bigint;
  first_ordinal integer;
  last_ordinal integer;
  max_bytes integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'PREDICTIVE_PACKAGE_STORAGE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  -- Same key/order in publisher and both tables. Serializes competing seals and
  -- prevents extending a sealed package, including at READ COMMITTED.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'predictive-package-storage/v1|' || NEW.organization_id::text || '|' || NEW.package_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.trader_predictive_package_manifest_v1
      WHERE organization_id = NEW.organization_id AND package_id = NEW.package_id
        AND codec_version = NEW.codec_version) THEN
    RAISE EXCEPTION 'PREDICTIVE_PACKAGE_STORAGE_ALREADY_SEALED' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'trader_predictive_package_manifest_v1' THEN
    IF NOT EXISTS (SELECT 1 FROM public.trader_forecast_predictive_package_v2
      WHERE id = NEW.package_id AND organization_id = NEW.organization_id
        AND predictive_package_content_digest = NEW.content_digest_hex
        AND predictive_package_generation_identity_digest = NEW.generation_digest_hex) THEN
      RAISE EXCEPTION 'PREDICTIVE_PACKAGE_STORAGE_LINEAGE' USING ERRCODE = '23514';
    END IF;
    SELECT count(*), min(ordinal), max(ordinal), max(byte_length)
      INTO actual_count, first_ordinal, last_ordinal, max_bytes
      FROM public.trader_predictive_package_chunk_v1
      WHERE organization_id = NEW.organization_id AND package_id = NEW.package_id
        AND codec_version = NEW.codec_version;
    IF actual_count <> NEW.chunk_count OR first_ordinal IS DISTINCT FROM 0
       OR last_ordinal IS DISTINCT FROM NEW.chunk_count - 1
       OR max_bytes > NEW.chunk_byte_limit THEN
      RAISE EXCEPTION 'PREDICTIVE_PACKAGE_STORAGE_INCOMPLETE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tppm_v1_write_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.trader_predictive_package_manifest_v1 FOR EACH ROW
  EXECUTE FUNCTION public.trader_predictive_package_storage_guard_v1();
--> statement-breakpoint
CREATE TRIGGER tppc_v1_write_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.trader_predictive_package_chunk_v1 FOR EACH ROW
  EXECUTE FUNCTION public.trader_predictive_package_storage_guard_v1();
--> statement-breakpoint
CREATE TRIGGER tppm_v1_truncate_guard BEFORE TRUNCATE
  ON public.trader_predictive_package_manifest_v1 FOR EACH STATEMENT
  EXECUTE FUNCTION public.trader_predictive_package_storage_guard_v1();
--> statement-breakpoint
CREATE TRIGGER tppc_v1_truncate_guard BEFORE TRUNCATE
  ON public.trader_predictive_package_chunk_v1 FOR EACH STATEMENT
  EXECUTE FUNCTION public.trader_predictive_package_storage_guard_v1();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.trader_predictive_package_storage_guard_v1() FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE public.trader_predictive_package_manifest_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_predictive_package_chunk_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_historical_runner'
    AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication AND NOT rolinherit) OR EXISTS (
      SELECT 1 FROM pg_auth_members WHERE member = 'waia_historical_runner'::regrole
  ) THEN
    RAISE EXCEPTION 'PREDICTIVE_PACKAGE_STORAGE_UNSAFE_RUNNER';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'trader_predictive_package_manifest_v1', 'trader_predictive_package_chunk_v1'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, waia_historical_runner', table_name);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO waia_historical_runner', table_name);
    EXECUTE format('CREATE POLICY tpps_v1_runner_select ON public.%I FOR SELECT TO waia_historical_runner USING (organization_id = %L::uuid)', table_name, '3c50b4e9-1138-43a5-a29f-e65088124cfc');
    EXECUTE format('CREATE POLICY tpps_v1_runner_insert ON public.%I FOR INSERT TO waia_historical_runner WITH CHECK (organization_id = %L::uuid)', table_name, '3c50b4e9-1138-43a5-a29f-e65088124cfc');
  END LOOP;
END;
$$;
