-- DEE-415 / HTR-WP16: strategy lifecycle event RLS (ADR-0007 deny authenticated/anon)

ALTER TABLE public.trader_strategy_lifecycle_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_strategy_lifecycle_event_deny_authenticated_select ON public.trader_strategy_lifecycle_event;
CREATE POLICY trader_strategy_lifecycle_event_deny_authenticated_select ON public.trader_strategy_lifecycle_event FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_strategy_lifecycle_event_deny_authenticated_insert ON public.trader_strategy_lifecycle_event;
CREATE POLICY trader_strategy_lifecycle_event_deny_authenticated_insert ON public.trader_strategy_lifecycle_event FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_strategy_lifecycle_event_deny_authenticated_update ON public.trader_strategy_lifecycle_event;
CREATE POLICY trader_strategy_lifecycle_event_deny_authenticated_update ON public.trader_strategy_lifecycle_event FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_strategy_lifecycle_event_deny_authenticated_delete ON public.trader_strategy_lifecycle_event;
CREATE POLICY trader_strategy_lifecycle_event_deny_authenticated_delete ON public.trader_strategy_lifecycle_event FOR DELETE TO authenticated, anon USING (false);
