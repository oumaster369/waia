-- DEE-285 / LD-5a.1a: trader_mi_hypothesis + trader_mi_hypothesis_lifecycle targeted RLS
-- (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_mi_hypothesis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_hypothesis_deny_authenticated_select ON public.trader_mi_hypothesis;
CREATE POLICY trader_mi_hypothesis_deny_authenticated_select ON public.trader_mi_hypothesis
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_hypothesis_deny_authenticated_insert ON public.trader_mi_hypothesis;
CREATE POLICY trader_mi_hypothesis_deny_authenticated_insert ON public.trader_mi_hypothesis
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_hypothesis_deny_authenticated_update ON public.trader_mi_hypothesis;
CREATE POLICY trader_mi_hypothesis_deny_authenticated_update ON public.trader_mi_hypothesis
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_hypothesis_deny_authenticated_delete ON public.trader_mi_hypothesis;
CREATE POLICY trader_mi_hypothesis_deny_authenticated_delete ON public.trader_mi_hypothesis
  FOR DELETE
  TO authenticated, anon
  USING (false);

ALTER TABLE public.trader_mi_hypothesis_lifecycle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_hypothesis_lifecycle_deny_authenticated_select ON public.trader_mi_hypothesis_lifecycle;
CREATE POLICY trader_mi_hypothesis_lifecycle_deny_authenticated_select ON public.trader_mi_hypothesis_lifecycle
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_hypothesis_lifecycle_deny_authenticated_insert ON public.trader_mi_hypothesis_lifecycle;
CREATE POLICY trader_mi_hypothesis_lifecycle_deny_authenticated_insert ON public.trader_mi_hypothesis_lifecycle
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_hypothesis_lifecycle_deny_authenticated_update ON public.trader_mi_hypothesis_lifecycle;
CREATE POLICY trader_mi_hypothesis_lifecycle_deny_authenticated_update ON public.trader_mi_hypothesis_lifecycle
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_hypothesis_lifecycle_deny_authenticated_delete ON public.trader_mi_hypothesis_lifecycle;
CREATE POLICY trader_mi_hypothesis_lifecycle_deny_authenticated_delete ON public.trader_mi_hypothesis_lifecycle
  FOR DELETE
  TO authenticated, anon
  USING (false);
