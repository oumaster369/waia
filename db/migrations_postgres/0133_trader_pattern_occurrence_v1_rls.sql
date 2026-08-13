-- DEE-533 / WP-PATTERN-RESEARCH: pattern occurrence RLS (ADR-0007)

ALTER TABLE public.trader_pattern_occurrence_v1 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_pattern_occurrence_v1_deny_authenticated_select ON public.trader_pattern_occurrence_v1;
CREATE POLICY trader_pattern_occurrence_v1_deny_authenticated_select ON public.trader_pattern_occurrence_v1 FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_pattern_occurrence_v1_deny_authenticated_insert ON public.trader_pattern_occurrence_v1;
CREATE POLICY trader_pattern_occurrence_v1_deny_authenticated_insert ON public.trader_pattern_occurrence_v1 FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_pattern_occurrence_v1_deny_authenticated_update ON public.trader_pattern_occurrence_v1;
CREATE POLICY trader_pattern_occurrence_v1_deny_authenticated_update ON public.trader_pattern_occurrence_v1 FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_pattern_occurrence_v1_deny_authenticated_delete ON public.trader_pattern_occurrence_v1;
CREATE POLICY trader_pattern_occurrence_v1_deny_authenticated_delete ON public.trader_pattern_occurrence_v1 FOR DELETE TO authenticated, anon USING (false);
