-- DEE-1032: observer inventory of enrolled HTX collection-state (identities only).
-- Not a journal migration. Does not grant INSERT, ciphertext, or venue writes.
-- RLS policies OR together: GUC-scoped tick policies remain; inventory SELECT
-- without waia.observation_* GUCs can list active HTX enrollments (max 20 in the host).

CREATE POLICY trader_observer_credential_inventory
  ON public.exchange_credentials
  FOR SELECT
  TO waia_account_observer
  USING (venue = 'htx' AND status = 'active');

CREATE POLICY trader_observer_state_inventory
  ON public.trader_account_collection_state
  FOR SELECT
  TO waia_account_observer
  USING (
    EXISTS (
      SELECT 1
      FROM public.exchange_credentials c
      WHERE c.id = credential_id
        AND c.organization_id = organization_id
        AND c.exchange_account_id = exchange_account_id
        AND c.venue = 'htx'
        AND c.status = 'active'
    )
  );
