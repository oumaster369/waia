-- DEE-279 / LD-2a: trader_mi_source + trader_mi_source_trust targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_mi_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_mi_source_trust ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_source_deny_authenticated_select ON public.trader_mi_source;
CREATE POLICY trader_mi_source_deny_authenticated_select ON public.trader_mi_source
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_source_deny_authenticated_insert ON public.trader_mi_source;
CREATE POLICY trader_mi_source_deny_authenticated_insert ON public.trader_mi_source
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_source_deny_authenticated_update ON public.trader_mi_source;
CREATE POLICY trader_mi_source_deny_authenticated_update ON public.trader_mi_source
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_source_deny_authenticated_delete ON public.trader_mi_source;
CREATE POLICY trader_mi_source_deny_authenticated_delete ON public.trader_mi_source
  FOR DELETE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_source_trust_deny_authenticated_select ON public.trader_mi_source_trust;
CREATE POLICY trader_mi_source_trust_deny_authenticated_select ON public.trader_mi_source_trust
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_source_trust_deny_authenticated_insert ON public.trader_mi_source_trust;
CREATE POLICY trader_mi_source_trust_deny_authenticated_insert ON public.trader_mi_source_trust
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_source_trust_deny_authenticated_update ON public.trader_mi_source_trust;
CREATE POLICY trader_mi_source_trust_deny_authenticated_update ON public.trader_mi_source_trust
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_source_trust_deny_authenticated_delete ON public.trader_mi_source_trust;
CREATE POLICY trader_mi_source_trust_deny_authenticated_delete ON public.trader_mi_source_trust
  FOR DELETE
  TO authenticated, anon
  USING (false);
