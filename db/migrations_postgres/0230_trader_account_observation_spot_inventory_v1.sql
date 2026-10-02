-- DEE-1032: identifiers-only spot inventory for self-service HTX observation.
-- Deferred. Do not apply this migration to production. It does not modify or apply 0229.
-- The caller role receives EXECUTE only. The private owner is the only reader of
-- identifier columns, through fixed policies, and is not granted to any LOGIN.
-- No collector INSERT, ciphertext, key decryption, or live trading authority.
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_account_observation_inventory_owner') THEN
    CREATE ROLE waia_account_observation_inventory_owner
      NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_account_observation_inventory') THEN
    CREATE ROLE waia_account_observation_inventory
      NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('waia_account_observation_inventory_owner', 'waia_account_observation_inventory')
      AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles owned ON owned.oid = membership.member
    WHERE owned.rolname = 'waia_account_observation_inventory_owner'
  ) THEN
    RAISE EXCEPTION 'UNSAFE_OBSERVATION_INVENTORY_ROLE';
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA public TO waia_account_observation_inventory_owner;
--> statement-breakpoint
GRANT SELECT (id, organization_id, venue, exchange_account_id, status, observation_revision)
  ON public.exchange_credentials TO waia_account_observation_inventory_owner;
--> statement-breakpoint
GRANT SELECT (
  organization_id, credential_id, exchange_account_id, configuration_revision, symbols, last_observation_id
) ON public.trader_account_collection_state TO waia_account_observation_inventory_owner;
--> statement-breakpoint
CREATE POLICY trader_observation_inventory_owner_credential
  ON public.exchange_credentials
  FOR SELECT
  TO waia_account_observation_inventory_owner
  USING (venue = 'htx' AND status = 'active');
--> statement-breakpoint
CREATE POLICY trader_observation_inventory_owner_state
  ON public.trader_account_collection_state
  FOR SELECT
  TO waia_account_observation_inventory_owner
  USING (
    EXISTS (
      SELECT 1
      FROM public.exchange_credentials credential
      WHERE credential.id = credential_id
        AND credential.organization_id = organization_id
        AND credential.exchange_account_id = exchange_account_id
        AND credential.venue = 'htx'
        AND credential.status = 'active'
    )
  );
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO waia_account_observation_inventory;
--> statement-breakpoint
DO $do$
DECLARE
  migration_role text := current_user;
  had_membership boolean := pg_has_role(current_user, 'waia_account_observation_inventory_owner', 'MEMBER');
