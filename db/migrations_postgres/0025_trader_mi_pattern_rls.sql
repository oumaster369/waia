-- DEE-283 / LD-4: trader_mi_pattern + trader_mi_pattern_lifecycle targeted RLS
-- (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_mi_pattern ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_pattern_deny_authenticated_select ON public.trader_mi_pattern;
CREATE POLICY trader_mi_pattern_deny_authenticated_select ON public.trader_mi_pattern
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_pattern_deny_authenticated_insert ON public.trader_mi_pattern;
CREATE POLICY trader_mi_pattern_deny_authenticated_insert ON public.trader_mi_pattern
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_pattern_deny_authenticated_update ON public.trader_mi_pattern;
CREATE POLICY trader_mi_pattern_deny_authenticated_update ON public.trader_mi_pattern
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_pattern_deny_authenticated_delete ON public.trader_mi_pattern;
CREATE POLICY trader_mi_pattern_deny_authenticated_delete ON public.trader_mi_pattern
  FOR DELETE
  TO authenticated, anon
  USING (false);

ALTER TABLE public.trader_mi_pattern_lifecycle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_pattern_lifecycle_deny_authenticated_select ON public.trader_mi_pattern_lifecycle;
CREATE POLICY trader_mi_pattern_lifecycle_deny_authenticated_select ON public.trader_mi_pattern_lifecycle
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_pattern_lifecycle_deny_authenticated_insert ON public.trader_mi_pattern_lifecycle;
CREATE POLICY trader_mi_pattern_lifecycle_deny_authenticated_insert ON public.trader_mi_pattern_lifecycle
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_pattern_lifecycle_deny_authenticated_update ON public.trader_mi_pattern_lifecycle;
CREATE POLICY trader_mi_pattern_lifecycle_deny_authenticated_update ON public.trader_mi_pattern_lifecycle
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_pattern_lifecycle_deny_authenticated_delete ON public.trader_mi_pattern_lifecycle;
CREATE POLICY trader_mi_pattern_lifecycle_deny_authenticated_delete ON public.trader_mi_pattern_lifecycle
  FOR DELETE
  TO authenticated, anon
  USING (false);
