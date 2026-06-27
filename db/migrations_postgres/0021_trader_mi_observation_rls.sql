-- DEE-281 / LD-2b: trader_mi_observation targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_mi_observation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_observation_deny_authenticated_select ON public.trader_mi_observation;
CREATE POLICY trader_mi_observation_deny_authenticated_select ON public.trader_mi_observation
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_observation_deny_authenticated_insert ON public.trader_mi_observation;
CREATE POLICY trader_mi_observation_deny_authenticated_insert ON public.trader_mi_observation
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_observation_deny_authenticated_update ON public.trader_mi_observation;
CREATE POLICY trader_mi_observation_deny_authenticated_update ON public.trader_mi_observation
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_observation_deny_authenticated_delete ON public.trader_mi_observation;
CREATE POLICY trader_mi_observation_deny_authenticated_delete ON public.trader_mi_observation
  FOR DELETE
  TO authenticated, anon
  USING (false);
