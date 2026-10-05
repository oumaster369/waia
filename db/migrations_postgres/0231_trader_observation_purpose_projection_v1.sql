-- DEE-1235: narrowly project validated observation-purpose eligibility before decrypt.
-- Keep 0229's immutable v1 predicate, generated column and SELECT grant for rollback.
-- Actual venue scopes remain in permission_metadata; this projection adds no authority.
--> statement-breakpoint
CREATE FUNCTION public.exchange_credential_observation_read_permitted(
  metadata text, expected_venue text, expected_account text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  policy jsonb;
  scopes jsonb;
  -- ECMAScript String.trim whitespace, matching htx-credential-types.ts.
  trim_chars CONSTANT text := chr(9) || chr(10) || chr(11) || chr(12) || chr(13)
    || ' ' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF expected_venue IS DISTINCT FROM 'htx' OR expected_account IS NULL
    OR btrim(expected_account, trim_chars) = ''
    OR expected_account <> btrim(expected_account, trim_chars)
    OR metadata IS NULL OR btrim(metadata) = '' THEN
    RETURN false;
  END IF;

  BEGIN
    policy := metadata::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  -- Preserve the immutable v1 acceptance rule, but never reinterpret an
  -- unknown/claimed purpose as a legacy read-only record.
  IF policy->'version' IS NOT DISTINCT FROM '1'::jsonb THEN
    IF policy ? 'purpose' THEN
      RETURN false;
    END IF;
    RETURN public.exchange_credential_observation_read_only(
      metadata, expected_venue, expected_account
    );
  END IF;

  IF policy->'version' IS DISTINCT FROM '2'::jsonb
    OR policy->'purpose' IS DISTINCT FROM '"observation"'::jsonb THEN
    RETURN false;
  END IF;

  -- Keep this exact allow-list in parity with the v2 server validator.
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(policy) AS keys(key_name)
    WHERE key_name NOT IN (
      'version', 'purpose', 'marketType', 'exchangeAccountId', 'scopes',
      'warnings', 'accountLabel', 'withdrawForbidden', 'transferForbidden'
    )
  ) THEN
    RETURN false;
  END IF;

  IF policy->'marketType' IS DISTINCT FROM '"spot"'::jsonb
    OR policy->'exchangeAccountId' IS DISTINCT FROM to_jsonb(expected_account)
    OR policy->'withdrawForbidden' IS DISTINCT FROM 'true'::jsonb
    OR policy->'transferForbidden' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(policy->'warnings') IS DISTINCT FROM 'array'
    OR (policy ? 'accountLabel' AND jsonb_typeof(policy->'accountLabel') IS DISTINCT FROM 'string')
    OR jsonb_typeof(policy->'scopes') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  scopes := policy->'scopes';
  IF jsonb_array_length(scopes) = 0 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(policy->'warnings') AS warnings(warning)
    WHERE jsonb_typeof(warning) IS DISTINCT FROM 'string'
  ) THEN
    RETURN false;
  END IF;

  -- V2 records preserve actual venue grants, so accept only unique read and
  -- optional trade scopes; unknown/withdraw/transfer scopes remain fail-closed.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(scopes) AS scopes_list(scope)
    WHERE scope IS DISTINCT FROM '"read"'::jsonb
      AND scope IS DISTINCT FROM '"trade"'::jsonb
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(scopes) AS scopes_list(scope)
    WHERE scope = '"read"'::jsonb
  ) THEN
    RETURN false;
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(scopes))
    <> (SELECT count(DISTINCT value) FROM jsonb_array_elements(scopes) AS entries(value)) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;
--> statement-breakpoint
ALTER TABLE public.exchange_credentials
  ADD COLUMN observation_read_permitted boolean
  GENERATED ALWAYS AS (
    public.exchange_credential_observation_read_permitted(permission_metadata, venue, exchange_account_id)
  ) STORED NOT NULL;
--> statement-breakpoint
GRANT SELECT (observation_read_permitted)
  ON public.exchange_credentials TO waia_account_observation_credential;
