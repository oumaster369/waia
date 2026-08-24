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
CREATE OR REPLACE FUNCTION public.waia_jsonb_exact_keys_v2(value jsonb, expected_keys text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND value ?& expected_keys
    AND value - expected_keys = '{}'::jsonb
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_jsonb_canonical_string_array_v2(
  value jsonb,
  allow_empty boolean DEFAULT true
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND (allow_empty OR jsonb_array_length(value) > 0)
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(value) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
        OR length(btrim(item.value #>> '{}')) = 0
    )
    AND jsonb_array_length(value) = (
      SELECT count(DISTINCT item.value #>> '{}')
      FROM jsonb_array_elements(value) AS item(value)
    )
    AND value = COALESCE((
      SELECT jsonb_agg(item.value ORDER BY item.value #>> '{}' COLLATE "C")
      FROM jsonb_array_elements(value) AS item(value)
    ), '[]'::jsonb)
$$;
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

  IF NOT (
      (
        jsonb_typeof(NEW.profile_json -> 'forecastPackageId') = 'null'
        AND jsonb_typeof(NEW.profile_json -> 'forecastPackageContentDigest') = 'null'
      )
      OR (
        jsonb_typeof(NEW.profile_json -> 'forecastPackageId') = 'string'
        AND length(btrim(NEW.profile_json ->> 'forecastPackageId')) > 0
        AND jsonb_typeof(NEW.profile_json -> 'forecastPackageContentDigest') = 'string'
        AND NEW.profile_json ->> 'forecastPackageContentDigest' ~ '^[0-9a-f]{64}$'
      )
    )
    OR NOT (
      jsonb_typeof(NEW.profile_json -> 'inputContractContentDigest') = 'null'
      OR (
        jsonb_typeof(NEW.profile_json -> 'inputContractContentDigest') = 'string'
        AND NEW.profile_json ->> 'inputContractContentDigest' ~ '^[0-9a-f]{64}$'
      )
    )
    OR jsonb_typeof(NEW.profile_json -> 'requirements') <> 'array'
    OR jsonb_array_length(NEW.profile_json -> 'requirements') = 0
    OR NEW.profile_json -> 'requirements' <> (
      SELECT jsonb_agg(requirement.value ORDER BY requirement.value ->> 'id' COLLATE "C")
      FROM jsonb_array_elements(NEW.profile_json -> 'requirements') AS requirement(value)
    )
    OR jsonb_array_length(NEW.profile_json -> 'requirements') <> (
      SELECT count(DISTINCT requirement.value ->> 'id')
      FROM jsonb_array_elements(NEW.profile_json -> 'requirements') AS requirement(value)
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.profile_json -> 'requirements') AS requirement(value)
      WHERE NOT public.waia_jsonb_exact_keys_v2(requirement.value, ARRAY[
        'id', 'questionId', 'classification', 'contextTriggerKey', 'satisfiers',
        'allowedObservationKinds', 'allowedObservationSchemaVersions',
        'allowedMeasurementDefinitionDigests', 'maxStalenessMs', 'minimumTrustScore',
        'minimumIndependentGroups', 'contradictionPolicy', 'requirePitQualified',
        'requireReplayEligible', 'inquiryBounds'
      ])
        OR jsonb_typeof(requirement.value -> 'id') <> 'string'
        OR length(btrim(requirement.value ->> 'id')) = 0
        OR requirement.value ->> 'questionId' NOT IN (
          'Q_WHAT_HAPPENING', 'Q_WHY_HAPPENING', 'Q_CROSS_TIMEFRAME_RELATIONSHIP',
          'Q_UNKNOWN_OR_CONTRADICTORY', 'Q_EXECUTION_LIQUIDITY', 'Q_HISTORICAL_ANALOGUES'
        )
        OR requirement.value ->> 'classification' NOT IN (
          'MANDATORY', 'CONTEXT_TRIGGERED', 'OPTIONAL_ENRICHMENT'
        )
        OR (
          requirement.value ->> 'classification' = 'CONTEXT_TRIGGERED'
          AND (
            jsonb_typeof(requirement.value -> 'contextTriggerKey') <> 'string'
            OR length(btrim(requirement.value ->> 'contextTriggerKey')) = 0
          )
        )
        OR (
          requirement.value ->> 'classification' <> 'CONTEXT_TRIGGERED'
          AND jsonb_typeof(requirement.value -> 'contextTriggerKey') <> 'null'
        )
        OR jsonb_typeof(requirement.value -> 'satisfiers') <> 'array'
        OR jsonb_array_length(requirement.value -> 'satisfiers') = 0
        OR NOT public.waia_jsonb_canonical_string_array_v2(
          requirement.value -> 'allowedObservationKinds', false
        )
        OR NOT public.waia_jsonb_canonical_string_array_v2(
          requirement.value -> 'allowedObservationSchemaVersions', false
        )
        OR NOT public.waia_jsonb_canonical_string_array_v2(
          requirement.value -> 'allowedMeasurementDefinitionDigests'
        )
        OR jsonb_typeof(requirement.value -> 'minimumIndependentGroups') <> 'number'
        OR (requirement.value ->> 'minimumIndependentGroups')::numeric < 1
        OR (requirement.value ->> 'minimumIndependentGroups')::numeric > 9007199254740991
        OR trunc((requirement.value ->> 'minimumIndependentGroups')::numeric)
          <> (requirement.value ->> 'minimumIndependentGroups')::numeric
        OR jsonb_typeof(requirement.value -> 'contradictionPolicy') <> 'string'
        OR requirement.value ->> 'contradictionPolicy' NOT IN (
          'RECORD_ONLY', 'FAIL_UNRESOLVED', 'REQUIRE_AGREEMENT'
        )
        OR jsonb_typeof(requirement.value -> 'requirePitQualified') <> 'boolean'
        OR jsonb_typeof(requirement.value -> 'requireReplayEligible') <> 'boolean'
        OR NOT public.waia_jsonb_exact_keys_v2(
          requirement.value -> 'inquiryBounds',
          ARRAY['maxDepth', 'maxDurationMs', 'maxProviderFanout']
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_each(requirement.value -> 'inquiryBounds') AS bound(key, value)
          WHERE jsonb_typeof(bound.value) <> 'number'
            OR (bound.value #>> '{}')::numeric < 0
            OR (bound.value #>> '{}')::numeric > 9007199254740991
            OR trunc((bound.value #>> '{}')::numeric) <> (bound.value #>> '{}')::numeric
        )
        OR (
          jsonb_typeof(requirement.value -> 'maxStalenessMs') NOT IN ('null', 'number')
          OR (
            jsonb_typeof(requirement.value -> 'maxStalenessMs') = 'number'
            AND (
              (requirement.value ->> 'maxStalenessMs')::numeric < 0
              OR (requirement.value ->> 'maxStalenessMs')::numeric > 9007199254740991
              OR trunc((requirement.value ->> 'maxStalenessMs')::numeric)
                <> (requirement.value ->> 'maxStalenessMs')::numeric
            )
          )
        )
        OR (
          jsonb_typeof(requirement.value -> 'minimumTrustScore') NOT IN ('null', 'number')
          OR (
            jsonb_typeof(requirement.value -> 'minimumTrustScore') = 'number'
            AND (requirement.value ->> 'minimumTrustScore')::numeric NOT BETWEEN 0 AND 1
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.profile_json -> 'requirements') AS requirement(value)
      CROSS JOIN LATERAL jsonb_array_elements(requirement.value -> 'satisfiers')
        WITH ORDINALITY AS satisfier(value, ordinality)
      WHERE NOT public.waia_jsonb_exact_keys_v2(
          satisfier.value, ARRAY['evidenceFamily', 'providerIds', 'substitutionRuleId']
        )
        OR jsonb_typeof(satisfier.value -> 'evidenceFamily') <> 'string'
        OR length(btrim(satisfier.value ->> 'evidenceFamily')) = 0
        OR NOT public.waia_jsonb_canonical_string_array_v2(satisfier.value -> 'providerIds')
        OR (
          satisfier.ordinality = 1
          AND jsonb_typeof(satisfier.value -> 'substitutionRuleId') <> 'null'
        )
        OR (
          satisfier.ordinality > 1
          AND (
            jsonb_typeof(satisfier.value -> 'substitutionRuleId') <> 'string'
            OR length(btrim(satisfier.value ->> 'substitutionRuleId')) = 0
          )
        )
        OR (
          satisfier.ordinality > 2
          AND concat(
            satisfier.value ->> 'evidenceFamily', ':',
            satisfier.value ->> 'substitutionRuleId'
          ) COLLATE "C" < (
            SELECT concat(
              previous.value ->> 'evidenceFamily', ':',
              previous.value ->> 'substitutionRuleId'
            ) COLLATE "C"
            FROM jsonb_array_elements(requirement.value -> 'satisfiers')
              WITH ORDINALITY AS previous(value, ordinality)
            WHERE previous.ordinality = satisfier.ordinality - 1
          )
        )
        OR (
          SELECT count(DISTINCT (family.value ->> 'evidenceFamily') COLLATE "C")
          FROM jsonb_array_elements(requirement.value -> 'satisfiers') AS family(value)
        ) <> jsonb_array_length(requirement.value -> 'satisfiers')
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.profile_json -> 'requirements') AS requirement(value)
      CROSS JOIN LATERAL jsonb_array_elements(
        requirement.value -> 'allowedObservationKinds'
      ) AS kind(value)
      WHERE jsonb_typeof(kind.value) <> 'string'
        OR kind.value #>> '{}' NOT IN (
          'msv_envelope', 'ohlcv_bar', 'quote_l1', 'order_book_snapshot',
          'market_trades_snapshot', 'fear_greed_index', 'news_headline'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.profile_json -> 'requirements') AS requirement(value)
      CROSS JOIN LATERAL jsonb_array_elements(
        requirement.value -> 'allowedObservationSchemaVersions'
      ) AS version(value)
      WHERE jsonb_typeof(version.value) <> 'string'
        OR length(btrim(version.value #>> '{}')) = 0
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.profile_json -> 'requirements') AS requirement(value)
      CROSS JOIN LATERAL jsonb_array_elements(
        requirement.value -> 'allowedMeasurementDefinitionDigests'
      ) AS digest(value)
      WHERE jsonb_typeof(digest.value) <> 'string'
        OR digest.value #>> '{}' !~ '^[0-9a-f]{64}$'
    )
    OR (
      jsonb_typeof(NEW.profile_json -> 'aggregateQualityContract') <> 'null'
      AND (
        NOT public.waia_jsonb_exact_keys_v2(
          NEW.profile_json -> 'aggregateQualityContract',
          ARRAY['evaluatorVersion', 'evaluatorContentDigest']
        )
        OR jsonb_typeof(NEW.profile_json #> '{aggregateQualityContract,evaluatorVersion}')
          <> 'string'
        OR length(btrim(NEW.profile_json #>> '{aggregateQualityContract,evaluatorVersion}')) = 0
        OR NEW.profile_json #>> '{aggregateQualityContract,evaluatorContentDigest}'
          !~ '^[0-9a-f]{64}$'
      )
    )
  THEN
    RAISE EXCEPTION 'RequiredInformationProfileV2 nested contract mismatch'
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
    OR NEW.receipt_json -> 'forecastPackageId'
      IS DISTINCT FROM profile_row.profile_json -> 'forecastPackageId'
    OR NEW.receipt_json -> 'forecastPackageContentDigest'
      IS DISTINCT FROM profile_row.profile_json -> 'forecastPackageContentDigest'
    OR NEW.receipt_json -> 'inputContractContentDigest'
      IS DISTINCT FROM profile_row.profile_json -> 'inputContractContentDigest'
  THEN
    RAISE EXCEPTION 'InformationSufficiencyReceiptV2 row/JSON/profile mismatch or forbidden field'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.receipt_json ->> 'pitAnchor' !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR to_char(
      (NEW.receipt_json ->> 'pitAnchor')::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) IS DISTINCT FROM NEW.receipt_json ->> 'pitAnchor'
    OR NOT public.waia_jsonb_canonical_string_array_v2(
      NEW.receipt_json -> 'activeContextTriggers'
    )
    OR jsonb_typeof(NEW.receipt_json -> 'evidenceInventory') <> 'array'
    OR jsonb_typeof(NEW.receipt_json -> 'requirementReceipts') <> 'array'
    OR jsonb_array_length(NEW.receipt_json -> 'requirementReceipts')
      <> jsonb_array_length(profile_row.profile_json -> 'requirements')
    OR NOT public.waia_jsonb_canonical_string_array_v2(NEW.receipt_json -> 'reasonCodes')
    OR NEW.receipt_json -> 'evidenceInventory' <> COALESCE((
      SELECT jsonb_agg(
        evidence.value ORDER BY concat(
          evidence.value ->> 'evidenceId', ':',
          evidence.value ->> 'observationContentDigest', ':',
          COALESCE(evidence.value ->> 'measurementValueContentDigest', '')
        ) COLLATE "C"
      )
      FROM jsonb_array_elements(NEW.receipt_json -> 'evidenceInventory') AS evidence(value)
    ), '[]'::jsonb)
    OR jsonb_array_length(NEW.receipt_json -> 'evidenceInventory') <> (
      SELECT count(DISTINCT evidence.value ->> 'evidenceId')
      FROM jsonb_array_elements(NEW.receipt_json -> 'evidenceInventory') AS evidence(value)
    )
    OR NEW.receipt_json -> 'requirementReceipts' <> COALESCE((
      SELECT jsonb_agg(result.value ORDER BY result.value ->> 'requirementId' COLLATE "C")
      FROM jsonb_array_elements(NEW.receipt_json -> 'requirementReceipts') AS result(value)
    ), '[]'::jsonb)
    OR jsonb_array_length(NEW.receipt_json -> 'requirementReceipts') <> (
      SELECT count(DISTINCT result.value ->> 'requirementId')
      FROM jsonb_array_elements(NEW.receipt_json -> 'requirementReceipts') AS result(value)
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.receipt_json -> 'evidenceInventory') AS evidence(value)
      WHERE NOT public.waia_jsonb_exact_keys_v2(evidence.value, ARRAY[
        'evidenceId', 'evidenceFamily', 'providerId', 'sourceId', 'observationId',
        'observationKind', 'observationSchemaVersion', 'observationContentDigest',
        'trustAsOfReceiptId', 'trustRevisionId', 'trustRevisionContentDigest',
        'measurementDefinitionId', 'measurementDefinitionContentDigest',
        'measurementValueId', 'measurementValueContentDigest', 'availability',
        'availableAt', 'trust', 'trustScore', 'pitQualified', 'replayEligible',
        'dependenceGroup', 'contradictionGroup', 'contradiction', 'epistemicRole',
        'historyScope', 'degradationReasonCodes'
      ])
        OR EXISTS (
          SELECT 1
          FROM jsonb_each(evidence.value) AS field(key, value)
          WHERE field.key IN (
            'evidenceId', 'evidenceFamily', 'providerId', 'sourceId', 'observationId',
            'observationKind', 'observationSchemaVersion', 'observationContentDigest',
            'availability', 'availableAt', 'trust', 'dependenceGroup', 'contradiction',
            'epistemicRole', 'historyScope'
          )
            AND (
              jsonb_typeof(field.value) <> 'string'
              OR length(btrim(field.value #>> '{}')) = 0
            )
        )
        OR evidence.value ->> 'observationKind' NOT IN (
          'msv_envelope', 'ohlcv_bar', 'quote_l1', 'order_book_snapshot',
          'market_trades_snapshot', 'fear_greed_index', 'news_headline'
        )
        OR evidence.value ->> 'availability' NOT IN ('AVAILABLE', 'UNAVAILABLE', 'REJECTED')
        OR evidence.value ->> 'trust' NOT IN ('TRUSTED', 'UNTRUSTED', 'UNKNOWN')
        OR evidence.value ->> 'contradiction' NOT IN (
          'NONE', 'SUPPORTS', 'CONTRADICTS', 'UNRESOLVED'
        )
        OR evidence.value ->> 'epistemicRole' NOT IN (
          'PRICE_STATE', 'CAUSAL', 'CORROBORATING', 'EXECUTION_LIQUIDITY',
          'HISTORICAL_ANALOGUE'
        )
        OR evidence.value ->> 'historyScope' NOT IN (
          'NOT_HISTORICAL', 'DEVELOPMENT', 'ADMISSIBLE_PATTERN_KNOWLEDGE'
        )
        OR evidence.value ->> 'observationContentDigest' !~ '^[0-9a-f]{64}$'
        OR evidence.value ->> 'availableAt' !~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
        OR to_char(
          (evidence.value ->> 'availableAt')::timestamptz AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) IS DISTINCT FROM evidence.value ->> 'availableAt'
        OR jsonb_typeof(evidence.value -> 'pitQualified') <> 'boolean'
        OR jsonb_typeof(evidence.value -> 'replayEligible') <> 'boolean'
        OR NOT public.waia_jsonb_canonical_string_array_v2(
          evidence.value -> 'degradationReasonCodes'
        )
        OR (
          jsonb_typeof(evidence.value -> 'trustScore') NOT IN ('null', 'number')
          OR (
            jsonb_typeof(evidence.value -> 'trustScore') = 'number'
            AND (evidence.value ->> 'trustScore')::numeric NOT BETWEEN 0 AND 1
          )
        )
        OR (
          evidence.value ->> 'observationKind' = 'msv_envelope'
          AND (
            jsonb_typeof(evidence.value -> 'trustAsOfReceiptId') <> 'null'
            OR jsonb_typeof(evidence.value -> 'trustRevisionId') <> 'null'
            OR jsonb_typeof(evidence.value -> 'trustRevisionContentDigest') <> 'null'
          )
        )
        OR (
          evidence.value ->> 'observationKind' <> 'msv_envelope'
          AND (
            evidence.value ->> 'trustAsOfReceiptId' !~ '^[0-9a-f]{64}$'
            OR jsonb_typeof(evidence.value -> 'trustRevisionId') <> 'string'
            OR length(btrim(evidence.value ->> 'trustRevisionId')) = 0
            OR evidence.value ->> 'trustRevisionContentDigest' !~ '^[0-9a-f]{64}$'
          )
        )
        OR NOT (
          (
            jsonb_typeof(evidence.value -> 'measurementDefinitionId') = 'null'
            AND jsonb_typeof(evidence.value -> 'measurementDefinitionContentDigest') = 'null'
            AND jsonb_typeof(evidence.value -> 'measurementValueId') = 'null'
            AND jsonb_typeof(evidence.value -> 'measurementValueContentDigest') = 'null'
          )
          OR (
            jsonb_typeof(evidence.value -> 'measurementDefinitionId') = 'string'
            AND length(btrim(evidence.value ->> 'measurementDefinitionId')) > 0
            AND evidence.value ->> 'measurementDefinitionContentDigest' ~ '^[0-9a-f]{64}$'
            AND jsonb_typeof(evidence.value -> 'measurementValueId') = 'string'
            AND length(btrim(evidence.value ->> 'measurementValueId')) > 0
            AND evidence.value ->> 'measurementValueContentDigest' ~ '^[0-9a-f]{64}$'
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.receipt_json -> 'requirementReceipts') AS result(value)
      WHERE NOT public.waia_jsonb_exact_keys_v2(result.value, ARRAY[
        'requirementId', 'questionId', 'classification', 'active', 'terminalStatus',
        'blocking', 'matchedEvidenceIds', 'acceptedEvidenceIds',
        'effectiveIndependentGroups', 'substitutionsUsed', 'reasonCodes'
      ])
        OR jsonb_typeof(result.value -> 'requirementId') <> 'string'
        OR length(btrim(result.value ->> 'requirementId')) = 0
        OR result.value ->> 'questionId' NOT IN (
          'Q_WHAT_HAPPENING', 'Q_WHY_HAPPENING', 'Q_CROSS_TIMEFRAME_RELATIONSHIP',
          'Q_UNKNOWN_OR_CONTRADICTORY', 'Q_EXECUTION_LIQUIDITY', 'Q_HISTORICAL_ANALOGUES'
        )
        OR result.value ->> 'classification' NOT IN (
          'MANDATORY', 'CONTEXT_TRIGGERED', 'OPTIONAL_ENRICHMENT'
        )
        OR result.value ->> 'terminalStatus' NOT IN (
          'ANSWERED_SUFFICIENTLY', 'INSUFFICIENT_NON_BLOCKING', 'INSUFFICIENT_BLOCKING',
          'UNRESOLVED_CONTRADICTION', 'UNAVAILABLE', 'NOT_REQUIRED', 'NOT_APPLICABLE'
        )
        OR jsonb_typeof(result.value -> 'active') <> 'boolean'
        OR jsonb_typeof(result.value -> 'blocking') <> 'boolean'
        OR NOT public.waia_jsonb_canonical_string_array_v2(
          result.value -> 'matchedEvidenceIds'
        )
        OR NOT public.waia_jsonb_canonical_string_array_v2(
          result.value -> 'acceptedEvidenceIds'
        )
        OR NOT public.waia_jsonb_canonical_string_array_v2(
          result.value -> 'effectiveIndependentGroups'
        )
        OR jsonb_typeof(result.value -> 'substitutionsUsed') <> 'array'
        OR NOT public.waia_jsonb_canonical_string_array_v2(result.value -> 'reasonCodes')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(result.value -> 'substitutionsUsed') AS substitution(value)
          WHERE NOT public.waia_jsonb_exact_keys_v2(
              substitution.value, ARRAY['evidenceId', 'substitutionRuleId']
            )
            OR jsonb_typeof(substitution.value -> 'evidenceId') <> 'string'
            OR length(btrim(substitution.value ->> 'evidenceId')) = 0
            OR jsonb_typeof(substitution.value -> 'substitutionRuleId') <> 'string'
            OR length(btrim(substitution.value ->> 'substitutionRuleId')) = 0
        )
        OR result.value -> 'substitutionsUsed' <> COALESCE((
          SELECT jsonb_agg(
            substitution.value ORDER BY concat(
              substitution.value ->> 'evidenceId', ':',
              substitution.value ->> 'substitutionRuleId'
            ) COLLATE "C"
          )
          FROM jsonb_array_elements(result.value -> 'substitutionsUsed') AS substitution(value)
        ), '[]'::jsonb)
        OR jsonb_array_length(result.value -> 'substitutionsUsed') <> (
          SELECT count(DISTINCT substitution.value ->> 'evidenceId')
          FROM jsonb_array_elements(result.value -> 'substitutionsUsed') AS substitution(value)
        )
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(profile_row.profile_json -> 'requirements') AS requirement(value)
          WHERE requirement.value ->> 'id' = result.value ->> 'requirementId'
            AND requirement.value ->> 'questionId' = result.value ->> 'questionId'
            AND requirement.value ->> 'classification' = result.value ->> 'classification'
        )
    )
    OR (
      jsonb_typeof(NEW.receipt_json -> 'aggregateQualityEvaluation') <> 'null'
      AND (
        NOT public.waia_jsonb_exact_keys_v2(
          NEW.receipt_json -> 'aggregateQualityEvaluation',
          ARRAY[
            'evaluatorVersion', 'evaluatorContentDigest', 'status', 'componentReceipts',
            'aggregateValueDigest', 'reasonCodes'
          ]
        )
        OR jsonb_typeof(
          NEW.receipt_json #> '{aggregateQualityEvaluation,evaluatorVersion}'
        ) <> 'string'
        OR length(btrim(
          NEW.receipt_json #>> '{aggregateQualityEvaluation,evaluatorVersion}'
        )) = 0
        OR NEW.receipt_json #>> '{aggregateQualityEvaluation,evaluatorContentDigest}'
          !~ '^[0-9a-f]{64}$'
        OR NEW.receipt_json #>> '{aggregateQualityEvaluation,status}'
          NOT IN ('PASS', 'FAIL', 'UNAVAILABLE')
        OR jsonb_typeof(
          NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}'
        ) <> 'array'
        OR jsonb_typeof(NEW.receipt_json #> '{aggregateQualityEvaluation,reasonCodes}')
          <> 'array'
        OR NOT public.waia_jsonb_canonical_string_array_v2(
          NEW.receipt_json #> '{aggregateQualityEvaluation,reasonCodes}'
        )
        OR jsonb_typeof(NEW.receipt_json #> '{aggregateQualityEvaluation,aggregateValueDigest}')
          NOT IN ('null', 'string')
        OR (
          jsonb_typeof(
            NEW.receipt_json #> '{aggregateQualityEvaluation,aggregateValueDigest}'
          ) = 'string'
          AND NEW.receipt_json #>> '{aggregateQualityEvaluation,aggregateValueDigest}'
            !~ '^[0-9a-f]{64}$'
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}'
          ) AS component(value)
          WHERE NOT public.waia_jsonb_exact_keys_v2(
              component.value, ARRAY['componentId', 'valueDigest']
            )
            OR jsonb_typeof(component.value -> 'componentId') <> 'string'
            OR length(btrim(component.value ->> 'componentId')) = 0
            OR component.value ->> 'valueDigest' !~ '^[0-9a-f]{64}$'
        )
        OR NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}' <> COALESCE((
          SELECT jsonb_agg(component.value ORDER BY component.value ->> 'componentId' COLLATE "C")
          FROM jsonb_array_elements(
            NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}'
          ) AS component(value)
        ), '[]'::jsonb)
        OR jsonb_array_length(
          NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}'
        ) <> (
          SELECT count(DISTINCT component.value ->> 'componentId')
          FROM jsonb_array_elements(
            NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}'
          ) AS component(value)
        )
      )
    )
    OR (
      jsonb_typeof(profile_row.profile_json -> 'aggregateQualityContract') = 'null'
      AND jsonb_typeof(NEW.receipt_json -> 'aggregateQualityEvaluation') <> 'null'
    )
    OR (
      jsonb_typeof(NEW.receipt_json -> 'aggregateQualityEvaluation') <> 'null'
      AND (
        NEW.receipt_json #>> '{aggregateQualityEvaluation,evaluatorVersion}'
          IS DISTINCT FROM profile_row.profile_json #>> '{aggregateQualityContract,evaluatorVersion}'
        OR NEW.receipt_json #>> '{aggregateQualityEvaluation,evaluatorContentDigest}'
          IS DISTINCT FROM profile_row.profile_json
            #>> '{aggregateQualityContract,evaluatorContentDigest}'
      )
    )
  THEN
    RAISE EXCEPTION 'InformationSufficiencyReceiptV2 nested contract mismatch'
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
