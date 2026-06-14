-- DEE-233 / ADR-0007: exchange_credentials targeted RLS (service-role only; deny authenticated/anon).
-- Application-layer org scoping remains primary; policies are defense-in-depth backstops.

ALTER TABLE public.exchange_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exchange_credentials_deny_authenticated_select ON public.exchange_credentials;
CREATE POLICY exchange_credentials_deny_authenticated_select ON public.exchange_credentials
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS exchange_credentials_deny_authenticated_insert ON public.exchange_credentials;
CREATE POLICY exchange_credentials_deny_authenticated_insert ON public.exchange_credentials
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS exchange_credentials_deny_authenticated_update ON public.exchange_credentials;
CREATE POLICY exchange_credentials_deny_authenticated_update ON public.exchange_credentials
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS exchange_credentials_deny_authenticated_delete ON public.exchange_credentials;
CREATE POLICY exchange_credentials_deny_authenticated_delete ON public.exchange_credentials
  FOR DELETE
  TO authenticated, anon
  USING (false);
