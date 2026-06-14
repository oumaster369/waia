-- DEE-247 / AT-E8 S1: trader order tables targeted RLS (service-role only; deny authenticated/anon).
-- Application-layer org scoping remains primary; policies are defense-in-depth backstops.

ALTER TABLE public.trader_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_fills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_orders_deny_authenticated_select ON public.trader_orders;
CREATE POLICY trader_orders_deny_authenticated_select ON public.trader_orders
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_orders_deny_authenticated_insert ON public.trader_orders;
CREATE POLICY trader_orders_deny_authenticated_insert ON public.trader_orders
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_orders_deny_authenticated_update ON public.trader_orders;
CREATE POLICY trader_orders_deny_authenticated_update ON public.trader_orders
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_orders_deny_authenticated_delete ON public.trader_orders;
CREATE POLICY trader_orders_deny_authenticated_delete ON public.trader_orders
  FOR DELETE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_order_events_deny_authenticated_select ON public.trader_order_events;
CREATE POLICY trader_order_events_deny_authenticated_select ON public.trader_order_events
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_order_events_deny_authenticated_insert ON public.trader_order_events;
CREATE POLICY trader_order_events_deny_authenticated_insert ON public.trader_order_events
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_order_events_deny_authenticated_update ON public.trader_order_events;
CREATE POLICY trader_order_events_deny_authenticated_update ON public.trader_order_events
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_order_events_deny_authenticated_delete ON public.trader_order_events;
CREATE POLICY trader_order_events_deny_authenticated_delete ON public.trader_order_events
  FOR DELETE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_fills_deny_authenticated_select ON public.trader_fills;
CREATE POLICY trader_fills_deny_authenticated_select ON public.trader_fills
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_fills_deny_authenticated_insert ON public.trader_fills;
CREATE POLICY trader_fills_deny_authenticated_insert ON public.trader_fills
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_fills_deny_authenticated_update ON public.trader_fills;
CREATE POLICY trader_fills_deny_authenticated_update ON public.trader_fills
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_fills_deny_authenticated_delete ON public.trader_fills;
CREATE POLICY trader_fills_deny_authenticated_delete ON public.trader_fills
  FOR DELETE
  TO authenticated, anon
  USING (false);
