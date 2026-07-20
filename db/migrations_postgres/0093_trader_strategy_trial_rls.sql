-- DEE-415 / HTR-WP16: strategy trial RLS (ADR-0007 deny authenticated/anon)

ALTER TABLE public.trader_strategy_trial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_strategy_trial_deny_authenticated_select ON public.trader_strategy_trial;
CREATE POLICY trader_strategy_trial_deny_authenticated_select ON public.trader_strategy_trial FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_strategy_trial_deny_authenticated_insert ON public.trader_strategy_trial;
CREATE POLICY trader_strategy_trial_deny_authenticated_insert ON public.trader_strategy_trial FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_strategy_trial_deny_authenticated_update ON public.trader_strategy_trial;
CREATE POLICY trader_strategy_trial_deny_authenticated_update ON public.trader_strategy_trial FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_strategy_trial_deny_authenticated_delete ON public.trader_strategy_trial;
CREATE POLICY trader_strategy_trial_deny_authenticated_delete ON public.trader_strategy_trial FOR DELETE TO authenticated, anon USING (false);
