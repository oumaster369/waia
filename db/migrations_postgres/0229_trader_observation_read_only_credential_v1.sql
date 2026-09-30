-- DEE-1151: observation may decrypt only a credential whose stored scopes are read
-- and not trade. permission_metadata stays withheld from the observation role.
-- The boolean is computed by the table owner. A missing, unparsable, empty, or
-- trade-bearing scope list is false. Do not edit 0000-0228.
--> statement-breakpoint
CREATE FUNCTION public.exchange_credential_observation_read_only(metadata text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  scopes jsonb;
BEGIN
  IF metadata IS NULL OR btrim(metadata) = '' THEN
    RETURN false;
  END IF;
  BEGIN
    scopes := metadata::jsonb -> 'scopes';
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF scopes IS NULL OR jsonb_typeof(scopes) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(scopes) AS scope
    WHERE scope IS DISTINCT FROM 'read'
  ) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(scopes) AS scope
    WHERE scope = 'read'
  );
END;
$$;
--> statement-breakpoint
ALTER TABLE public.exchange_credentials
  ADD COLUMN observation_read_only boolean
  GENERATED ALWAYS AS (public.exchange_credential_observation_read_only(permission_metadata)) STORED
  NOT NULL;
--> statement-breakpoint
GRANT SELECT (observation_read_only)
  ON public.exchange_credentials TO waia_account_observation_credential;
