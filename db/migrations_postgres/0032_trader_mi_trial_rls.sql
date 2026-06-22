-- DEE-289 / LD-5a.2b: trader_mi_trial targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_mi_trial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_trial_deny_authenticated_select ON public.trader_mi_trial;
CREATE POLICY trader_mi_trial_deny_authenticated_select ON public.trader_mi_trial
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_trial_deny_authenticated_insert ON public.trader_mi_trial;
CREATE POLICY trader_mi_trial_deny_authenticated_insert ON public.trader_mi_trial
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_trial_deny_authenticated_update ON public.trader_mi_trial;
CREATE POLICY trader_mi_trial_deny_authenticated_update ON public.trader_mi_trial
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_trial_deny_authenticated_delete ON public.trader_mi_trial;
CREATE POLICY trader_mi_trial_deny_authenticated_delete ON public.trader_mi_trial
  FOR DELETE
  TO authenticated, anon
  USING (false);
