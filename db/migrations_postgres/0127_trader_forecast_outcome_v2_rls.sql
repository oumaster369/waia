-- DEE-527 / WP-FORECAST-V2: trader_forecast_outcome_v2 RLS (ADR-0007)

ALTER TABLE public.trader_forecast_outcome_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tfov2_deny_authenticated_select ON public.trader_forecast_outcome_v2;
CREATE POLICY tfov2_deny_authenticated_select ON public.trader_forecast_outcome_v2 FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS tfov2_deny_authenticated_insert ON public.trader_forecast_outcome_v2;
CREATE POLICY tfov2_deny_authenticated_insert ON public.trader_forecast_outcome_v2 FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS tfov2_deny_authenticated_update ON public.trader_forecast_outcome_v2;
CREATE POLICY tfov2_deny_authenticated_update ON public.trader_forecast_outcome_v2 FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS tfov2_deny_authenticated_delete ON public.trader_forecast_outcome_v2;
CREATE POLICY tfov2_deny_authenticated_delete ON public.trader_forecast_outcome_v2 FOR DELETE TO authenticated, anon USING (false);
