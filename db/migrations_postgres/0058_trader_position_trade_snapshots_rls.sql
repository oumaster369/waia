-- DEE-350 / AT-E2: position + trade-history snapshot targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_position_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_position_snapshots_deny_authenticated_select ON public.trader_position_snapshots;
CREATE POLICY trader_position_snapshots_deny_authenticated_select ON public.trader_position_snapshots
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_position_snapshots_deny_authenticated_insert ON public.trader_position_snapshots;
CREATE POLICY trader_position_snapshots_deny_authenticated_insert ON public.trader_position_snapshots
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_position_snapshots_deny_authenticated_update ON public.trader_position_snapshots;
CREATE POLICY trader_position_snapshots_deny_authenticated_update ON public.trader_position_snapshots
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_position_snapshots_deny_authenticated_delete ON public.trader_position_snapshots;
CREATE POLICY trader_position_snapshots_deny_authenticated_delete ON public.trader_position_snapshots
  FOR DELETE
  TO authenticated, anon
  USING (false);

ALTER TABLE public.trader_trade_history_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_trade_history_snapshots_deny_authenticated_select ON public.trader_trade_history_snapshots;
CREATE POLICY trader_trade_history_snapshots_deny_authenticated_select ON public.trader_trade_history_snapshots
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_trade_history_snapshots_deny_authenticated_insert ON public.trader_trade_history_snapshots;
CREATE POLICY trader_trade_history_snapshots_deny_authenticated_insert ON public.trader_trade_history_snapshots
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_trade_history_snapshots_deny_authenticated_update ON public.trader_trade_history_snapshots;
CREATE POLICY trader_trade_history_snapshots_deny_authenticated_update ON public.trader_trade_history_snapshots
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_trade_history_snapshots_deny_authenticated_delete ON public.trader_trade_history_snapshots;
CREATE POLICY trader_trade_history_snapshots_deny_authenticated_delete ON public.trader_trade_history_snapshots
  FOR DELETE
  TO authenticated, anon
  USING (false);
