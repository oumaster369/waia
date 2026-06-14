-- DEE-237 / AT-E2: trader_balance_snapshots targeted RLS (service-role only; deny authenticated/anon).
-- Application-layer org scoping remains primary; policies are defense-in-depth backstops.

ALTER TABLE public.trader_balance_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_balance_snapshots_deny_authenticated_select ON public.trader_balance_snapshots;
CREATE POLICY trader_balance_snapshots_deny_authenticated_select ON public.trader_balance_snapshots
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_balance_snapshots_deny_authenticated_insert ON public.trader_balance_snapshots;
CREATE POLICY trader_balance_snapshots_deny_authenticated_insert ON public.trader_balance_snapshots
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_balance_snapshots_deny_authenticated_update ON public.trader_balance_snapshots;
CREATE POLICY trader_balance_snapshots_deny_authenticated_update ON public.trader_balance_snapshots
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_balance_snapshots_deny_authenticated_delete ON public.trader_balance_snapshots;
CREATE POLICY trader_balance_snapshots_deny_authenticated_delete ON public.trader_balance_snapshots
  FOR DELETE
  TO authenticated, anon
  USING (false);
