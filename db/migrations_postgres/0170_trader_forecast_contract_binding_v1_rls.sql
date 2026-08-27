-- DEE-746: service-role-only access for the Forecast contract binding ledger.
ALTER TABLE public.trader_forecast_contract_binding_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY trader_forecast_contract_binding_v1_deny_authenticated_select
  ON public.trader_forecast_contract_binding_v1 FOR SELECT TO authenticated, anon USING (false);
CREATE POLICY trader_forecast_contract_binding_v1_deny_authenticated_insert
  ON public.trader_forecast_contract_binding_v1 FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY trader_forecast_contract_binding_v1_deny_authenticated_update
  ON public.trader_forecast_contract_binding_v1 FOR UPDATE TO authenticated, anon USING (false);
CREATE POLICY trader_forecast_contract_binding_v1_deny_authenticated_delete
  ON public.trader_forecast_contract_binding_v1 FOR DELETE TO authenticated, anon USING (false);
