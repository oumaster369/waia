-- DEE-305 / AT-E11 S1: trader_reporting_periods targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_reporting_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_reporting_periods_deny_authenticated_select ON public.trader_reporting_periods;
CREATE POLICY trader_reporting_periods_deny_authenticated_select ON public.trader_reporting_periods
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_reporting_periods_deny_authenticated_insert ON public.trader_reporting_periods;
CREATE POLICY trader_reporting_periods_deny_authenticated_insert ON public.trader_reporting_periods
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_reporting_periods_deny_authenticated_update ON public.trader_reporting_periods;
CREATE POLICY trader_reporting_periods_deny_authenticated_update ON public.trader_reporting_periods
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_reporting_periods_deny_authenticated_delete ON public.trader_reporting_periods;
CREATE POLICY trader_reporting_periods_deny_authenticated_delete ON public.trader_reporting_periods
  FOR DELETE
  TO authenticated, anon
  USING (false);
