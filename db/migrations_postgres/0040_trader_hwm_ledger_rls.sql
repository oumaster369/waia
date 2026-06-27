-- DEE-307 / AT-E11 S3: trader_hwm_ledger targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_hwm_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_hwm_ledger_deny_authenticated_select ON public.trader_hwm_ledger;
CREATE POLICY trader_hwm_ledger_deny_authenticated_select ON public.trader_hwm_ledger
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_hwm_ledger_deny_authenticated_insert ON public.trader_hwm_ledger;
CREATE POLICY trader_hwm_ledger_deny_authenticated_insert ON public.trader_hwm_ledger
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_hwm_ledger_deny_authenticated_update ON public.trader_hwm_ledger;
CREATE POLICY trader_hwm_ledger_deny_authenticated_update ON public.trader_hwm_ledger
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_hwm_ledger_deny_authenticated_delete ON public.trader_hwm_ledger;
CREATE POLICY trader_hwm_ledger_deny_authenticated_delete ON public.trader_hwm_ledger
  FOR DELETE
  TO authenticated, anon
  USING (false);
