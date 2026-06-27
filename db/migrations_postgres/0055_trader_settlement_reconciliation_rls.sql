-- AT-E12 S3-C-A: settlement reconciliation append-only + RLS (ADR-0007).

CREATE OR REPLACE FUNCTION public.waia_trader_settlement_reconciliation_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_settlement_reconciliation_events is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trader_settlement_reconciliation_events_block_update ON public.trader_settlement_reconciliation_events;
CREATE TRIGGER trader_settlement_reconciliation_events_block_update
  BEFORE UPDATE ON public.trader_settlement_reconciliation_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_settlement_reconciliation_events_block_mutation();

DROP TRIGGER IF EXISTS trader_settlement_reconciliation_events_block_delete ON public.trader_settlement_reconciliation_events;
CREATE TRIGGER trader_settlement_reconciliation_events_block_delete
  BEFORE DELETE ON public.trader_settlement_reconciliation_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_settlement_reconciliation_events_block_mutation();

ALTER TABLE public.trader_settlement_reconciliation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_settlement_reconciliation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_settlement_reconciliation_cases_deny_authenticated_select ON public.trader_settlement_reconciliation_cases;
CREATE POLICY trader_settlement_reconciliation_cases_deny_authenticated_select ON public.trader_settlement_reconciliation_cases
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_settlement_reconciliation_cases_deny_authenticated_insert ON public.trader_settlement_reconciliation_cases;
CREATE POLICY trader_settlement_reconciliation_cases_deny_authenticated_insert ON public.trader_settlement_reconciliation_cases
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_settlement_reconciliation_cases_deny_authenticated_update ON public.trader_settlement_reconciliation_cases;
CREATE POLICY trader_settlement_reconciliation_cases_deny_authenticated_update ON public.trader_settlement_reconciliation_cases
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_settlement_reconciliation_cases_deny_authenticated_delete ON public.trader_settlement_reconciliation_cases;
CREATE POLICY trader_settlement_reconciliation_cases_deny_authenticated_delete ON public.trader_settlement_reconciliation_cases
  FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_settlement_reconciliation_events_deny_authenticated_select ON public.trader_settlement_reconciliation_events;
CREATE POLICY trader_settlement_reconciliation_events_deny_authenticated_select ON public.trader_settlement_reconciliation_events
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_settlement_reconciliation_events_deny_authenticated_insert ON public.trader_settlement_reconciliation_events;
CREATE POLICY trader_settlement_reconciliation_events_deny_authenticated_insert ON public.trader_settlement_reconciliation_events
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_settlement_reconciliation_events_deny_authenticated_update ON public.trader_settlement_reconciliation_events;
CREATE POLICY trader_settlement_reconciliation_events_deny_authenticated_update ON public.trader_settlement_reconciliation_events
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_settlement_reconciliation_events_deny_authenticated_delete ON public.trader_settlement_reconciliation_events;
CREATE POLICY trader_settlement_reconciliation_events_deny_authenticated_delete ON public.trader_settlement_reconciliation_events
  FOR DELETE TO authenticated, anon USING (false);
