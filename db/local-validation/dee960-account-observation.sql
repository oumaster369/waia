-- DEE-960 LOCAL schema prototype. Not a numbered/applicable production migration.
-- Iterated against disposable PostgreSQL 17 before migration packaging.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_account_observer') THEN
    CREATE ROLE waia_account_observer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_account_observer'
    AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolcanlogin)) THEN
    RAISE EXCEPTION 'UNSAFE_EXISTING_OBSERVER_ROLE';
  END IF;
END $$;
ALTER TABLE public.exchange_credentials ADD COLUMN observation_revision bigint NOT NULL DEFAULT 1
  CHECK (observation_revision > 0);
CREATE FUNCTION public.trader_observation_credential_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.observation_revision := 1;
  ELSE
    IF NEW.observation_revision IS DISTINCT FROM OLD.observation_revision THEN
      RAISE EXCEPTION 'OBSERVATION_REVISION_IS_DATABASE_OWNED';
    END IF;
    IF ROW(NEW.organization_id, NEW.venue, NEW.exchange_account_id, NEW.status,
      NEW.encrypted_payload, NEW.payload_key_version, NEW.wrapped_dek_key_version,
      NEW.wrapped_dek_key, NEW.permission_metadata, NEW.revoked_at)
      IS DISTINCT FROM
      ROW(OLD.organization_id, OLD.venue, OLD.exchange_account_id, OLD.status,
      OLD.encrypted_payload, OLD.payload_key_version, OLD.wrapped_dek_key_version,
      OLD.wrapped_dek_key, OLD.permission_metadata, OLD.revoked_at) THEN
      NEW.observation_revision := OLD.observation_revision + 1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trader_observation_credential_revision() FROM PUBLIC;
CREATE TRIGGER trader_observation_credential_revision
BEFORE INSERT OR UPDATE ON public.exchange_credentials FOR EACH ROW
EXECUTE FUNCTION public.trader_observation_credential_revision();

CREATE TABLE public.trader_account_collection_state (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  credential_id uuid NOT NULL REFERENCES public.exchange_credentials(id),
  exchange_account_id text NOT NULL,
  configuration_revision text NOT NULL CHECK (length(configuration_revision) BETWEEN 1 AND 256),
  symbols jsonb NOT NULL CHECK (jsonb_typeof(symbols) = 'array' AND jsonb_array_length(symbols) BETWEEN 1 AND 32),
  next_due_at timestamptz NOT NULL DEFAULT now(),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures BETWEEN 0 AND 30),
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  last_observation_id uuid,
  PRIMARY KEY (organization_id, credential_id, exchange_account_id),
  CHECK ((lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL) OR
    (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE TABLE public.trader_account_observations (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  credential_id uuid NOT NULL REFERENCES public.exchange_credentials(id),
  exchange_account_id text NOT NULL,
  observation_id uuid NOT NULL,
  credential_revision bigint NOT NULL CHECK (credential_revision > 0),
  configuration_revision text NOT NULL,
  lease_token uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 1048576),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, credential_id, exchange_account_id, observation_id),
  UNIQUE (organization_id, credential_id, exchange_account_id, lease_token),
  FOREIGN KEY (organization_id, credential_id, exchange_account_id)
    REFERENCES public.trader_account_collection_state (organization_id, credential_id, exchange_account_id)
);
ALTER TABLE public.trader_account_collection_state ADD CONSTRAINT trader_observation_last_fk
  FOREIGN KEY (organization_id, credential_id, exchange_account_id, last_observation_id)
  REFERENCES public.trader_account_observations (organization_id, credential_id, exchange_account_id, observation_id);
CREATE FUNCTION public.trader_observation_immutable() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ACCOUNT_OBSERVATION_IMMUTABLE'; END $$;
REVOKE ALL ON FUNCTION public.trader_observation_immutable() FROM PUBLIC;
CREATE TRIGGER trader_observation_immutable BEFORE UPDATE OR DELETE
  ON public.trader_account_observations FOR EACH ROW EXECUTE FUNCTION public.trader_observation_immutable();

ALTER TABLE public.trader_account_collection_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_account_collection_state FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trader_account_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_account_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.trader_account_collection_state, public.trader_account_observations
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO waia_account_observer;
GRANT SELECT (id, organization_id, venue, exchange_account_id, status, observation_revision)
  ON public.exchange_credentials TO waia_account_observer;
