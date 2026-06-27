-- DEE-206A / AT-E7: trader_kill_switches targeted RLS (service-role only; deny authenticated/anon).
-- Application-layer org scoping remains primary; policies are defense-in-depth backstops.

ALTER TABLE public.trader_kill_switches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_kill_switches_deny_authenticated_select ON public.trader_kill_switches;
CREATE POLICY trader_kill_switches_deny_authenticated_select ON public.trader_kill_switches
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_kill_switches_deny_authenticated_insert ON public.trader_kill_switches;
CREATE POLICY trader_kill_switches_deny_authenticated_insert ON public.trader_kill_switches
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_kill_switches_deny_authenticated_update ON public.trader_kill_switches;
CREATE POLICY trader_kill_switches_deny_authenticated_update ON public.trader_kill_switches
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_kill_switches_deny_authenticated_delete ON public.trader_kill_switches;
CREATE POLICY trader_kill_switches_deny_authenticated_delete ON public.trader_kill_switches
  FOR DELETE
  TO authenticated, anon
  USING (false);