BEGIN
  IF NOT pg_has_role(current_user, 'waia_account_observation_inventory_owner', 'SET') THEN
    EXECUTE format(
      'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
      'waia_account_observation_inventory_owner', migration_role);
  END IF;
  EXECUTE 'SET LOCAL ROLE waia_account_observation_inventory_owner';
  EXECUTE $fn$
    CREATE FUNCTION public.trader_account_observation_spot_inventory(
      p_configuration_revision text,
      p_symbols jsonb
    )
    RETURNS TABLE (
      organization_id text,
      credential_id text,
      exchange_account_id text,
      credential_revision text,
      configuration_revision text,
      symbols jsonb
    )
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog
    SET row_security = on
    AS $body$
    DECLARE
      match_count integer;
    BEGIN
      IF p_configuration_revision IS NULL
        OR length(p_configuration_revision) < 1
        OR length(p_configuration_revision) > 256
        OR p_symbols IS NULL
        OR jsonb_typeof(p_symbols) IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_symbols) < 1
        OR jsonb_array_length(p_symbols) > 32
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_symbols) AS element
          WHERE jsonb_typeof(element) IS DISTINCT FROM 'string'
            OR length(element #>> '{}') < 1
            OR length(element #>> '{}') > 64
        ) THEN
        RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_REFUSED';
      END IF;
      SELECT count(*) INTO match_count
      FROM public.exchange_credentials credential
      JOIN public.trader_account_collection_state state
        ON state.organization_id = credential.organization_id
        AND state.credential_id = credential.id
        AND state.exchange_account_id = credential.exchange_account_id
      WHERE credential.venue = 'htx'
        AND credential.status = 'active'
        AND state.configuration_revision = p_configuration_revision
        AND state.symbols = p_symbols;
      IF match_count > 20 THEN
        RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_OVERFLOW';
      END IF;
      RETURN QUERY
      SELECT credential.organization_id::text,
        credential.id::text,
        credential.exchange_account_id,
        credential.observation_revision::text,
        state.configuration_revision,
        state.symbols
      FROM public.exchange_credentials credential
      JOIN public.trader_account_collection_state state
        ON state.organization_id = credential.organization_id
        AND state.credential_id = credential.id
        AND state.exchange_account_id = credential.exchange_account_id
      WHERE credential.venue = 'htx'
        AND credential.status = 'active'
        AND state.configuration_revision = p_configuration_revision
        AND state.symbols = p_symbols
      ORDER BY (state.last_observation_id IS NULL) DESC,
        credential.organization_id, credential.exchange_account_id;
    END
    $body$
  $fn$;
  EXECUTE 'REVOKE ALL ON FUNCTION public.trader_account_observation_spot_inventory(text, jsonb) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.trader_account_observation_spot_inventory(text, jsonb) TO waia_account_observation_inventory';
  EXECUTE format('SET LOCAL ROLE %I', migration_role);
  IF NOT had_membership THEN
    EXECUTE format('REVOKE %I FROM %I', 'waia_account_observation_inventory_owner', migration_role);
  END IF;
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM waia_account_observation_inventory_owner';
END
$do$;
--> statement-breakpoint
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_account_observer_login') THEN
    IF EXISTS (
      SELECT 1
      FROM pg_auth_members membership
      JOIN pg_roles login ON login.oid = membership.member
      JOIN pg_roles parent ON parent.oid = membership.roleid
      WHERE login.rolname = 'waia_account_observer_login'
        AND parent.rolname NOT IN (
          'waia_account_observer', 'waia_account_observation_inventory')
    ) THEN
      RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_LOGIN_MEMBERSHIP';
    END IF;
    GRANT waia_account_observation_inventory TO waia_account_observer_login
      WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
  END IF;
  IF to_regrole('waia_account_observation_reader_login') IS NOT NULL
    AND pg_has_role('waia_account_observation_reader_login', 'waia_account_observation_inventory', 'SET') THEN
    RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_READER_ISOLATION';
  END IF;
  IF to_regrole('waia_account_observation_credential_login') IS NOT NULL
    AND pg_has_role('waia_account_observation_credential_login', 'waia_account_observation_inventory', 'SET') THEN
    RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_CREDENTIAL_ISOLATION';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc function
    JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
    JOIN pg_roles owner ON owner.oid = function.proowner
    WHERE namespace.nspname = 'public'
      AND function.proname = 'trader_account_observation_spot_inventory'
      AND owner.rolname = 'waia_account_observation_inventory_owner'
      AND function.prosecdef
      AND has_function_privilege('waia_account_observation_inventory', function.oid, 'EXECUTE')
      AND NOT has_function_privilege('public', function.oid, 'EXECUTE')
  ) OR has_table_privilege(
      'waia_account_observation_inventory', 'public.trader_account_collection_state', 'INSERT')
    OR has_any_column_privilege(
      'waia_account_observation_inventory', 'public.exchange_credentials', 'SELECT')
    OR has_column_privilege(
      'waia_account_observation_inventory_owner', 'public.exchange_credentials',
      'encrypted_payload', 'SELECT')
    OR (
      to_regrole('waia_account_observer_login') IS NOT NULL
      AND pg_has_role(
        'waia_account_observer_login', 'waia_account_observation_inventory_owner', 'SET')
    )
  THEN
    RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_PRIVILEGE_REFUSED';
  END IF;
END
$grant$;
