-- DEE-381 / M6: pattern catalog tables RLS (ADR-0007 deny authenticated/anon)

ALTER TABLE public.trader_mi_pattern_score ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_mi_pattern_score_deny_authenticated_select ON public.trader_mi_pattern_score;
CREATE POLICY trader_mi_pattern_score_deny_authenticated_select ON public.trader_mi_pattern_score FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_mi_pattern_score_deny_authenticated_insert ON public.trader_mi_pattern_score;
CREATE POLICY trader_mi_pattern_score_deny_authenticated_insert ON public.trader_mi_pattern_score FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_mi_pattern_score_deny_authenticated_update ON public.trader_mi_pattern_score;
CREATE POLICY trader_mi_pattern_score_deny_authenticated_update ON public.trader_mi_pattern_score FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_mi_pattern_score_deny_authenticated_delete ON public.trader_mi_pattern_score;
CREATE POLICY trader_mi_pattern_score_deny_authenticated_delete ON public.trader_mi_pattern_score FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_price_move_explanation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_price_move_explanation_deny_authenticated_select ON public.trader_price_move_explanation;
CREATE POLICY trader_price_move_explanation_deny_authenticated_select ON public.trader_price_move_explanation FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_price_move_explanation_deny_authenticated_insert ON public.trader_price_move_explanation;
CREATE POLICY trader_price_move_explanation_deny_authenticated_insert ON public.trader_price_move_explanation FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_price_move_explanation_deny_authenticated_update ON public.trader_price_move_explanation;
CREATE POLICY trader_price_move_explanation_deny_authenticated_update ON public.trader_price_move_explanation FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_price_move_explanation_deny_authenticated_delete ON public.trader_price_move_explanation;
CREATE POLICY trader_price_move_explanation_deny_authenticated_delete ON public.trader_price_move_explanation FOR DELETE TO authenticated, anon USING (false);
