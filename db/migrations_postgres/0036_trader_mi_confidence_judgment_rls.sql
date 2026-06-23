-- DEE-293 / LD-5a.3a: trader_mi_confidence_judgment targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_mi_confidence_judgment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_confidence_judgment_deny_authenticated_select ON public.trader_mi_confidence_judgment;
CREATE POLICY trader_mi_confidence_judgment_deny_authenticated_select ON public.trader_mi_confidence_judgment
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_confidence_judgment_deny_authenticated_insert ON public.trader_mi_confidence_judgment;
CREATE POLICY trader_mi_confidence_judgment_deny_authenticated_insert ON public.trader_mi_confidence_judgment
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_confidence_judgment_deny_authenticated_update ON public.trader_mi_confidence_judgment;
CREATE POLICY trader_mi_confidence_judgment_deny_authenticated_update ON public.trader_mi_confidence_judgment
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_confidence_judgment_deny_authenticated_delete ON public.trader_mi_confidence_judgment;
CREATE POLICY trader_mi_confidence_judgment_deny_authenticated_delete ON public.trader_mi_confidence_judgment
  FOR DELETE
  TO authenticated, anon
  USING (false);
