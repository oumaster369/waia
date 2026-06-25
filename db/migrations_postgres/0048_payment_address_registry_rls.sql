-- DEE-315 / AT-E12 S2-A: payment_address_events append-only + targeted RLS (ADR-0007 defense-in-depth).

CREATE OR REPLACE FUNCTION public.waia_payment_address_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payment_address_events is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS payment_address_events_block_update ON public.payment_address_events;
CREATE TRIGGER payment_address_events_block_update
  BEFORE UPDATE ON public.payment_address_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_payment_address_events_block_mutation();

DROP TRIGGER IF EXISTS payment_address_events_block_delete ON public.payment_address_events;
CREATE TRIGGER payment_address_events_block_delete
  BEFORE DELETE ON public.payment_address_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_payment_address_events_block_mutation();

ALTER TABLE public.payment_address_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_address_events_deny_authenticated_select ON public.payment_address_events;
CREATE POLICY payment_address_events_deny_authenticated_select ON public.payment_address_events
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payment_address_events_deny_authenticated_insert ON public.payment_address_events;
CREATE POLICY payment_address_events_deny_authenticated_insert ON public.payment_address_events
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS payment_address_events_deny_authenticated_update ON public.payment_address_events;
CREATE POLICY payment_address_events_deny_authenticated_update ON public.payment_address_events
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payment_address_events_deny_authenticated_delete ON public.payment_address_events;
CREATE POLICY payment_address_events_deny_authenticated_delete ON public.payment_address_events
  FOR DELETE
  TO authenticated, anon
  USING (false);

ALTER TABLE public.payment_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_addresses_deny_authenticated_select ON public.payment_addresses;
CREATE POLICY payment_addresses_deny_authenticated_select ON public.payment_addresses
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payment_addresses_deny_authenticated_insert ON public.payment_addresses;
CREATE POLICY payment_addresses_deny_authenticated_insert ON public.payment_addresses
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS payment_addresses_deny_authenticated_update ON public.payment_addresses;
CREATE POLICY payment_addresses_deny_authenticated_update ON public.payment_addresses
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payment_addresses_deny_authenticated_delete ON public.payment_addresses;
CREATE POLICY payment_addresses_deny_authenticated_delete ON public.payment_addresses
  FOR DELETE
  TO authenticated, anon
  USING (false);

ALTER TABLE public.payment_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_wallets_deny_authenticated_select ON public.payment_wallets;
CREATE POLICY payment_wallets_deny_authenticated_select ON public.payment_wallets
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payment_wallets_deny_authenticated_insert ON public.payment_wallets;
CREATE POLICY payment_wallets_deny_authenticated_insert ON public.payment_wallets
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS payment_wallets_deny_authenticated_update ON public.payment_wallets;
CREATE POLICY payment_wallets_deny_authenticated_update ON public.payment_wallets
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payment_wallets_deny_authenticated_delete ON public.payment_wallets;
CREATE POLICY payment_wallets_deny_authenticated_delete ON public.payment_wallets
  FOR DELETE
  TO authenticated, anon
  USING (false);
