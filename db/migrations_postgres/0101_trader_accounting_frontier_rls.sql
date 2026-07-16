-- DEE-415 / HTR-WP18: trader accounting frontier RLS (ADR-0007 deny authenticated/anon)

ALTER TABLE public.trader_accounting_frontier ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_accounting_frontier_deny_authenticated_select ON public.trader_accounting_frontier;
CREATE POLICY trader_accounting_frontier_deny_authenticated_select ON public.trader_accounting_frontier FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_accounting_frontier_deny_authenticated_insert ON public.trader_accounting_frontier;
CREATE POLICY trader_accounting_frontier_deny_authenticated_insert ON public.trader_accounting_frontier FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_accounting_frontier_deny_authenticated_update ON public.trader_accounting_frontier;
CREATE POLICY trader_accounting_frontier_deny_authenticated_update ON public.trader_accounting_frontier FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_accounting_frontier_deny_authenticated_delete ON public.trader_accounting_frontier;
CREATE POLICY trader_accounting_frontier_deny_authenticated_delete ON public.trader_accounting_frontier FOR DELETE TO authenticated, anon USING (false);
