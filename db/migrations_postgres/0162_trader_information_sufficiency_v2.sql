-- DEE-687 / M685-B: immutable Required Information Profile V2 and exact ISG receipts.
-- PostgreSQL-only, service-owned, epistemic authority only. No formula or capital authority.

CREATE TABLE public.trader_required_information_profile_v2 (
  id text PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text,
  profile_version text NOT NULL,
  purpose text NOT NULL,
  symbol text NOT NULL,
  venue text NOT NULL,
  analytical_timeframe text NOT NULL,
  horizon text NOT NULL,
  profile_json jsonb NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  authority text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_required_information_profile_v2_exact_uq
    UNIQUE (id, organization_id, content_digest),
  CONSTRAINT trader_required_information_profile_v2_identity_check CHECK (
    id = content_digest AND id ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT trader_required_information_profile_v2_contract_check CHECK (
    schema_version = 'required-information-profile-v2'
    AND authority = 'EPISTEMIC_PREREQUISITE_ONLY'
    AND purpose IN ('NEW_OPPORTUNITY', 'OPEN_POSITION_REASSESSMENT', 'RESEARCH_NON_CAPITAL')
    AND (account_id IS NULL OR length(btrim(account_id)) > 0)
    AND length(btrim(profile_version)) > 0
    AND length(btrim(symbol)) > 0
    AND length(btrim(venue)) > 0
    AND length(btrim(analytical_timeframe)) > 0
    AND length(btrim(horizon)) > 0
    AND jsonb_typeof(profile_json) = 'object'
  )
);
--> statement-breakpoint
CREATE INDEX trader_required_information_profile_v2_scope_idx
  ON public.trader_required_information_profile_v2 (
    organization_id, account_id, purpose, symbol, venue
  );
--> statement-breakpoint
CREATE TABLE public.trader_information_sufficiency_receipt_v2 (
  id text PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text,
  profile_id text NOT NULL,
  profile_content_digest text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL,
  pit_anchor timestamptz NOT NULL,
  receipt_json jsonb NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  authority text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_information_sufficiency_receipt_v2_profile_fk FOREIGN KEY (
    profile_id, organization_id, profile_content_digest
  ) REFERENCES public.trader_required_information_profile_v2 (
    id, organization_id, content_digest
  ),
  CONSTRAINT trader_information_sufficiency_receipt_v2_identity_check CHECK (
    id = content_digest AND id ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT trader_information_sufficiency_receipt_v2_contract_check CHECK (
    schema_version = 'information-sufficiency-receipt-v2'
    AND authority = 'EPISTEMIC_PREREQUISITE_ONLY'
    AND purpose IN ('NEW_OPPORTUNITY', 'OPEN_POSITION_REASSESSMENT', 'RESEARCH_NON_CAPITAL')
    AND status IN ('SUFFICIENT', 'INSUFFICIENT', 'UNAVAILABLE')
    AND (account_id IS NULL OR length(btrim(account_id)) > 0)
    AND jsonb_typeof(receipt_json) = 'object'
  )
);
--> statement-breakpoint
CREATE INDEX trader_information_sufficiency_receipt_v2_scope_idx
  ON public.trader_information_sufficiency_receipt_v2 (
    organization_id, account_id, purpose, pit_anchor
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_required_information_profile_v2_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  exact_json jsonb;
  expected_digest text;
BEGIN
  exact_json := jsonb_build_object(
    'id', NEW.id,
    'schemaVersion', NEW.schema_version,
    'organizationId', NEW.organization_id::text,
    'accountId', NEW.account_id,
    'profileVersion', NEW.profile_version,
    'purpose', NEW.purpose,
    'symbol', NEW.symbol,
    'venue', NEW.venue,
    'analyticalTimeframe', NEW.analytical_timeframe,
    'horizon', NEW.horizon,
    'forecastPackageId', NEW.profile_json -> 'forecastPackageId',
    'forecastPackageContentDigest', NEW.profile_json -> 'forecastPackageContentDigest',
    'inputContractContentDigest', NEW.profile_json -> 'inputContractContentDigest',
    'requirements', NEW.profile_json -> 'requirements',
    'aggregateQualityContract', NEW.profile_json -> 'aggregateQualityContract',
    'authority', NEW.authority,
    'contentDigest', NEW.content_digest
  );
  IF NEW.profile_json IS DISTINCT FROM exact_json THEN
    RAISE EXCEPTION 'RequiredInformationProfileV2 row/JSON mismatch or forbidden field'
      USING ERRCODE = 'check_violation';
  END IF;

  expected_digest := encode(sha256(convert_to(public.waia_canonical_jsonb_v1(
    exact_json - ARRAY['id', 'contentDigest']
  ), 'UTF8')), 'hex');
  IF NEW.id IS DISTINCT FROM expected_digest
    OR NEW.content_digest IS DISTINCT FROM expected_digest
  THEN
    RAISE EXCEPTION 'RequiredInformationProfileV2 content digest mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_required_information_profile_v2_guard
  BEFORE INSERT ON public.trader_required_information_profile_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_required_information_profile_v2_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_information_sufficiency_receipt_v2_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  exact_json jsonb;
  expected_digest text;
  profile_row public.trader_required_information_profile_v2%ROWTYPE;
BEGIN
  SELECT * INTO profile_row
  FROM public.trader_required_information_profile_v2 profile
  WHERE profile.id = NEW.profile_id
    AND profile.organization_id = NEW.organization_id
    AND profile.content_digest = NEW.profile_content_digest;
  IF NOT FOUND
    OR profile_row.account_id IS DISTINCT FROM NEW.account_id
    OR profile_row.purpose IS DISTINCT FROM NEW.purpose
  THEN
    RAISE EXCEPTION 'InformationSufficiencyReceiptV2 profile scope mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  exact_json := jsonb_build_object(
    'id', NEW.id,
    'schemaVersion', NEW.schema_version,
    'organizationId', NEW.organization_id::text,
    'accountId', NEW.account_id,
    'profileId', NEW.profile_id,
    'profileVersion', NEW.receipt_json -> 'profileVersion',
    'profileContentDigest', NEW.profile_content_digest,
    'purpose', NEW.purpose,
    'symbol', NEW.receipt_json -> 'symbol',
    'venue', NEW.receipt_json -> 'venue',
    'analyticalTimeframe', NEW.receipt_json -> 'analyticalTimeframe',
    'horizon', NEW.receipt_json -> 'horizon',
    'pitAnchor', NEW.receipt_json -> 'pitAnchor',
    'forecastPackageId', NEW.receipt_json -> 'forecastPackageId',
    'forecastPackageContentDigest', NEW.receipt_json -> 'forecastPackageContentDigest',
    'inputContractContentDigest', NEW.receipt_json -> 'inputContractContentDigest',
    'activeContextTriggers', NEW.receipt_json -> 'activeContextTriggers',
    'evidenceInventory', NEW.receipt_json -> 'evidenceInventory',
    'requirementReceipts', NEW.receipt_json -> 'requirementReceipts',
    'aggregateQualityEvaluation', NEW.receipt_json -> 'aggregateQualityEvaluation',
    'status', NEW.status,
    'reasonCodes', NEW.receipt_json -> 'reasonCodes',
    'authority', NEW.authority,
    'contentDigest', NEW.content_digest
  );
  IF NEW.receipt_json IS DISTINCT FROM exact_json
    OR (NEW.receipt_json ->> 'pitAnchor')::timestamptz IS DISTINCT FROM NEW.pit_anchor
    OR NEW.receipt_json ->> 'profileVersion' IS DISTINCT FROM profile_row.profile_version
    OR NEW.receipt_json ->> 'symbol' IS DISTINCT FROM profile_row.symbol
    OR NEW.receipt_json ->> 'venue' IS DISTINCT FROM profile_row.venue
    OR NEW.receipt_json ->> 'analyticalTimeframe' IS DISTINCT FROM profile_row.analytical_timeframe
    OR NEW.receipt_json ->> 'horizon' IS DISTINCT FROM profile_row.horizon
  THEN
    RAISE EXCEPTION 'InformationSufficiencyReceiptV2 row/JSON/profile mismatch or forbidden field'
      USING ERRCODE = 'check_violation';
  END IF;

  expected_digest := encode(sha256(convert_to(public.waia_canonical_jsonb_v1(
    exact_json - ARRAY['id', 'contentDigest']
  ), 'UTF8')), 'hex');
  IF NEW.id IS DISTINCT FROM expected_digest
    OR NEW.content_digest IS DISTINCT FROM expected_digest
  THEN
    RAISE EXCEPTION 'InformationSufficiencyReceiptV2 content digest mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_information_sufficiency_receipt_v2_guard
  BEFORE INSERT ON public.trader_information_sufficiency_receipt_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_information_sufficiency_receipt_v2_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_information_sufficiency_v2_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_required_information_profile_v2_block_update
  BEFORE UPDATE ON public.trader_required_information_profile_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_information_sufficiency_v2_block_mutation();
CREATE TRIGGER trader_required_information_profile_v2_block_delete
  BEFORE DELETE ON public.trader_required_information_profile_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_information_sufficiency_v2_block_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_information_sufficiency_receipt_v2_block_update
  BEFORE UPDATE ON public.trader_information_sufficiency_receipt_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_information_sufficiency_v2_block_mutation();
CREATE TRIGGER trader_information_sufficiency_receipt_v2_block_delete
  BEFORE DELETE ON public.trader_information_sufficiency_receipt_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_information_sufficiency_v2_block_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_required_information_profile_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY trader_required_information_profile_v2_deny_client_all
  ON public.trader_required_information_profile_v2 FOR ALL
  TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE public.trader_information_sufficiency_receipt_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY trader_information_sufficiency_receipt_v2_deny_client_all
  ON public.trader_information_sufficiency_receipt_v2 FOR ALL
  TO authenticated, anon USING (false) WITH CHECK (false);
