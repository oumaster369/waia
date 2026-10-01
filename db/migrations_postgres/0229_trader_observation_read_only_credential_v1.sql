-- DEE-1151: decrypt only exact-account canonical HTX spot read-only policy.
-- Mirrors the stored read-purpose contract in htx-credential-types.ts, then
-- additionally excludes trade scopes. Metadata remains withheld from the role.
-- This new migration is unmerged/unapplied to production. Do not edit0000-0228.
--> statement-breakpoint
CREATE FUNCTION public.exchange_credential_observation_read_only(
  metadata text, expected_venue text, expected_account text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  policy jsonb;
  scopes jsonb;
  -- ECMAScript String.trim whitespace, matching the canonical stored policy.
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
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object'
    OR policy->'version' IS DISTINCT FROM '1'::jsonb
    OR policy->'marketType' IS DISTINCT FROM '"spot"'::jsonb
    OR policy->'exchangeAccountId' IS DISTINCT FROM to_jsonb(expected_account)
    OR policy->'withdrawForbidden' IS DISTINCT FROM 'true'::jsonb
    OR policy->'transferForbidden' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(policy->'warnings') IS DISTINCT FROM 'array'
    OR (policy ? 'accountLabel' AND jsonb_typeof(policy->'accountLabel') IS DISTINCT FROM 'string') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(policy->'warnings') AS warning
    WHERE jsonb_typeof(warning) IS DISTINCT FROM 'string') THEN
    RETURN false;
  END IF;
  scopes := policy->'scopes';
  IF jsonb_typeof(scopes) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(scopes) AS scope
    WHERE scope IS DISTINCT FROM '"read"'::jsonb) THEN
    RETURN false;
  END IF;
  RETURN jsonb_array_length(scopes) > 0;
END;
$$;
--> statement-breakpoint
ALTER TABLE public.exchange_credentials
  ADD COLUMN observation_read_only boolean
  GENERATED ALWAYS AS (
    public.exchange_credential_observation_read_only(permission_metadata, venue, exchange_account_id)
  ) STORED NOT NULL;
--> statement-breakpoint
GRANT SELECT (observation_read_only)
  ON public.exchange_credentials TO waia_account_observation_credential;
