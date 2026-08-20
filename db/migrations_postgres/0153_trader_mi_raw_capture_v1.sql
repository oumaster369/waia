-- DEE-656: generic raw-capture + record-only validation T2 foundation.
-- Postgres receipts/references only: no raw body bytes, production storage, or production apply.

CREATE TABLE public.trader_mi_raw_storage_binding_v1 (
  id text PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  raw_bytes_digest text NOT NULL,
  storage_backend_id text NOT NULL,
  object_key text NOT NULL,
  object_version text NOT NULL,
  encryption_requirement text NOT NULL,
  access_requirement text NOT NULL,
  stored_at timestamp with time zone NOT NULL,
  binding_json text NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT tmrsb_v1_id_is_digest_check CHECK (id = content_digest),
  CONSTRAINT tmrsb_v1_id_hex_check CHECK (id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tmrsb_v1_raw_digest_check CHECK (raw_bytes_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tmrsb_v1_security_check CHECK (
    encryption_requirement = 'PRIVATE_ENCRYPTED' AND access_requirement = 'SERVER_ONLY'
  ),
  CONSTRAINT tmrsb_v1_id_org_source_raw_uq
    UNIQUE (id, organization_id, source_id, raw_bytes_digest)
);
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_storage_binding_v1
  ADD CONSTRAINT tmrsb_v1_organization_fk
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_storage_binding_v1
  ADD CONSTRAINT tmrsb_v1_source_organization_fk
  FOREIGN KEY (source_id, organization_id)
  REFERENCES public.trader_mi_source(id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX tmrsb_v1_org_source_raw_idx
  ON public.trader_mi_raw_storage_binding_v1 (organization_id, source_id, raw_bytes_digest);
--> statement-breakpoint
CREATE TABLE public.trader_mi_raw_capture_receipt_v1 (
  id text PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  raw_bytes_digest text NOT NULL,
  payload_bytes bigint NOT NULL,
  max_payload_bytes bigint NOT NULL,
  retention_seconds bigint NOT NULL,
  policy_digest text NOT NULL,
  secret_scan_receipt_digest text NOT NULL,
  storage_binding_digest text NOT NULL,
  captured_at timestamp with time zone NOT NULL,
  retention_until timestamp with time zone NOT NULL,
  authority text NOT NULL,
  receipt_json text NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT tmrcr_v1_id_is_digest_check CHECK (id = content_digest),
  CONSTRAINT tmrcr_v1_id_hex_check CHECK (id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tmrcr_v1_raw_digest_check CHECK (raw_bytes_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tmrcr_v1_related_digests_check CHECK (
    policy_digest ~ '^[0-9a-f]{64}$'
    AND secret_scan_receipt_digest ~ '^[0-9a-f]{64}$'
    AND storage_binding_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT tmrcr_v1_payload_bytes_check CHECK (
    payload_bytes >= 0 AND max_payload_bytes > 0
    AND payload_bytes <= max_payload_bytes AND retention_seconds > 0
  ),
  CONSTRAINT tmrcr_v1_retention_check CHECK (retention_until > captured_at),
  CONSTRAINT tmrcr_v1_authority_check CHECK (authority = 'RECORD_ONLY'),
  CONSTRAINT tmrcr_v1_id_org_source_uq UNIQUE (id, organization_id, source_id)
);
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_capture_receipt_v1
  ADD CONSTRAINT tmrcr_v1_organization_fk
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_capture_receipt_v1
  ADD CONSTRAINT tmrcr_v1_source_organization_fk
  FOREIGN KEY (source_id, organization_id)
  REFERENCES public.trader_mi_source(id, organization_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_capture_receipt_v1
  ADD CONSTRAINT tmrcr_v1_storage_binding_scope_fk
  FOREIGN KEY (storage_binding_digest, organization_id, source_id, raw_bytes_digest)
  REFERENCES public.trader_mi_raw_storage_binding_v1(
    id, organization_id, source_id, raw_bytes_digest
  );
--> statement-breakpoint
CREATE UNIQUE INDEX tmrcr_v1_org_storage_binding_uq
  ON public.trader_mi_raw_capture_receipt_v1 (organization_id, storage_binding_digest);
--> statement-breakpoint
CREATE INDEX tmrcr_v1_org_source_captured_idx
  ON public.trader_mi_raw_capture_receipt_v1 (organization_id, source_id, captured_at);
--> statement-breakpoint
CREATE TABLE public.trader_mi_raw_validation_receipt_v1 (
  id text PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  capture_receipt_digest text NOT NULL,
  validator_id text NOT NULL,
  validator_version text NOT NULL,
  status text NOT NULL,
  reason_codes_json text NOT NULL,
  known_at timestamp with time zone
    DEFAULT date_trunc('milliseconds', transaction_timestamp()) NOT NULL,
  authority text NOT NULL,
  observation_authority text NOT NULL,
  measurement_authority text NOT NULL,
  receipt_json text NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamp with time zone
    DEFAULT date_trunc('milliseconds', transaction_timestamp()) NOT NULL,
  CONSTRAINT tmrvr_v1_id_is_digest_check CHECK (id = content_digest),
  CONSTRAINT tmrvr_v1_id_hex_check CHECK (id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tmrvr_v1_capture_digest_check CHECK (
    capture_receipt_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT tmrvr_v1_status_check CHECK (
    jsonb_typeof(reason_codes_json::jsonb) = 'array' AND (
      (status = 'VALID' AND jsonb_array_length(reason_codes_json::jsonb) = 0)
      OR (status = 'REJECTED' AND jsonb_array_length(reason_codes_json::jsonb) > 0)
    )
  ),
  CONSTRAINT tmrvr_v1_authority_check CHECK (
    authority = 'RECORD_ONLY'
    AND observation_authority = 'NONE'
    AND measurement_authority = 'NONE'
  )
);
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_validation_receipt_v1
  ADD CONSTRAINT tmrvr_v1_organization_fk
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_validation_receipt_v1
  ADD CONSTRAINT tmrvr_v1_capture_scope_fk
  FOREIGN KEY (capture_receipt_digest, organization_id, source_id)
  REFERENCES public.trader_mi_raw_capture_receipt_v1(id, organization_id, source_id);
--> statement-breakpoint
CREATE UNIQUE INDEX tmrvr_v1_org_capture_validator_uq
  ON public.trader_mi_raw_validation_receipt_v1 (
    organization_id, capture_receipt_digest, validator_id, validator_version
  );
--> statement-breakpoint
CREATE INDEX tmrvr_v1_org_source_known_idx
  ON public.trader_mi_raw_validation_receipt_v1 (organization_id, source_id, known_at);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_raw_foundation_v1_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_mi_raw_storage_binding_v1_block_update
  BEFORE UPDATE ON public.trader_mi_raw_storage_binding_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_raw_foundation_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_mi_raw_storage_binding_v1_block_delete
  BEFORE DELETE ON public.trader_mi_raw_storage_binding_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_raw_foundation_v1_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_raw_capture_v1_author_time()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.captured_at := date_trunc('milliseconds', transaction_timestamp());
  NEW.created_at := NEW.captured_at;
  IF (NEW.receipt_json::jsonb ->> 'capturedAtUtc')::timestamptz IS DISTINCT FROM NEW.captured_at
    OR (NEW.receipt_json::jsonb ->> 'retentionUntilUtc')::timestamptz
      IS DISTINCT FROM NEW.retention_until
    OR (NEW.receipt_json::jsonb -> 'policy' ->> 'maxPayloadBytes')::bigint
      IS DISTINCT FROM NEW.max_payload_bytes
    OR (NEW.receipt_json::jsonb -> 'policy' ->> 'retentionSeconds')::bigint
      IS DISTINCT FROM NEW.retention_seconds
  THEN
    RAISE EXCEPTION 'raw capture receipt time/policy must match database-authored transaction data'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_mi_raw_capture_receipt_v1_author_time
  BEFORE INSERT ON public.trader_mi_raw_capture_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_raw_capture_v1_author_time();
--> statement-breakpoint
CREATE TRIGGER trader_mi_raw_capture_receipt_v1_block_update
  BEFORE UPDATE ON public.trader_mi_raw_capture_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_raw_foundation_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_mi_raw_capture_receipt_v1_block_delete
  BEFORE DELETE ON public.trader_mi_raw_capture_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_raw_foundation_v1_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_raw_validation_v1_author_time()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.known_at := date_trunc('milliseconds', transaction_timestamp());
  NEW.created_at := NEW.known_at;
  IF (NEW.receipt_json::jsonb ->> 'knownAtUtc')::timestamptz IS DISTINCT FROM NEW.known_at THEN
    RAISE EXCEPTION 'raw validation known_at must match database-authored transaction time'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.trader_mi_raw_capture_receipt_v1 c
    WHERE c.id = NEW.capture_receipt_digest
      AND c.organization_id = NEW.organization_id
      AND c.source_id = NEW.source_id
      AND c.captured_at <= NEW.known_at
  ) THEN
    RAISE EXCEPTION 'raw validation known_at precedes scoped durable capture'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_mi_raw_validation_receipt_v1_author_time
  BEFORE INSERT ON public.trader_mi_raw_validation_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_raw_validation_v1_author_time();
--> statement-breakpoint
CREATE TRIGGER trader_mi_raw_validation_receipt_v1_block_update
  BEFORE UPDATE ON public.trader_mi_raw_validation_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_raw_foundation_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_mi_raw_validation_receipt_v1_block_delete
  BEFORE DELETE ON public.trader_mi_raw_validation_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_raw_foundation_v1_block_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_storage_binding_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY trader_mi_raw_storage_binding_v1_deny_authenticated_all
  ON public.trader_mi_raw_storage_binding_v1 FOR ALL
  TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_capture_receipt_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY trader_mi_raw_capture_receipt_v1_deny_authenticated_all
  ON public.trader_mi_raw_capture_receipt_v1 FOR ALL
  TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE public.trader_mi_raw_validation_receipt_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY trader_mi_raw_validation_receipt_v1_deny_authenticated_all
  ON public.trader_mi_raw_validation_receipt_v1 FOR ALL
  TO authenticated, anon USING (false) WITH CHECK (false);
