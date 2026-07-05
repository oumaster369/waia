-- DEE-382 / M7: RLS deny authenticated/anon on event attribution tables

ALTER TABLE public.trader_event_record ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_event_record_deny_authenticated_select ON public.trader_event_record;
CREATE POLICY trader_event_record_deny_authenticated_select ON public.trader_event_record FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_event_record_deny_authenticated_insert ON public.trader_event_record;
CREATE POLICY trader_event_record_deny_authenticated_insert ON public.trader_event_record FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_event_record_deny_authenticated_update ON public.trader_event_record;
CREATE POLICY trader_event_record_deny_authenticated_update ON public.trader_event_record FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_event_record_deny_authenticated_delete ON public.trader_event_record;
CREATE POLICY trader_event_record_deny_authenticated_delete ON public.trader_event_record FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_event_classification ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_event_classification_deny_authenticated_select ON public.trader_event_classification;
CREATE POLICY trader_event_classification_deny_authenticated_select ON public.trader_event_classification FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_event_classification_deny_authenticated_insert ON public.trader_event_classification;
CREATE POLICY trader_event_classification_deny_authenticated_insert ON public.trader_event_classification FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_event_classification_deny_authenticated_update ON public.trader_event_classification;
CREATE POLICY trader_event_classification_deny_authenticated_update ON public.trader_event_classification FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_event_classification_deny_authenticated_delete ON public.trader_event_classification;
CREATE POLICY trader_event_classification_deny_authenticated_delete ON public.trader_event_classification FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_event_attribution ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_event_attribution_deny_authenticated_select ON public.trader_event_attribution;
CREATE POLICY trader_event_attribution_deny_authenticated_select ON public.trader_event_attribution FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_event_attribution_deny_authenticated_insert ON public.trader_event_attribution;
CREATE POLICY trader_event_attribution_deny_authenticated_insert ON public.trader_event_attribution FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_event_attribution_deny_authenticated_update ON public.trader_event_attribution;
CREATE POLICY trader_event_attribution_deny_authenticated_update ON public.trader_event_attribution FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_event_attribution_deny_authenticated_delete ON public.trader_event_attribution;
CREATE POLICY trader_event_attribution_deny_authenticated_delete ON public.trader_event_attribution FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_event_attribution_confidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_event_attribution_confidence_deny_authenticated_select ON public.trader_event_attribution_confidence;
CREATE POLICY trader_event_attribution_confidence_deny_authenticated_select ON public.trader_event_attribution_confidence FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_event_attribution_confidence_deny_authenticated_insert ON public.trader_event_attribution_confidence;
CREATE POLICY trader_event_attribution_confidence_deny_authenticated_insert ON public.trader_event_attribution_confidence FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_event_attribution_confidence_deny_authenticated_update ON public.trader_event_attribution_confidence;
CREATE POLICY trader_event_attribution_confidence_deny_authenticated_update ON public.trader_event_attribution_confidence FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_event_attribution_confidence_deny_authenticated_delete ON public.trader_event_attribution_confidence;
CREATE POLICY trader_event_attribution_confidence_deny_authenticated_delete ON public.trader_event_attribution_confidence FOR DELETE TO authenticated, anon USING (false);

ALTER TABLE public.trader_event_explanation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trader_event_explanation_deny_authenticated_select ON public.trader_event_explanation;
CREATE POLICY trader_event_explanation_deny_authenticated_select ON public.trader_event_explanation FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_event_explanation_deny_authenticated_insert ON public.trader_event_explanation;
CREATE POLICY trader_event_explanation_deny_authenticated_insert ON public.trader_event_explanation FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_event_explanation_deny_authenticated_update ON public.trader_event_explanation;
CREATE POLICY trader_event_explanation_deny_authenticated_update ON public.trader_event_explanation FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_event_explanation_deny_authenticated_delete ON public.trader_event_explanation;
CREATE POLICY trader_event_explanation_deny_authenticated_delete ON public.trader_event_explanation FOR DELETE TO authenticated, anon USING (false);
