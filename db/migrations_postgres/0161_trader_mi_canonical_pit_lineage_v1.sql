-- DEE-682: canonical gateway PIT + inert Measurement lineage V1.
-- PostgreSQL-only additive contract and lineage substrate.

ALTER TYPE public.mi_observation_kind ADD VALUE IF NOT EXISTS 'ohlcv_bar';
ALTER TYPE public.mi_observation_kind ADD VALUE IF NOT EXISTS 'quote_l1';
ALTER TYPE public.mi_observation_kind ADD VALUE IF NOT EXISTS 'order_book_snapshot';
ALTER TYPE public.mi_observation_kind ADD VALUE IF NOT EXISTS 'market_trades_snapshot';
ALTER TYPE public.mi_observation_kind ADD VALUE IF NOT EXISTS 'fear_greed_index';
ALTER TYPE public.mi_observation_kind ADD VALUE IF NOT EXISTS 'news_headline';
--> statement-breakpoint
ALTER TABLE public.trader_mi_trust_as_of_receipt_v1
  ADD CONSTRAINT tmtaor_v1_id_org_source_uq UNIQUE (id, organization_id, source_id);
--> statement-breakpoint
ALTER TABLE public.trader_mi_observation
  ADD COLUMN canonical_provider_id text,
  ADD COLUMN trust_as_of_receipt_id text,
  ADD COLUMN source_trust_revision_id uuid,
  ADD COLUMN source_trust_content_digest text,
  ADD COLUMN normalized_input_digest text;
--> statement-breakpoint
ALTER TABLE public.trader_mi_observation
  ADD CONSTRAINT trader_mi_observation_exact_lineage_unique
  UNIQUE (id, organization_id, source_id, content_digest);
--> statement-breakpoint
ALTER TABLE public.trader_mi_observation
  ADD CONSTRAINT trader_mi_observation_trust_receipt_scope_fk
  FOREIGN KEY (trust_as_of_receipt_id, organization_id, source_id)
  REFERENCES public.trader_mi_trust_as_of_receipt_v1(id, organization_id, source_id);
--> statement-breakpoint
ALTER TABLE public.trader_mi_observation
  ADD CONSTRAINT trader_mi_observation_trust_revision_scope_fk
  FOREIGN KEY (source_trust_revision_id, organization_id, source_id)
  REFERENCES public.trader_mi_source_trust(id, organization_id, source_id);
