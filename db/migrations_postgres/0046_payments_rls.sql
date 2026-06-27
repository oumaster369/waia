-- DEE-312 / AT-E12 S1: payment_events append-only + targeted RLS (ADR-0007 defense-in-depth).

CREATE OR REPLACE FUNCTION public.waia_payment_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payment_events is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS payment_events_block_update ON public.payment_events;
CREATE TRIGGER payment_events_block_update
  BEFORE UPDATE ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_payment_events_block_mutation();

DROP TRIGGER IF EXISTS payment_events_block_delete ON public.payment_events;
CREATE TRIGGER payment_events_block_delete
  BEFORE DELETE ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_payment_events_block_mutation();

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_events_deny_authenticated_select ON public.payment_events;
CREATE POLICY payment_events_deny_authenticated_select ON public.payment_events
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payment_events_deny_authenticated_insert ON public.payment_events;
CREATE POLICY payment_events_deny_authenticated_insert ON public.payment_events
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS payment_events_deny_authenticated_update ON public.payment_events;
CREATE POLICY payment_events_deny_authenticated_update ON public.payment_events
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payment_events_deny_authenticated_delete ON public.payment_events;
CREATE POLICY payment_events_deny_authenticated_delete ON public.payment_events
  FOR DELETE
  TO authenticated, anon
  USING (false);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_deny_authenticated_select ON public.payments;
CREATE POLICY payments_deny_authenticated_select ON public.payments
  FOR SELECT
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payments_deny_authenticated_insert ON public.payments;
CREATE POLICY payments_deny_authenticated_insert ON public.payments
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS payments_deny_authenticated_update ON public.payments;
CREATE POLICY payments_deny_authenticated_update ON public.payments
  FOR UPDATE
  TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS payments_deny_authenticated_delete ON public.payments;
CREATE POLICY payments_deny_authenticated_delete ON public.payments
  FOR DELETE
  TO authenticated, anon
  USING (false);
