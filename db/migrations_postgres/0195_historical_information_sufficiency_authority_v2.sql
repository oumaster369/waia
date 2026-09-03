-- DEE-919: extend the append-only InformationSufficiency receipt guard with an
-- exact, discriminated historical-dataset trust authority. Existing/live
-- evidence retains its original exact key set and accepted vocabulary.

CREATE OR REPLACE FUNCTION public.waia_historical_dataset_trust_authority_v2_valid(
  authority jsonb,
  evidence jsonb,
  receipt_organization_id uuid,
  receipt_symbol text,
  receipt_pit_anchor text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT COALESCE(
    jsonb_typeof(authority) = 'object'
    AND public.waia_jsonb_exact_keys_v2(authority, ARRAY[
      'schemaVersion', 'organizationId', 'runId', 'releaseSha',
      'ratifiedAdmissionId', 'ratifiedAdmissionContentDigestHex',
      'epistemicRecordCutoff', 'symbol', 'datasetAuthorityId',
      'datasetAuthorityContentDigestHex', 'datasetAuthorityDigestHex',
      'partitionRawSha256Hex', 'membershipContentDigestHex',
      'sealedCycleContentDigestHex', 'wfPredictiveSemanticContentDigestHex',
      'wfPredictiveStartUtc', 'wfPredictiveEndUtc', 'publicAvailableAt',
      'sourceId', 'trustRevisionId', 'trustRevisionContentDigestHex',
      'trustAsOfReceiptId', 'trustScore', 'observationId',
      'observationContentDigestHex', 'canonicalRecordAvailableAt',
      'canonicalRecordIngestTime', 'contentDigestHex'
    ])
    AND authority ->> 'schemaVersion' = 'historical-dataset-trust-authority-v2'
    AND authority ->> 'organizationId' = receipt_organization_id::text
    AND authority ->> 'symbol' = receipt_symbol
    AND authority ->> 'symbol' IN ('BTCUSDT', 'ETHUSDT')
    AND jsonb_typeof(authority -> 'runId') = 'string'
    AND length(btrim(authority ->> 'runId')) > 0
    AND authority ->> 'releaseSha' ~ '^[0-9a-f]{40}$'
    AND authority ->> 'ratifiedAdmissionId' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND authority ->> 'datasetAuthorityId' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND jsonb_typeof(authority -> 'sourceId') = 'string'
    AND length(btrim(authority ->> 'sourceId')) > 0
    AND jsonb_typeof(authority -> 'trustRevisionId') = 'string'
    AND length(btrim(authority ->> 'trustRevisionId')) > 0
    AND jsonb_typeof(authority -> 'observationId') = 'string'
    AND length(btrim(authority ->> 'observationId')) > 0
    AND authority ->> 'ratifiedAdmissionContentDigestHex' ~ '^[0-9a-f]{64}$'
    AND authority ->> 'datasetAuthorityContentDigestHex' ~ '^[0-9a-f]{64}$'
    AND authority ->> 'datasetAuthorityDigestHex' ~ '^[0-9a-f]{64}$'
    AND authority ->> 'partitionRawSha256Hex' ~ '^[0-9a-f]{64}$'
    AND authority ->> 'membershipContentDigestHex' ~ '^[0-9a-f]{64}$'
    AND authority ->> 'sealedCycleContentDigestHex' ~ '^[0-9a-f]{64}$'
    AND authority ->> 'wfPredictiveSemanticContentDigestHex' ~ '^[0-9a-f]{64}$'
    AND authority ->> 'trustAsOfReceiptId' ~ '^[0-9a-f]{64}$'
    AND authority ->> 'trustRevisionContentDigestHex' ~ '^[0-9a-f]{64}$'
    AND authority ->> 'observationContentDigestHex' ~ '^[0-9a-f]{64}$'
    AND authority ->> 'contentDigestHex' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(authority -> 'trustScore') = 'number'
    AND (authority ->> 'trustScore')::numeric BETWEEN 0 AND 1
    AND authority ->> 'sourceId' = evidence ->> 'sourceId'
    AND authority ->> 'observationId' = evidence ->> 'observationId'
    AND authority ->> 'observationContentDigestHex' =
      evidence ->> 'observationContentDigest'
    AND authority ->> 'trustAsOfReceiptId' = evidence ->> 'trustAsOfReceiptId'
    AND authority ->> 'trustRevisionId' = evidence ->> 'trustRevisionId'
    AND authority ->> 'trustRevisionContentDigestHex' =
      evidence ->> 'trustRevisionContentDigest'
    AND (authority ->> 'trustScore')::numeric = (evidence ->> 'trustScore')::numeric
    AND authority ->> 'publicAvailableAt' = evidence ->> 'availableAt'
    AND authority ->> 'publicAvailableAt' = authority ->> 'wfPredictiveEndUtc'
    AND authority ->> 'epistemicRecordCutoff' ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND authority ->> 'wfPredictiveStartUtc' ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND authority ->> 'wfPredictiveEndUtc' ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND authority ->> 'publicAvailableAt' ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND authority ->> 'canonicalRecordAvailableAt' ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND authority ->> 'canonicalRecordIngestTime' ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND to_char((authority ->> 'epistemicRecordCutoff')::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = authority ->> 'epistemicRecordCutoff'
    AND to_char((authority ->> 'wfPredictiveStartUtc')::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = authority ->> 'wfPredictiveStartUtc'
    AND to_char((authority ->> 'wfPredictiveEndUtc')::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = authority ->> 'wfPredictiveEndUtc'
    AND to_char((authority ->> 'publicAvailableAt')::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = authority ->> 'publicAvailableAt'
    AND to_char((authority ->> 'canonicalRecordAvailableAt')::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = authority ->> 'canonicalRecordAvailableAt'
    AND to_char((authority ->> 'canonicalRecordIngestTime')::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = authority ->> 'canonicalRecordIngestTime'
    AND (authority ->> 'wfPredictiveStartUtc')::timestamptz <
      (authority ->> 'wfPredictiveEndUtc')::timestamptz
    AND (authority ->> 'publicAvailableAt')::timestamptz <= receipt_pit_anchor::timestamptz
    AND (authority ->> 'publicAvailableAt')::timestamptz <=
      (authority ->> 'canonicalRecordAvailableAt')::timestamptz
    AND (authority ->> 'canonicalRecordAvailableAt')::timestamptz <=
      (authority ->> 'canonicalRecordIngestTime')::timestamptz
    AND (authority ->> 'canonicalRecordIngestTime')::timestamptz <=
      (authority ->> 'epistemicRecordCutoff')::timestamptz
    AND authority ->> 'contentDigestHex' = encode(sha256(convert_to(
      public.waia_canonical_jsonb_v1(authority - 'contentDigestHex'), 'UTF8'
    )), 'hex'),
    false
  );
$$;
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
    'id', NEW.id, 'schemaVersion', NEW.schema_version,
    'organizationId', NEW.organization_id::text, 'accountId', NEW.account_id,
    'profileId', NEW.profile_id, 'profileVersion', NEW.receipt_json -> 'profileVersion',
    'profileContentDigest', NEW.profile_content_digest, 'purpose', NEW.purpose,
    'symbol', NEW.receipt_json -> 'symbol', 'venue', NEW.receipt_json -> 'venue',
    'analyticalTimeframe', NEW.receipt_json -> 'analyticalTimeframe',
    'horizon', NEW.receipt_json -> 'horizon', 'pitAnchor', NEW.receipt_json -> 'pitAnchor',
    'forecastPackageId', NEW.receipt_json -> 'forecastPackageId',
    'forecastPackageContentDigest', NEW.receipt_json -> 'forecastPackageContentDigest',
    'inputContractContentDigest', NEW.receipt_json -> 'inputContractContentDigest',
    'activeContextTriggers', NEW.receipt_json -> 'activeContextTriggers',
    'evidenceInventory', NEW.receipt_json -> 'evidenceInventory',
    'requirementReceipts', NEW.receipt_json -> 'requirementReceipts',
    'aggregateQualityEvaluation', NEW.receipt_json -> 'aggregateQualityEvaluation',
    'status', NEW.status, 'reasonCodes', NEW.receipt_json -> 'reasonCodes',
    'authority', NEW.authority, 'contentDigest', NEW.content_digest
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
    OR to_char((NEW.receipt_json ->> 'pitAnchor')::timestamptz AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') IS DISTINCT FROM NEW.receipt_json ->> 'pitAnchor'
    OR NOT public.waia_jsonb_canonical_string_array_v2(
      NEW.receipt_json -> 'activeContextTriggers')
    OR jsonb_typeof(NEW.receipt_json -> 'evidenceInventory') <> 'array'
    OR jsonb_typeof(NEW.receipt_json -> 'requirementReceipts') <> 'array'
    OR jsonb_array_length(NEW.receipt_json -> 'requirementReceipts') <>
      jsonb_array_length(profile_row.profile_json -> 'requirements')
    OR NOT public.waia_jsonb_canonical_string_array_v2(NEW.receipt_json -> 'reasonCodes')
    OR NEW.receipt_json -> 'evidenceInventory' <> COALESCE((
      SELECT jsonb_agg(evidence.value ORDER BY concat(
        evidence.value ->> 'evidenceId', ':', evidence.value ->> 'observationContentDigest', ':',
        COALESCE(evidence.value ->> 'measurementValueContentDigest', '')) COLLATE "C")
      FROM jsonb_array_elements(NEW.receipt_json -> 'evidenceInventory') evidence(value)
    ), '[]'::jsonb)
    OR jsonb_array_length(NEW.receipt_json -> 'evidenceInventory') <> (
      SELECT count(DISTINCT evidence.value ->> 'evidenceId')
      FROM jsonb_array_elements(NEW.receipt_json -> 'evidenceInventory') evidence(value))
    OR NEW.receipt_json -> 'requirementReceipts' <> COALESCE((
      SELECT jsonb_agg(result.value ORDER BY result.value ->> 'requirementId' COLLATE "C")
      FROM jsonb_array_elements(NEW.receipt_json -> 'requirementReceipts') result(value)
    ), '[]'::jsonb)
    OR jsonb_array_length(NEW.receipt_json -> 'requirementReceipts') <> (
      SELECT count(DISTINCT result.value ->> 'requirementId')
      FROM jsonb_array_elements(NEW.receipt_json -> 'requirementReceipts') result(value))
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.receipt_json -> 'evidenceInventory') evidence(value)
      WHERE NOT (
        (evidence.value ->> 'historyScope' <> 'WALK_FORWARD_PREDICTIVE'
          AND public.waia_jsonb_exact_keys_v2(evidence.value, ARRAY[
            'evidenceId', 'evidenceFamily', 'providerId', 'sourceId', 'observationId',
            'observationKind', 'observationSchemaVersion', 'observationContentDigest',
            'trustAsOfReceiptId', 'trustRevisionId', 'trustRevisionContentDigest',
            'measurementDefinitionId', 'measurementDefinitionContentDigest',
            'measurementValueId', 'measurementValueContentDigest', 'availability',
            'availableAt', 'trust', 'trustScore', 'pitQualified', 'replayEligible',
            'dependenceGroup', 'contradictionGroup', 'contradiction', 'epistemicRole',
            'historyScope', 'degradationReasonCodes'
          ]))
        OR (evidence.value ->> 'historyScope' = 'WALK_FORWARD_PREDICTIVE'
          AND public.waia_jsonb_exact_keys_v2(evidence.value, ARRAY[
            'evidenceId', 'evidenceFamily', 'providerId', 'sourceId', 'observationId',
            'observationKind', 'observationSchemaVersion', 'observationContentDigest',
            'trustAsOfReceiptId', 'trustRevisionId', 'trustRevisionContentDigest',
            'measurementDefinitionId', 'measurementDefinitionContentDigest',
            'measurementValueId', 'measurementValueContentDigest', 'availability',
            'availableAt', 'trust', 'trustScore', 'pitQualified', 'replayEligible',
            'dependenceGroup', 'contradictionGroup', 'contradiction', 'epistemicRole',
            'historyScope', 'degradationReasonCodes', 'historicalDatasetTrustAuthority'
          ])
          AND public.waia_historical_dataset_trust_authority_v2_valid(
            evidence.value -> 'historicalDatasetTrustAuthority', evidence.value,
            NEW.organization_id, NEW.receipt_json ->> 'symbol',
            NEW.receipt_json ->> 'pitAnchor'))
      )
        OR EXISTS (
          SELECT 1 FROM jsonb_each(evidence.value) field(key, value)
          WHERE field.key IN (
            'evidenceId', 'evidenceFamily', 'providerId', 'sourceId', 'observationId',
            'observationKind', 'observationSchemaVersion', 'observationContentDigest',
            'availability', 'availableAt', 'trust', 'dependenceGroup', 'contradiction',
            'epistemicRole', 'historyScope')
          AND (jsonb_typeof(field.value) <> 'string'
            OR length(btrim(field.value #>> '{}')) = 0)
        )
        OR evidence.value ->> 'observationKind' NOT IN (
          'msv_envelope', 'ohlcv_bar', 'quote_l1', 'order_book_snapshot',
          'market_trades_snapshot', 'fear_greed_index', 'news_headline')
        OR evidence.value ->> 'availability' NOT IN ('AVAILABLE', 'UNAVAILABLE', 'REJECTED')
        OR evidence.value ->> 'trust' NOT IN ('TRUSTED', 'UNTRUSTED', 'UNKNOWN')
        OR evidence.value ->> 'contradiction' NOT IN (
          'NONE', 'SUPPORTS', 'CONTRADICTS', 'UNRESOLVED')
        OR evidence.value ->> 'epistemicRole' NOT IN (
          'PRICE_STATE', 'CAUSAL', 'CORROBORATING', 'EXECUTION_LIQUIDITY',
          'HISTORICAL_ANALOGUE')
        OR evidence.value ->> 'historyScope' NOT IN (
          'NOT_HISTORICAL', 'DEVELOPMENT', 'WALK_FORWARD_PREDICTIVE',
          'ADMISSIBLE_PATTERN_KNOWLEDGE')
        OR evidence.value ->> 'observationContentDigest' !~ '^[0-9a-f]{64}$'
        OR evidence.value ->> 'availableAt' !~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
        OR to_char((evidence.value ->> 'availableAt')::timestamptz AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') IS DISTINCT FROM evidence.value ->> 'availableAt'
        OR jsonb_typeof(evidence.value -> 'pitQualified') <> 'boolean'
        OR jsonb_typeof(evidence.value -> 'replayEligible') <> 'boolean'
        OR NOT public.waia_jsonb_canonical_string_array_v2(
          evidence.value -> 'degradationReasonCodes')
        OR (jsonb_typeof(evidence.value -> 'trustScore') NOT IN ('null', 'number')
          OR (jsonb_typeof(evidence.value -> 'trustScore') = 'number'
            AND (evidence.value ->> 'trustScore')::numeric NOT BETWEEN 0 AND 1))
        OR (evidence.value ->> 'observationKind' = 'msv_envelope' AND (
          jsonb_typeof(evidence.value -> 'trustAsOfReceiptId') <> 'null'
          OR jsonb_typeof(evidence.value -> 'trustRevisionId') <> 'null'
          OR jsonb_typeof(evidence.value -> 'trustRevisionContentDigest') <> 'null'))
        OR (evidence.value ->> 'observationKind' <> 'msv_envelope' AND (
          evidence.value ->> 'trustAsOfReceiptId' !~ '^[0-9a-f]{64}$'
          OR jsonb_typeof(evidence.value -> 'trustRevisionId') <> 'string'
          OR length(btrim(evidence.value ->> 'trustRevisionId')) = 0
          OR evidence.value ->> 'trustRevisionContentDigest' !~ '^[0-9a-f]{64}$'))
        OR NOT ((
          jsonb_typeof(evidence.value -> 'measurementDefinitionId') = 'null'
          AND jsonb_typeof(evidence.value -> 'measurementDefinitionContentDigest') = 'null'
          AND jsonb_typeof(evidence.value -> 'measurementValueId') = 'null'
          AND jsonb_typeof(evidence.value -> 'measurementValueContentDigest') = 'null'
        ) OR (
          jsonb_typeof(evidence.value -> 'measurementDefinitionId') = 'string'
          AND length(btrim(evidence.value ->> 'measurementDefinitionId')) > 0
          AND evidence.value ->> 'measurementDefinitionContentDigest' ~ '^[0-9a-f]{64}$'
          AND jsonb_typeof(evidence.value -> 'measurementValueId') = 'string'
          AND length(btrim(evidence.value ->> 'measurementValueId')) > 0
          AND evidence.value ->> 'measurementValueContentDigest' ~ '^[0-9a-f]{64}$'
        ))
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW.receipt_json -> 'requirementReceipts') result(value)
      WHERE NOT public.waia_jsonb_exact_keys_v2(result.value, ARRAY[
        'requirementId', 'questionId', 'classification', 'active', 'terminalStatus',
        'blocking', 'matchedEvidenceIds', 'acceptedEvidenceIds',
        'effectiveIndependentGroups', 'substitutionsUsed', 'reasonCodes'])
        OR jsonb_typeof(result.value -> 'requirementId') <> 'string'
        OR length(btrim(result.value ->> 'requirementId')) = 0
        OR result.value ->> 'questionId' NOT IN (
          'Q_WHAT_HAPPENING', 'Q_WHY_HAPPENING', 'Q_CROSS_TIMEFRAME_RELATIONSHIP',
          'Q_UNKNOWN_OR_CONTRADICTORY', 'Q_EXECUTION_LIQUIDITY', 'Q_HISTORICAL_ANALOGUES')
        OR result.value ->> 'classification' NOT IN (
          'MANDATORY', 'CONTEXT_TRIGGERED', 'OPTIONAL_ENRICHMENT')
        OR result.value ->> 'terminalStatus' NOT IN (
          'ANSWERED_SUFFICIENTLY', 'INSUFFICIENT_NON_BLOCKING', 'INSUFFICIENT_BLOCKING',
          'UNRESOLVED_CONTRADICTION', 'UNAVAILABLE', 'NOT_REQUIRED', 'NOT_APPLICABLE')
        OR jsonb_typeof(result.value -> 'active') <> 'boolean'
        OR jsonb_typeof(result.value -> 'blocking') <> 'boolean'
        OR NOT public.waia_jsonb_canonical_string_array_v2(result.value -> 'matchedEvidenceIds')
        OR NOT public.waia_jsonb_canonical_string_array_v2(result.value -> 'acceptedEvidenceIds')
        OR NOT public.waia_jsonb_canonical_string_array_v2(
          result.value -> 'effectiveIndependentGroups')
        OR jsonb_typeof(result.value -> 'substitutionsUsed') <> 'array'
        OR NOT public.waia_jsonb_canonical_string_array_v2(result.value -> 'reasonCodes')
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(result.value -> 'substitutionsUsed') substitution(value)
          WHERE NOT public.waia_jsonb_exact_keys_v2(
            substitution.value, ARRAY['evidenceId', 'substitutionRuleId'])
            OR jsonb_typeof(substitution.value -> 'evidenceId') <> 'string'
            OR length(btrim(substitution.value ->> 'evidenceId')) = 0
            OR jsonb_typeof(substitution.value -> 'substitutionRuleId') <> 'string'
            OR length(btrim(substitution.value ->> 'substitutionRuleId')) = 0)
        OR result.value -> 'substitutionsUsed' <> COALESCE((
          SELECT jsonb_agg(substitution.value ORDER BY concat(
            substitution.value ->> 'evidenceId', ':',
            substitution.value ->> 'substitutionRuleId') COLLATE "C")
          FROM jsonb_array_elements(result.value -> 'substitutionsUsed') substitution(value)
        ), '[]'::jsonb)
        OR jsonb_array_length(result.value -> 'substitutionsUsed') <> (
          SELECT count(DISTINCT substitution.value ->> 'evidenceId')
          FROM jsonb_array_elements(result.value -> 'substitutionsUsed') substitution(value))
        OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(profile_row.profile_json -> 'requirements') requirement(value)
          WHERE requirement.value ->> 'id' = result.value ->> 'requirementId'
            AND requirement.value ->> 'questionId' = result.value ->> 'questionId'
            AND requirement.value ->> 'classification' = result.value ->> 'classification'))
    OR (jsonb_typeof(NEW.receipt_json -> 'aggregateQualityEvaluation') <> 'null' AND (
      NOT public.waia_jsonb_exact_keys_v2(
        NEW.receipt_json -> 'aggregateQualityEvaluation', ARRAY[
          'evaluatorVersion', 'evaluatorContentDigest', 'status', 'componentReceipts',
          'aggregateValueDigest', 'reasonCodes'])
      OR jsonb_typeof(NEW.receipt_json #> '{aggregateQualityEvaluation,evaluatorVersion}') <>
        'string'
      OR length(btrim(NEW.receipt_json #>> '{aggregateQualityEvaluation,evaluatorVersion}')) = 0
      OR NEW.receipt_json #>> '{aggregateQualityEvaluation,evaluatorContentDigest}' !~
        '^[0-9a-f]{64}$'
      OR NEW.receipt_json #>> '{aggregateQualityEvaluation,status}' NOT IN
        ('PASS', 'FAIL', 'UNAVAILABLE')
      OR jsonb_typeof(NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}') <>
        'array'
      OR NOT public.waia_jsonb_canonical_string_array_v2(
        NEW.receipt_json #> '{aggregateQualityEvaluation,reasonCodes}')
      OR jsonb_typeof(NEW.receipt_json #> '{aggregateQualityEvaluation,aggregateValueDigest}')
        NOT IN ('null', 'string')
      OR (jsonb_typeof(NEW.receipt_json #> '{aggregateQualityEvaluation,aggregateValueDigest}') =
        'string' AND NEW.receipt_json #>> '{aggregateQualityEvaluation,aggregateValueDigest}' !~
        '^[0-9a-f]{64}$')
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}') component(value)
        WHERE NOT public.waia_jsonb_exact_keys_v2(
          component.value, ARRAY['componentId', 'valueDigest'])
          OR jsonb_typeof(component.value -> 'componentId') <> 'string'
          OR length(btrim(component.value ->> 'componentId')) = 0
          OR component.value ->> 'valueDigest' !~ '^[0-9a-f]{64}$')
      OR NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}' <> COALESCE((
        SELECT jsonb_agg(component.value ORDER BY component.value ->> 'componentId' COLLATE "C")
        FROM jsonb_array_elements(
          NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}') component(value)
      ), '[]'::jsonb)
      OR jsonb_array_length(
        NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}') <> (
        SELECT count(DISTINCT component.value ->> 'componentId')
        FROM jsonb_array_elements(
          NEW.receipt_json #> '{aggregateQualityEvaluation,componentReceipts}') component(value))))
    OR (jsonb_typeof(profile_row.profile_json -> 'aggregateQualityContract') = 'null'
      AND jsonb_typeof(NEW.receipt_json -> 'aggregateQualityEvaluation') <> 'null')
    OR (jsonb_typeof(NEW.receipt_json -> 'aggregateQualityEvaluation') <> 'null' AND (
      NEW.receipt_json #>> '{aggregateQualityEvaluation,evaluatorVersion}' IS DISTINCT FROM
        profile_row.profile_json #>> '{aggregateQualityContract,evaluatorVersion}'
      OR NEW.receipt_json #>> '{aggregateQualityEvaluation,evaluatorContentDigest}' IS DISTINCT FROM
        profile_row.profile_json #>> '{aggregateQualityContract,evaluatorContentDigest}'))
  THEN
    RAISE EXCEPTION 'InformationSufficiencyReceiptV2 nested contract mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  expected_digest := encode(sha256(convert_to(public.waia_canonical_jsonb_v1(
    exact_json - ARRAY['id', 'contentDigest']), 'UTF8')), 'hex');
  IF NEW.id IS DISTINCT FROM expected_digest OR NEW.content_digest IS DISTINCT FROM expected_digest
  THEN
    RAISE EXCEPTION 'InformationSufficiencyReceiptV2 content digest mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
