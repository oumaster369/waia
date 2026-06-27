-- DEE-239 / AT-E7: trader_risk_limits targeted RLS (service-role only; deny authenticated/anon).
-- Application-layer org scoping remains primary; policies are defense-in-depth backstops.

ALTER TABLE public.trader_risk_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_risk_limits_deny_authenticated_select ON public.trader_risk_limits;
CREATE POLICY trader_risk_limits_deny_authenticated_select ON public.trader_risk_limits
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_risk_limits_deny_authenticated_insert ON public.trader_risk_limits;
CREATE POLICY trader_risk_limits_deny_authenticated_insert ON public.trader_risk_limits
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_risk_limits_deny_authenticated_update ON public.trader_risk_limits;
CREATE POLICY trader_risk_limits_deny_authenticated_update ON public.trader_risk_limits
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_risk_limits_deny_authenticated_delete ON public.trader_risk_limits;
CREATE POLICY trader_risk_limits_deny_authenticated_delete ON public.trader_risk_limits
  FOR DELETE
  TO authenticated, anon
  USING (false);
