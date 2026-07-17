-- DEE-415 / HTR-WP21: trader hypothesis outcome record RLS (ADR-0007 deny authenticated/anon)

ALTER TABLE public.trader_hypothesis_outcome_record ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_hypothesis_outcome_record_deny_authenticated_select ON public.trader_hypothesis_outcome_record;
CREATE POLICY trader_hypothesis_outcome_record_deny_authenticated_select ON public.trader_hypothesis_outcome_record FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_hypothesis_outcome_record_deny_authenticated_insert ON public.trader_hypothesis_outcome_record;
CREATE POLICY trader_hypothesis_outcome_record_deny_authenticated_insert ON public.trader_hypothesis_outcome_record FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_hypothesis_outcome_record_deny_authenticated_update ON public.trader_hypothesis_outcome_record;
CREATE POLICY trader_hypothesis_outcome_record_deny_authenticated_update ON public.trader_hypothesis_outcome_record FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_hypothesis_outcome_record_deny_authenticated_delete ON public.trader_hypothesis_outcome_record;
CREATE POLICY trader_hypothesis_outcome_record_deny_authenticated_delete ON public.trader_hypothesis_outcome_record FOR DELETE TO authenticated, anon USING (false);
