-- DEE-920 tranche A: permit current-cycle WALK_FORWARD evidence only after the
-- immutable WF_PREDICTIVE boundary. All other tenant, PIT, source, observation,
-- trust and canonical digest predicates remain byte-for-byte fail closed.

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
    AND (authority ->> 'wfPredictiveEndUtc')::timestamptz <=
      (authority ->> 'publicAvailableAt')::timestamptz
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
