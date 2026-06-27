-- DEE-272 / DEE-178 S1: trader_strategy_promotion_records targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_strategy_promotion_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_strategy_promotion_records_deny_authenticated_select ON public.trader_strategy_promotion_records;
CREATE POLICY trader_strategy_promotion_records_deny_authenticated_select ON public.trader_strategy_promotion_records
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_strategy_promotion_records_deny_authenticated_insert ON public.trader_strategy_promotion_records;
CREATE POLICY trader_strategy_promotion_records_deny_authenticated_insert ON public.trader_strategy_promotion_records
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_strategy_promotion_records_deny_authenticated_update ON public.trader_strategy_promotion_records;
CREATE POLICY trader_strategy_promotion_records_deny_authenticated_update ON public.trader_strategy_promotion_records
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_strategy_promotion_records_deny_authenticated_delete ON public.trader_strategy_promotion_records;
CREATE POLICY trader_strategy_promotion_records_deny_authenticated_delete ON public.trader_strategy_promotion_records
  FOR DELETE
  TO authenticated, anon
  USING (false);
