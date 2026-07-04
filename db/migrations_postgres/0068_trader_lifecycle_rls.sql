-- DEE-376 / M1: trader lifecycle tables targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_position_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_trade_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_trades_deny_authenticated_select ON public.trader_trades;
CREATE POLICY trader_trades_deny_authenticated_select ON public.trader_trades
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_trades_deny_authenticated_insert ON public.trader_trades;
CREATE POLICY trader_trades_deny_authenticated_insert ON public.trader_trades
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_trades_deny_authenticated_update ON public.trader_trades;
CREATE POLICY trader_trades_deny_authenticated_update ON public.trader_trades
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_trades_deny_authenticated_delete ON public.trader_trades;
CREATE POLICY trader_trades_deny_authenticated_delete ON public.trader_trades
  FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_position_lots_deny_authenticated_select ON public.trader_position_lots;
CREATE POLICY trader_position_lots_deny_authenticated_select ON public.trader_position_lots
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_position_lots_deny_authenticated_insert ON public.trader_position_lots;
CREATE POLICY trader_position_lots_deny_authenticated_insert ON public.trader_position_lots
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_position_lots_deny_authenticated_update ON public.trader_position_lots;
CREATE POLICY trader_position_lots_deny_authenticated_update ON public.trader_position_lots
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_position_lots_deny_authenticated_delete ON public.trader_position_lots;
CREATE POLICY trader_position_lots_deny_authenticated_delete ON public.trader_position_lots
  FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_trade_legs_deny_authenticated_select ON public.trader_trade_legs;
CREATE POLICY trader_trade_legs_deny_authenticated_select ON public.trader_trade_legs
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_trade_legs_deny_authenticated_insert ON public.trader_trade_legs;
CREATE POLICY trader_trade_legs_deny_authenticated_insert ON public.trader_trade_legs
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_trade_legs_deny_authenticated_update ON public.trader_trade_legs;
CREATE POLICY trader_trade_legs_deny_authenticated_update ON public.trader_trade_legs
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_trade_legs_deny_authenticated_delete ON public.trader_trade_legs;
CREATE POLICY trader_trade_legs_deny_authenticated_delete ON public.trader_trade_legs
  FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_lifecycle_events_deny_authenticated_select ON public.trader_lifecycle_events;
CREATE POLICY trader_lifecycle_events_deny_authenticated_select ON public.trader_lifecycle_events
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_lifecycle_events_deny_authenticated_insert ON public.trader_lifecycle_events;
CREATE POLICY trader_lifecycle_events_deny_authenticated_insert ON public.trader_lifecycle_events
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_lifecycle_events_deny_authenticated_update ON public.trader_lifecycle_events;
CREATE POLICY trader_lifecycle_events_deny_authenticated_update ON public.trader_lifecycle_events
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_lifecycle_events_deny_authenticated_delete ON public.trader_lifecycle_events;
CREATE POLICY trader_lifecycle_events_deny_authenticated_delete ON public.trader_lifecycle_events
  FOR DELETE TO authenticated, anon USING (false);
