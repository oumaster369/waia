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
    JOIN pg_roles member_role ON member_role.oid = membership.member
    WHERE member_role.rolname IN (
      'waia_account_observation_inventory_owner', 'waia_account_observation_inventory')
  ) THEN
    RAISE EXCEPTION 'UNSAFE_OBSERVATION_INVENTORY_ROLE';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  -- Memberships are cluster-wide. A limited CREATEROLE migrator may create
  -- this role and receive an implicit ADMIN-only edge, but that edge does not
  -- grant SET ROLE. Never infer grant authority from MEMBER alone.
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid = membership.member
    JOIN pg_roles owner_role ON owner_role.oid = membership.roleid
    WHERE owner_role.rolname = 'waia_account_observation_inventory_owner'
      AND member_role.rolname <> current_user
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_OWNER_MEMBER_UNSAFE';
  END IF;
  IF NOT pg_has_role(current_user, 'waia_account_observation_inventory_owner', 'SET')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_auth_members membership
      JOIN pg_roles member_role ON member_role.oid = membership.member
      JOIN pg_roles owner_role ON owner_role.oid = membership.roleid
      WHERE member_role.rolname = current_user
        AND owner_role.rolname = 'waia_account_observation_inventory_owner'
        AND membership.admin_option
    ) THEN
    RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_OWNER_ADMIN_REQUIRED';
  END IF;
  IF NOT pg_has_role(current_user, 'waia_account_observation_inventory_owner', 'SET')
    AND EXISTS (
      SELECT 1
      FROM pg_auth_members membership
      JOIN pg_roles member_role ON member_role.oid = membership.member
      JOIN pg_roles owner_role ON owner_role.oid = membership.roleid
      JOIN pg_roles grantor_role ON grantor_role.oid = membership.grantor
      WHERE member_role.rolname = current_user
        AND owner_role.rolname = 'waia_account_observation_inventory_owner'
        AND grantor_role.rolname = current_user
        AND membership.admin_option
    ) THEN
    -- PostgreSQL does not let a grantor grant ADMIN back to its own membership
    -- edge. Refuse before schema changes rather than downgrade it temporarily.
    RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_OWNER_SELF_ADMIN_EDGE_UNSAFE';
  END IF;
  IF to_regrole('waia_account_observer_login') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_auth_members membership
      JOIN pg_roles login_role ON login_role.oid = membership.member
      JOIN pg_roles caller_role ON caller_role.oid = membership.roleid
      WHERE login_role.rolname = 'waia_account_observer_login'
        AND caller_role.rolname = 'waia_account_observation_inventory'
        AND (membership.admin_option OR membership.inherit_option OR NOT membership.set_option)
    ) THEN
    RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_LOGIN_MEMBERSHIP_UNSAFE';
  END IF;
  IF to_regrole('waia_account_observer_login') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_auth_members membership
      JOIN pg_roles member_role ON member_role.oid = membership.member
      JOIN pg_roles caller_role ON caller_role.oid = membership.roleid
      WHERE member_role.rolname = current_user
        AND caller_role.rolname = 'waia_account_observation_inventory'
        AND membership.admin_option
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_roles migration_actor
      WHERE migration_actor.rolname = current_user
        AND migration_actor.rolsuper
    ) THEN
    RAISE EXCEPTION 'ACCOUNT_OBSERVATION_INVENTORY_CALLER_ADMIN_REQUIRED';
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
      WHERE trader_account_collection_state.organization_id = credential.organization_id
        AND trader_account_collection_state.credential_id = credential.id
        AND trader_account_collection_state.exchange_account_id = credential.exchange_account_id
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
  added_temporary_membership boolean := false;
  had_same_grantor_membership boolean := false;
  previous_admin_option boolean := false;
  previous_inherit_option boolean := false;
  previous_set_option boolean := false;
BEGIN
  IF NOT pg_has_role(current_user, 'waia_account_observation_inventory_owner', 'SET') THEN
    SELECT membership.admin_option, membership.inherit_option, membership.set_option
      INTO previous_admin_option, previous_inherit_option, previous_set_option
    FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid = membership.member
    JOIN pg_roles owner_role ON owner_role.oid = membership.roleid
    JOIN pg_roles grantor_role ON grantor_role.oid = membership.grantor
    WHERE member_role.rolname = migration_role
      AND owner_role.rolname = 'waia_account_observation_inventory_owner'
      AND grantor_role.rolname = migration_role;
    had_same_grantor_membership := FOUND;
    IF NOT FOUND THEN
      had_same_grantor_membership := false;
      previous_admin_option := false;
      previous_inherit_option := false;
      previous_set_option := false;
    END IF;

    EXECUTE format(
      'GRANT %I TO %I WITH ADMIN FALSE, INHERIT %s, SET TRUE GRANTED BY %I',
      'waia_account_observation_inventory_owner', migration_role,
      CASE WHEN previous_inherit_option THEN 'TRUE' ELSE 'FALSE' END,
      migration_role);
    added_temporary_membership := true;
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
  IF added_temporary_membership THEN
    IF had_same_grantor_membership THEN
      EXECUTE format(
        'GRANT %I TO %I WITH ADMIN %s, INHERIT %s, SET %s GRANTED BY %I',
        'waia_account_observation_inventory_owner', migration_role,
        CASE WHEN previous_admin_option THEN 'TRUE' ELSE 'FALSE' END,
        CASE WHEN previous_inherit_option THEN 'TRUE' ELSE 'FALSE' END,
        CASE WHEN previous_set_option THEN 'TRUE' ELSE 'FALSE' END,
        migration_role);
    ELSE
      EXECUTE format('REVOKE %I FROM %I GRANTED BY %I',
        'waia_account_observation_inventory_owner', migration_role, migration_role);
    END IF;
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
