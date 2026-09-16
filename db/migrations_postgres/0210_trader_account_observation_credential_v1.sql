-- DEE-1015: dedicated least-privilege account-observation credential-read authority.
-- Additive only. Migration 0205 keeps its exact collector/reader posture: neither
-- waia_account_observer nor waia_account_observation_reader gains ciphertext access here.
-- Migration 0007's owner/service semantics on exchange_credentials are unchanged and
-- FORCE ROW LEVEL SECURITY is deliberately NOT enabled on exchange_credentials.
-- No LOGIN, no write authority, no order/execution authority is created.
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_account_observation_credential') THEN
    CREATE ROLE waia_account_observation_credential
      NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waia_account_observation_credential'
    AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolcanlogin
      OR rolinherit OR rolreplication))
    OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
      WHERE r.rolname = 'waia_account_observation_credential') THEN
    RAISE EXCEPTION 'UNSAFE_EXISTING_OBSERVATION_CREDENTIAL_ROLE';
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO waia_account_observation_credential;

-- Exactly the columns the account-observation decryption path consumes: the identity/binding
-- tuple, the active-status gate and the four envelope fields read by decryptCredentialPayload.
-- api_key_masked, permission_metadata, venue, created_at, updated_at, revoked_at and
-- observation_revision are deliberately withheld, so SELECT * is refused for this role.
--> statement-breakpoint
GRANT SELECT (id, organization_id, exchange_account_id, status,
  encrypted_payload, payload_key_version, wrapped_dek_key_version, wrapped_dek_key)
  ON public.exchange_credentials TO waia_account_observation_credential;

-- The assignment predicate below is an RLS subquery, so it is evaluated with this role's own
-- privileges. Only the three identity columns of the Human-provisioned 0205 state relation are
-- granted: enough to confirm an assignment the caller already fully named, never to enumerate.
--> statement-breakpoint
GRANT SELECT (organization_id, credential_id, exchange_account_id)
  ON public.trader_account_collection_state TO waia_account_observation_credential;
--> statement-breakpoint
CREATE POLICY trader_observation_credential_assignment ON public.trader_account_collection_state
  FOR SELECT TO waia_account_observation_credential
  USING (organization_id::text = current_setting('waia.observation_org', true)
    AND credential_id::text = current_setting('waia.observation_credential', true)
    AND exchange_account_id = current_setting('waia.observation_account', true));

-- Assignment-bound credential read. Never USING (true): the transaction-local runtime context
-- tuple, the credential row tuple and a currently provisioned 0205 collection-state row must all
-- match exactly. Unset context yields NULL from current_setting(..., true) and therefore denies.
-- Knowing another credential UUID, or setting arbitrary observation GUCs with no provisioned
-- assignment, reads nothing.
--> statement-breakpoint
CREATE POLICY trader_observation_credential_read ON public.exchange_credentials
  FOR SELECT TO waia_account_observation_credential
  USING (status = 'active'
    AND organization_id::text = current_setting('waia.observation_org', true)
    AND id::text = current_setting('waia.observation_credential', true)
    AND exchange_account_id = current_setting('waia.observation_account', true)
    AND EXISTS (SELECT 1 FROM public.trader_account_collection_state state
      WHERE state.organization_id = public.exchange_credentials.organization_id
        AND state.credential_id = public.exchange_credentials.id
        AND state.exchange_account_id = public.exchange_credentials.exchange_account_id));
