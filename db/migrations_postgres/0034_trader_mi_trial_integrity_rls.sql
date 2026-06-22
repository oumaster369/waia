-- DEE-291 / LD-5a.2c: trader_mi_trial_integrity_event targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_mi_trial_integrity_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_trial_integrity_event_deny_authenticated_select ON public.trader_mi_trial_integrity_event;
CREATE POLICY trader_mi_trial_integrity_event_deny_authenticated_select ON public.trader_mi_trial_integrity_event
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_trial_integrity_event_deny_authenticated_insert ON public.trader_mi_trial_integrity_event;
CREATE POLICY trader_mi_trial_integrity_event_deny_authenticated_insert ON public.trader_mi_trial_integrity_event
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_trial_integrity_event_deny_authenticated_update ON public.trader_mi_trial_integrity_event;
CREATE POLICY trader_mi_trial_integrity_event_deny_authenticated_update ON public.trader_mi_trial_integrity_event
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_trial_integrity_event_deny_authenticated_delete ON public.trader_mi_trial_integrity_event;
CREATE POLICY trader_mi_trial_integrity_event_deny_authenticated_delete ON public.trader_mi_trial_integrity_event
  FOR DELETE
  TO authenticated, anon
  USING (false);