--> statement-breakpoint
ALTER TABLE public.trader_mi_observation
  ADD CONSTRAINT trader_mi_observation_canonical_external_check CHECK (
    (
      observation_kind = 'msv_envelope'
      AND canonical_provider_id IS NULL
      AND trust_as_of_receipt_id IS NULL
      AND source_trust_revision_id IS NULL
      AND source_trust_content_digest IS NULL
      AND normalized_input_digest IS NULL
    ) OR (
      observation_kind <> 'msv_envelope'
      AND schema_version = 'mi-canonical-pit-observation-v1'
      AND available_at IS NOT NULL
      AND canonical_provider_id IS NOT NULL
      AND length(btrim(canonical_provider_id)) > 0
      AND trust_as_of_receipt_id ~ '^[0-9a-f]{64}$'
      AND source_trust_revision_id IS NOT NULL
      AND source_trust_content_digest ~ '^[0-9a-f]{64}$'
      AND normalized_input_digest ~ '^[0-9a-f]{64}$'
    )
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_canonical_observation_v1_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trust_receipt public.trader_mi_trust_as_of_receipt_v1%ROWTYPE;
  predecessor public.trader_mi_observation%ROWTYPE;
BEGIN
  IF NEW.observation_kind = 'msv_envelope' THEN
    RETURN NEW;
  END IF;

  IF NEW.event_time > NEW.available_at OR NEW.available_at > NEW.ingest_time THEN
    RAISE EXCEPTION 'canonical external Observation chronology is not PIT-visible'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO trust_receipt
  FROM public.trader_mi_trust_as_of_receipt_v1 receipt
  WHERE receipt.id = NEW.trust_as_of_receipt_id
    AND receipt.organization_id = NEW.organization_id
    AND receipt.source_id = NEW.source_id;

  IF NOT FOUND
    OR trust_receipt.status <> 'RESOLVED'
    OR trust_receipt.anchor_time <> NEW.available_at
    OR trust_receipt.selected_trust_revision_id IS DISTINCT FROM NEW.source_trust_revision_id
    OR trust_receipt.selected_content_digest IS DISTINCT FROM NEW.source_trust_content_digest
  THEN
    RAISE EXCEPTION 'canonical external Observation trust-as-of identity mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.revision_seq = 1 THEN
    IF NEW.revision_of IS NOT NULL THEN
      RAISE EXCEPTION 'canonical external Observation root revision is invalid'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO predecessor
    FROM public.trader_mi_observation prior
    WHERE prior.id = NEW.revision_of
      AND prior.organization_id = NEW.organization_id
      AND prior.source_id = NEW.source_id;
    IF NOT FOUND
      OR predecessor.observation_key <> NEW.observation_key
      OR predecessor.observation_kind <> NEW.observation_kind
      OR predecessor.subject_ref <> NEW.subject_ref
      OR predecessor.event_time <> NEW.event_time
      OR predecessor.revision_seq <> NEW.revision_seq - 1
    THEN
      RAISE EXCEPTION 'canonical external Observation revision lineage mismatch'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_mi_observation_canonical_v1_guard
  BEFORE INSERT ON public.trader_mi_observation
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_observation_v1_guard();
--> statement-breakpoint
CREATE TABLE public.trader_mi_gateway_pit_receipt_v1 (
  id text PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL,
  provider_id text NOT NULL,
  gateway_kind text NOT NULL,
  status text NOT NULL,
  reason text,
  source_id uuid,
  trust_as_of_receipt_id text,
  observation_id uuid,
  observation_content_digest text,
  normalized_input_digest text NOT NULL,
  receipt_json jsonb NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamp with time zone
    DEFAULT date_trunc('milliseconds', transaction_timestamp()) NOT NULL,
  CONSTRAINT tm_gateway_pit_receipt_v1_id_digest_check CHECK (id = content_digest),
  CONSTRAINT tm_gateway_pit_receipt_v1_id_hex_check CHECK (id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tm_gateway_pit_receipt_v1_input_digest_check
    CHECK (normalized_input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tm_gateway_pit_receipt_v1_status_check CHECK (
    (
      status = 'AVAILABLE'
      AND reason IS NULL
      AND source_id IS NOT NULL
      AND trust_as_of_receipt_id IS NOT NULL
      AND observation_id IS NOT NULL
      AND observation_content_digest ~ '^[0-9a-f]{64}$'
    ) OR (
      status IN ('UNAVAILABLE', 'REJECTED')
      AND reason IS NOT NULL
      AND observation_id IS NULL
      AND observation_content_digest IS NULL
    )
  ),
  CONSTRAINT tm_gateway_pit_receipt_v1_id_org_source_uq
    UNIQUE (id, organization_id, source_id)
);
--> statement-breakpoint
ALTER TABLE public.trader_mi_gateway_pit_receipt_v1
  ADD CONSTRAINT tm_gateway_pit_receipt_v1_organization_fk
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_mi_gateway_pit_receipt_v1
  ADD CONSTRAINT tm_gateway_pit_receipt_v1_source_fk
  FOREIGN KEY (source_id, organization_id)
  REFERENCES public.trader_mi_source(id, organization_id);
--> statement-breakpoint
ALTER TABLE public.trader_mi_gateway_pit_receipt_v1
  ADD CONSTRAINT tm_gateway_pit_receipt_v1_trust_receipt_fk
  FOREIGN KEY (trust_as_of_receipt_id, organization_id, source_id)
  REFERENCES public.trader_mi_trust_as_of_receipt_v1(id, organization_id, source_id);
--> statement-breakpoint
ALTER TABLE public.trader_mi_gateway_pit_receipt_v1
  ADD CONSTRAINT tm_gateway_pit_receipt_v1_observation_fk
  FOREIGN KEY (observation_id, organization_id, source_id, observation_content_digest)
  REFERENCES public.trader_mi_observation(id, organization_id, source_id, content_digest);
--> statement-breakpoint
CREATE INDEX tm_gateway_pit_receipt_v1_org_kind_created_idx
  ON public.trader_mi_gateway_pit_receipt_v1(organization_id, gateway_kind, created_at);
--> statement-breakpoint
CREATE TABLE public.trader_mi_canonical_measurement_definition_v1 (
  id text PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL,
  category text NOT NULL,
  name text NOT NULL,
  input_contracts_json jsonb NOT NULL,
  output_schema_version text NOT NULL,
  authority text NOT NULL,
  definition_json jsonb NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamp with time zone
    DEFAULT date_trunc('milliseconds', transaction_timestamp()) NOT NULL,
  CONSTRAINT tm_measurement_definition_v1_id_digest_check CHECK (id = content_digest),
  CONSTRAINT tm_measurement_definition_v1_id_hex_check CHECK (id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tm_measurement_definition_v1_contract_check CHECK (
    category IN ('feature_transform', 'cross_exchange_confirmation', 'news_event_cluster')
    AND authority = 'INERT_DEFINITION_ONLY'
    AND schema_version = 'canonical-measurement-definition-v1'
    AND jsonb_typeof(input_contracts_json) = 'array'
    AND jsonb_array_length(input_contracts_json) > 0
  ),
  CONSTRAINT tm_measurement_definition_v1_exact_uq
    UNIQUE (id, organization_id, content_digest)
);
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_definition_v1
  ADD CONSTRAINT tm_measurement_definition_v1_organization_fk
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX tm_measurement_definition_v1_org_category_idx
  ON public.trader_mi_canonical_measurement_definition_v1(organization_id, category);
--> statement-breakpoint
CREATE TABLE public.trader_mi_canonical_measurement_value_v1 (
  id text PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL,
  definition_id text NOT NULL,
  definition_content_digest text NOT NULL,
  output_content_digest text NOT NULL,
  input_count integer NOT NULL,
  input_lineage_json jsonb NOT NULL,
  authority text NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamp with time zone
    DEFAULT date_trunc('milliseconds', transaction_timestamp()) NOT NULL,
  CONSTRAINT tm_measurement_value_v1_id_digest_check CHECK (id = content_digest),
  CONSTRAINT tm_measurement_value_v1_digest_check CHECK (
    id ~ '^[0-9a-f]{64}$'
    AND definition_content_digest ~ '^[0-9a-f]{64}$'
    AND output_content_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT tm_measurement_value_v1_contract_check CHECK (
    authority = 'INERT_LINEAGE_ONLY'
    AND schema_version = 'canonical-measurement-value-lineage-v1'
    AND jsonb_typeof(input_lineage_json) = 'array'
    AND input_count = jsonb_array_length(input_lineage_json)
    AND input_count > 0
  ),
  CONSTRAINT tm_measurement_value_v1_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT tm_measurement_value_v1_exact_uq UNIQUE (id, organization_id, content_digest)
);
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_value_v1
  ADD CONSTRAINT tm_measurement_value_v1_organization_fk
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_value_v1
  ADD CONSTRAINT tm_measurement_value_v1_definition_fk
  FOREIGN KEY (definition_id, organization_id, definition_content_digest)
  REFERENCES public.trader_mi_canonical_measurement_definition_v1(id, organization_id, content_digest);
--> statement-breakpoint
CREATE INDEX tm_measurement_value_v1_org_definition_idx
  ON public.trader_mi_canonical_measurement_value_v1(organization_id, definition_id);
--> statement-breakpoint
CREATE TABLE public.trader_mi_canonical_measurement_value_input_v1 (
  organization_id uuid NOT NULL,
  measurement_value_id text NOT NULL,
  input_ordinal integer NOT NULL,
  observation_id uuid NOT NULL,
  observation_kind text NOT NULL,
  observation_schema_version text NOT NULL,
  observation_content_digest text NOT NULL,
  source_id uuid NOT NULL,
  trust_as_of_receipt_id text NOT NULL,
  trust_revision_id uuid NOT NULL,
  trust_revision_content_digest text NOT NULL,
  created_at timestamp with time zone
    DEFAULT date_trunc('milliseconds', transaction_timestamp()) NOT NULL,
  CONSTRAINT trader_mi_canonical_measurement_value_input_v1_pk
    PRIMARY KEY (organization_id, measurement_value_id, input_ordinal),
  CONSTRAINT tm_measurement_value_input_v1_observation_uq
    UNIQUE (organization_id, measurement_value_id, observation_id, observation_content_digest),
  CONSTRAINT tm_measurement_value_input_v1_ordinal_check CHECK (input_ordinal >= 0),
  CONSTRAINT tm_measurement_value_input_v1_contract_check CHECK (
    observation_schema_version = 'mi-canonical-pit-observation-v1'
    AND observation_content_digest ~ '^[0-9a-f]{64}$'
    AND trust_as_of_receipt_id ~ '^[0-9a-f]{64}$'
    AND trust_revision_content_digest ~ '^[0-9a-f]{64}$'
  )
);
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_value_input_v1
  ADD CONSTRAINT tm_measurement_value_input_v1_organization_fk
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_value_input_v1
  ADD CONSTRAINT tm_measurement_value_input_v1_value_fk
  FOREIGN KEY (measurement_value_id, organization_id)
  REFERENCES public.trader_mi_canonical_measurement_value_v1(id, organization_id);
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_value_input_v1
  ADD CONSTRAINT tm_measurement_value_input_v1_observation_fk
  FOREIGN KEY (observation_id, organization_id, source_id, observation_content_digest)
  REFERENCES public.trader_mi_observation(id, organization_id, source_id, content_digest);
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_value_input_v1
  ADD CONSTRAINT tm_measurement_value_input_v1_trust_receipt_fk
  FOREIGN KEY (trust_as_of_receipt_id, organization_id, source_id)
  REFERENCES public.trader_mi_trust_as_of_receipt_v1(id, organization_id, source_id);
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_value_input_v1
  ADD CONSTRAINT tm_measurement_value_input_v1_trust_revision_fk
  FOREIGN KEY (trust_revision_id, organization_id, source_id)
  REFERENCES public.trader_mi_source_trust(id, organization_id, source_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_canonical_measurement_definition_v1_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.definition_json IS DISTINCT FROM jsonb_build_object(
    'id', NEW.id,
    'schemaVersion', NEW.schema_version,
    'organizationId', NEW.organization_id::text,
    'category', NEW.category,
    'name', NEW.name,
    'inputContracts', NEW.input_contracts_json,
    'outputSchemaVersion', NEW.output_schema_version,
    'authority', NEW.authority,
    'contentDigest', NEW.content_digest
  ) THEN
    RAISE EXCEPTION 'canonical MeasurementDefinition row/JSON mismatch or forbidden semantic field'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_mi_canonical_measurement_definition_v1_guard
  BEFORE INSERT ON public.trader_mi_canonical_measurement_definition_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_measurement_definition_v1_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_canonical_measurement_value_input_v1_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  value_row public.trader_mi_canonical_measurement_value_v1%ROWTYPE;
  observation_row public.trader_mi_observation%ROWTYPE;
  trust_receipt public.trader_mi_trust_as_of_receipt_v1%ROWTYPE;
  expected_input jsonb;
BEGIN
  SELECT * INTO value_row
  FROM public.trader_mi_canonical_measurement_value_v1 value
  WHERE value.id = NEW.measurement_value_id
    AND value.organization_id = NEW.organization_id;
  expected_input := value_row.input_lineage_json -> NEW.input_ordinal;

  SELECT * INTO observation_row
  FROM public.trader_mi_observation observation
  WHERE observation.id = NEW.observation_id
    AND observation.organization_id = NEW.organization_id
    AND observation.source_id = NEW.source_id
    AND observation.content_digest = NEW.observation_content_digest;

  SELECT * INTO trust_receipt
  FROM public.trader_mi_trust_as_of_receipt_v1 receipt
  WHERE receipt.id = NEW.trust_as_of_receipt_id
    AND receipt.organization_id = NEW.organization_id
    AND receipt.source_id = NEW.source_id;

  IF expected_input IS NULL
    OR observation_row.id IS NULL
    OR trust_receipt.id IS NULL
    OR observation_row.observation_kind::text <> NEW.observation_kind
    OR observation_row.schema_version <> NEW.observation_schema_version
    OR observation_row.trust_as_of_receipt_id <> NEW.trust_as_of_receipt_id
    OR observation_row.source_trust_revision_id <> NEW.trust_revision_id
    OR observation_row.source_trust_content_digest <> NEW.trust_revision_content_digest
    OR trust_receipt.status <> 'RESOLVED'
    OR trust_receipt.selected_trust_revision_id <> NEW.trust_revision_id
    OR trust_receipt.selected_content_digest <> NEW.trust_revision_content_digest
    OR expected_input IS DISTINCT FROM jsonb_build_object(
      'observationId', NEW.observation_id::text,
      'observationKind', NEW.observation_kind,
      'observationSchemaVersion', NEW.observation_schema_version,
      'observationContentDigest', NEW.observation_content_digest,
      'sourceId', NEW.source_id::text,
      'trustAsOfReceiptId', NEW.trust_as_of_receipt_id,
      'trustRevisionId', NEW.trust_revision_id::text,
      'trustRevisionContentDigest', NEW.trust_revision_content_digest
    )
  THEN
    RAISE EXCEPTION 'canonical MeasurementValue input lineage mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_mi_canonical_measurement_value_input_v1_guard
  BEFORE INSERT ON public.trader_mi_canonical_measurement_value_input_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_measurement_value_input_v1_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_canonical_measurement_value_v1_complete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_id text;
  target_org uuid;
  expected_count integer;
  actual_count integer;
BEGIN
  target_id := COALESCE(
    to_jsonb(NEW) ->> 'measurement_value_id',
    to_jsonb(NEW) ->> 'id',
    to_jsonb(OLD) ->> 'measurement_value_id',
    to_jsonb(OLD) ->> 'id'
  );
  target_org := COALESCE(
    to_jsonb(NEW) ->> 'organization_id',
    to_jsonb(OLD) ->> 'organization_id'
  )::uuid;
  SELECT input_count INTO expected_count
  FROM public.trader_mi_canonical_measurement_value_v1
  WHERE id = target_id AND organization_id = target_org;
  IF expected_count IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO actual_count
  FROM public.trader_mi_canonical_measurement_value_input_v1
  WHERE measurement_value_id = target_id AND organization_id = target_org;
  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'canonical MeasurementValue relational lineage is incomplete'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trader_mi_canonical_measurement_value_v1_complete
  AFTER INSERT ON public.trader_mi_canonical_measurement_value_v1
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_measurement_value_v1_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trader_mi_canonical_measurement_value_input_v1_complete
  AFTER INSERT ON public.trader_mi_canonical_measurement_value_input_v1
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_measurement_value_v1_complete();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_gateway_pit_receipt_v1_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  observation_row public.trader_mi_observation%ROWTYPE;
BEGIN
  IF NEW.receipt_json IS DISTINCT FROM jsonb_build_object(
    'id', NEW.id,
    'schemaVersion', NEW.schema_version,
    'organizationId', NEW.organization_id::text,
    'providerId', NEW.provider_id,
    'gatewayKind', NEW.gateway_kind,
    'status', NEW.status,
    'reason', NEW.reason,
    'sourceId', CASE WHEN NEW.source_id IS NULL THEN NULL ELSE to_jsonb(NEW.source_id::text) END,
    'trustAsOfReceiptId', NEW.trust_as_of_receipt_id,
    'observationId', CASE WHEN NEW.observation_id IS NULL THEN NULL ELSE to_jsonb(NEW.observation_id::text) END,
    'observationContentDigest', NEW.observation_content_digest,
    'normalizedInputDigest', NEW.normalized_input_digest,
    'contentDigest', NEW.content_digest
  ) THEN
    RAISE EXCEPTION 'canonical gateway receipt row/JSON mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'AVAILABLE' THEN
    SELECT * INTO observation_row
    FROM public.trader_mi_observation observation
    WHERE observation.id = NEW.observation_id
      AND observation.organization_id = NEW.organization_id
      AND observation.source_id = NEW.source_id
      AND observation.content_digest = NEW.observation_content_digest;
    IF NOT FOUND
      OR observation_row.normalized_input_digest <> NEW.normalized_input_digest
      OR observation_row.trust_as_of_receipt_id <> NEW.trust_as_of_receipt_id
      OR observation_row.canonical_provider_id <> NEW.provider_id
      OR observation_row.observation_kind::text <> NEW.gateway_kind
    THEN
      RAISE EXCEPTION 'AVAILABLE gateway receipt does not bind exact PIT Observation'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_mi_gateway_pit_receipt_v1_guard
  BEFORE INSERT ON public.trader_mi_gateway_pit_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_gateway_pit_receipt_v1_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_canonical_pit_lineage_v1_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_mi_gateway_pit_receipt_v1_block_update
  BEFORE UPDATE ON public.trader_mi_gateway_pit_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_pit_lineage_v1_block_mutation();
CREATE TRIGGER trader_mi_gateway_pit_receipt_v1_block_delete
  BEFORE DELETE ON public.trader_mi_gateway_pit_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_pit_lineage_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_mi_canonical_measurement_definition_v1_block_update
  BEFORE UPDATE ON public.trader_mi_canonical_measurement_definition_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_pit_lineage_v1_block_mutation();
CREATE TRIGGER trader_mi_canonical_measurement_definition_v1_block_delete
  BEFORE DELETE ON public.trader_mi_canonical_measurement_definition_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_pit_lineage_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_mi_canonical_measurement_value_v1_block_update
  BEFORE UPDATE ON public.trader_mi_canonical_measurement_value_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_pit_lineage_v1_block_mutation();
CREATE TRIGGER trader_mi_canonical_measurement_value_v1_block_delete
  BEFORE DELETE ON public.trader_mi_canonical_measurement_value_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_pit_lineage_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_mi_canonical_measurement_value_input_v1_block_update
  BEFORE UPDATE ON public.trader_mi_canonical_measurement_value_input_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_pit_lineage_v1_block_mutation();
CREATE TRIGGER trader_mi_canonical_measurement_value_input_v1_block_delete
  BEFORE DELETE ON public.trader_mi_canonical_measurement_value_input_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_canonical_pit_lineage_v1_block_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_mi_gateway_pit_receipt_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY trader_mi_gateway_pit_receipt_v1_deny_client_all
  ON public.trader_mi_gateway_pit_receipt_v1 FOR ALL
  TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_definition_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY trader_mi_canonical_measurement_definition_v1_deny_client_all
  ON public.trader_mi_canonical_measurement_definition_v1 FOR ALL
  TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_value_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY trader_mi_canonical_measurement_value_v1_deny_client_all
  ON public.trader_mi_canonical_measurement_value_v1 FOR ALL
  TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE public.trader_mi_canonical_measurement_value_input_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY trader_mi_canonical_measurement_value_input_v1_deny_client_all
  ON public.trader_mi_canonical_measurement_value_input_v1 FOR ALL
  TO authenticated, anon USING (false) WITH CHECK (false);
