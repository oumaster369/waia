-- DEE-310 / AT-E11 S5: trader_invoices targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_invoices_deny_authenticated_select ON public.trader_invoices;
CREATE POLICY trader_invoices_deny_authenticated_select ON public.trader_invoices
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_invoices_deny_authenticated_insert ON public.trader_invoices;
CREATE POLICY trader_invoices_deny_authenticated_insert ON public.trader_invoices
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_invoices_deny_authenticated_update ON public.trader_invoices;
CREATE POLICY trader_invoices_deny_authenticated_update ON public.trader_invoices
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_invoices_deny_authenticated_delete ON public.trader_invoices;
CREATE POLICY trader_invoices_deny_authenticated_delete ON public.trader_invoices
  FOR DELETE
  TO authenticated, anon
  USING (false);