-- PostgreSQL row locks require UPDATE privilege. This column cannot be changed:
-- the trigger rejects caller revisions; no encrypted field or status UPDATE is granted.
GRANT UPDATE (observation_revision) ON public.exchange_credentials TO waia_account_observer;
CREATE POLICY trader_observer_credential_read ON public.exchange_credentials FOR SELECT TO waia_account_observer
  USING (organization_id::text = current_setting('waia.observation_org', true)
    AND id::text = current_setting('waia.observation_credential', true)
    AND exchange_account_id = current_setting('waia.observation_account', true));
CREATE POLICY trader_observer_credential_lock ON public.exchange_credentials FOR UPDATE TO waia_account_observer
  USING (organization_id::text = current_setting('waia.observation_org', true)
    AND id::text = current_setting('waia.observation_credential', true)
    AND exchange_account_id = current_setting('waia.observation_account', true))
  WITH CHECK (organization_id::text = current_setting('waia.observation_org', true)
    AND id::text = current_setting('waia.observation_credential', true)
    AND exchange_account_id = current_setting('waia.observation_account', true));
GRANT SELECT ON public.trader_account_collection_state, public.trader_account_observations TO waia_account_observer;
GRANT INSERT ON public.trader_account_observations TO waia_account_observer;
GRANT UPDATE (next_due_at, consecutive_failures, lease_token, lease_owner, lease_expires_at, last_observation_id)
  ON public.trader_account_collection_state TO waia_account_observer;
CREATE POLICY trader_observer_state ON public.trader_account_collection_state TO waia_account_observer
  USING (organization_id::text = current_setting('waia.observation_org', true)
    AND credential_id::text = current_setting('waia.observation_credential', true)
    AND exchange_account_id = current_setting('waia.observation_account', true))
  WITH CHECK (organization_id::text = current_setting('waia.observation_org', true)
    AND credential_id::text = current_setting('waia.observation_credential', true)
    AND exchange_account_id = current_setting('waia.observation_account', true));
CREATE POLICY trader_observer_records ON public.trader_account_observations TO waia_account_observer
  USING (organization_id::text = current_setting('waia.observation_org', true)
    AND credential_id::text = current_setting('waia.observation_credential', true)
    AND exchange_account_id = current_setting('waia.observation_account', true))
  WITH CHECK (organization_id::text = current_setting('waia.observation_org', true)
    AND credential_id::text = current_setting('waia.observation_credential', true)
    AND exchange_account_id = current_setting('waia.observation_account', true));

-- HTTP projection readers are deliberately distinct from collector ownership/writes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='waia_account_observation_reader') THEN
    CREATE ROLE waia_account_observation_reader NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='waia_account_observation_reader'
    AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolcanlogin OR rolinherit))
    OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
      WHERE r.rolname='waia_account_observation_reader') THEN
    RAISE EXCEPTION 'UNSAFE_EXISTING_OBSERVATION_READER_ROLE';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO waia_account_observation_reader;
GRANT SELECT (id, organization_id, venue, exchange_account_id, status, observation_revision)
  ON public.exchange_credentials TO waia_account_observation_reader;
GRANT SELECT (organization_id, credential_id, exchange_account_id, configuration_revision, symbols, last_observation_id)
  ON public.trader_account_collection_state TO waia_account_observation_reader;
GRANT SELECT (organization_id, credential_id, exchange_account_id, observation_id,
  credential_revision, configuration_revision, payload)
  ON public.trader_account_observations TO waia_account_observation_reader;
CREATE POLICY trader_observation_reader_credential ON public.exchange_credentials
  FOR SELECT TO waia_account_observation_reader
  USING (organization_id::text=current_setting('waia.observation_org', true)
    AND id::text=current_setting('waia.observation_credential', true)
    AND exchange_account_id=current_setting('waia.observation_account', true));
CREATE POLICY trader_observation_reader_state ON public.trader_account_collection_state
  FOR SELECT TO waia_account_observation_reader
  USING (organization_id::text=current_setting('waia.observation_org', true)
    AND credential_id::text=current_setting('waia.observation_credential', true)
    AND exchange_account_id=current_setting('waia.observation_account', true));
CREATE POLICY trader_observation_reader_records ON public.trader_account_observations
  FOR SELECT TO waia_account_observation_reader
  USING (organization_id::text=current_setting('waia.observation_org', true)
    AND credential_id::text=current_setting('waia.observation_credential', true)
    AND exchange_account_id=current_setting('waia.observation_account', true));
