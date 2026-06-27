-- DEE-282 / LD-3: trader_mi_measurement targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_mi_measurement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_measurement_deny_authenticated_select ON public.trader_mi_measurement;
CREATE POLICY trader_mi_measurement_deny_authenticated_select ON public.trader_mi_measurement
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_measurement_deny_authenticated_insert ON public.trader_mi_measurement;
CREATE POLICY trader_mi_measurement_deny_authenticated_insert ON public.trader_mi_measurement
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_measurement_deny_authenticated_update ON public.trader_mi_measurement;
CREATE POLICY trader_mi_measurement_deny_authenticated_update ON public.trader_mi_measurement
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_measurement_deny_authenticated_delete ON public.trader_mi_measurement;
CREATE POLICY trader_mi_measurement_deny_authenticated_delete ON public.trader_mi_measurement
  FOR DELETE
  TO authenticated, anon
  USING (false);
