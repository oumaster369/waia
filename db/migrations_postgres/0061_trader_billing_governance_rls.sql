-- AT-E11 / DEE-215: billing governance append-only + RLS (ADR-0007).

CREATE OR REPLACE FUNCTION public.waia_trader_invoice_dispute_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_invoice_dispute_events is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.waia_trader_invoice_corrections_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_invoice_corrections is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trader_invoice_dispute_events_block_update ON public.trader_invoice_dispute_events;
CREATE TRIGGER trader_invoice_dispute_events_block_update
  BEFORE UPDATE ON public.trader_invoice_dispute_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_invoice_dispute_events_block_mutation();

DROP TRIGGER IF EXISTS trader_invoice_dispute_events_block_delete ON public.trader_invoice_dispute_events;
CREATE TRIGGER trader_invoice_dispute_events_block_delete
  BEFORE DELETE ON public.trader_invoice_dispute_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_invoice_dispute_events_block_mutation();

DROP TRIGGER IF EXISTS trader_invoice_corrections_block_update ON public.trader_invoice_corrections;
CREATE TRIGGER trader_invoice_corrections_block_update
  BEFORE UPDATE ON public.trader_invoice_corrections
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_invoice_corrections_block_mutation();

DROP TRIGGER IF EXISTS trader_invoice_corrections_block_delete ON public.trader_invoice_corrections;
CREATE TRIGGER trader_invoice_corrections_block_delete
  BEFORE DELETE ON public.trader_invoice_corrections
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_invoice_corrections_block_mutation();

ALTER TABLE public.trader_invoice_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_invoice_dispute_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_invoice_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_invoice_disputes_deny_authenticated_select ON public.trader_invoice_disputes;
CREATE POLICY trader_invoice_disputes_deny_authenticated_select ON public.trader_invoice_disputes
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_invoice_disputes_deny_authenticated_insert ON public.trader_invoice_disputes;
CREATE POLICY trader_invoice_disputes_deny_authenticated_insert ON public.trader_invoice_disputes
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_invoice_disputes_deny_authenticated_update ON public.trader_invoice_disputes;
CREATE POLICY trader_invoice_disputes_deny_authenticated_update ON public.trader_invoice_disputes
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_invoice_disputes_deny_authenticated_delete ON public.trader_invoice_disputes;
CREATE POLICY trader_invoice_disputes_deny_authenticated_delete ON public.trader_invoice_disputes
  FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_invoice_dispute_events_deny_authenticated_select ON public.trader_invoice_dispute_events;
CREATE POLICY trader_invoice_dispute_events_deny_authenticated_select ON public.trader_invoice_dispute_events
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_invoice_dispute_events_deny_authenticated_insert ON public.trader_invoice_dispute_events;
CREATE POLICY trader_invoice_dispute_events_deny_authenticated_insert ON public.trader_invoice_dispute_events
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_invoice_dispute_events_deny_authenticated_update ON public.trader_invoice_dispute_events;
CREATE POLICY trader_invoice_dispute_events_deny_authenticated_update ON public.trader_invoice_dispute_events
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_invoice_dispute_events_deny_authenticated_delete ON public.trader_invoice_dispute_events;
CREATE POLICY trader_invoice_dispute_events_deny_authenticated_delete ON public.trader_invoice_dispute_events
  FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_invoice_corrections_deny_authenticated_select ON public.trader_invoice_corrections;
CREATE POLICY trader_invoice_corrections_deny_authenticated_select ON public.trader_invoice_corrections
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_invoice_corrections_deny_authenticated_insert ON public.trader_invoice_corrections;
CREATE POLICY trader_invoice_corrections_deny_authenticated_insert ON public.trader_invoice_corrections
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_invoice_corrections_deny_authenticated_update ON public.trader_invoice_corrections;
CREATE POLICY trader_invoice_corrections_deny_authenticated_update ON public.trader_invoice_corrections
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_invoice_corrections_deny_authenticated_delete ON public.trader_invoice_corrections;
CREATE POLICY trader_invoice_corrections_deny_authenticated_delete ON public.trader_invoice_corrections
  FOR DELETE TO authenticated, anon USING (false);
