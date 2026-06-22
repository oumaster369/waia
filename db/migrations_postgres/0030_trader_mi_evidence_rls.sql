-- DEE-289 / LD-5a.2a: trader_mi_evidence targeted RLS (service-role only; deny authenticated/anon).

ALTER TABLE public.trader_mi_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_mi_evidence_deny_authenticated_select ON public.trader_mi_evidence;
CREATE POLICY trader_mi_evidence_deny_authenticated_select ON public.trader_mi_evidence
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_evidence_deny_authenticated_insert ON public.trader_mi_evidence;
CREATE POLICY trader_mi_evidence_deny_authenticated_insert ON public.trader_mi_evidence
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS trader_mi_evidence_deny_authenticated_update ON public.trader_mi_evidence;
CREATE POLICY trader_mi_evidence_deny_authenticated_update ON public.trader_mi_evidence
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS trader_mi_evidence_deny_authenticated_delete ON public.trader_mi_evidence;
CREATE POLICY trader_mi_evidence_deny_authenticated_delete ON public.trader_mi_evidence
  FOR DELETE
  TO authenticated, anon
  USING (false);
