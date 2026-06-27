-- AT-E12 S3-B: settlement append-only triggers + targeted RLS (ADR-0007).

CREATE OR REPLACE FUNCTION public.waia_trader_settlements_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_settlements is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trader_settlements_block_update ON public.trader_settlements;
CREATE TRIGGER trader_settlements_block_update
  BEFORE UPDATE ON public.trader_settlements
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_settlements_block_mutation();

DROP TRIGGER IF EXISTS trader_settlements_block_delete ON public.trader_settlements;
CREATE TRIGGER trader_settlements_block_delete
  BEFORE DELETE ON public.trader_settlements
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_settlements_block_mutation();

CREATE OR REPLACE FUNCTION public.waia_trader_settlement_applications_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_settlement_applications is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trader_settlement_applications_block_update ON public.trader_settlement_applications;
CREATE TRIGGER trader_settlement_applications_block_update
  BEFORE UPDATE ON public.trader_settlement_applications
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_settlement_applications_block_mutation();

DROP TRIGGER IF EXISTS trader_settlement_applications_block_delete ON public.trader_settlement_applications;
CREATE TRIGGER trader_settlement_applications_block_delete
  BEFORE DELETE ON public.trader_settlement_applications
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_settlement_applications_block_mutation();

CREATE OR REPLACE FUNCTION public.waia_trader_account_status_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_account_status_events is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trader_account_status_events_block_update ON public.trader_account_status_events;
CREATE TRIGGER trader_account_status_events_block_update
  BEFORE UPDATE ON public.trader_account_status_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_account_status_events_block_mutation();

DROP TRIGGER IF EXISTS trader_account_status_events_block_delete ON public.trader_account_status_events;
CREATE TRIGGER trader_account_status_events_block_delete
  BEFORE DELETE ON public.trader_account_status_events
  FOR EACH ROW EXECUTE FUNCTION public.waia_trader_account_status_events_block_mutation();

ALTER TABLE public.trader_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_settlement_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_account_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_account_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trader_settlements_deny_authenticated_select ON public.trader_settlements;
CREATE POLICY trader_settlements_deny_authenticated_select ON public.trader_settlements
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_settlements_deny_authenticated_insert ON public.trader_settlements;
CREATE POLICY trader_settlements_deny_authenticated_insert ON public.trader_settlements
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_settlements_deny_authenticated_update ON public.trader_settlements;
CREATE POLICY trader_settlements_deny_authenticated_update ON public.trader_settlements
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_settlements_deny_authenticated_delete ON public.trader_settlements;
CREATE POLICY trader_settlements_deny_authenticated_delete ON public.trader_settlements
  FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_settlement_applications_deny_authenticated_select ON public.trader_settlement_applications;
CREATE POLICY trader_settlement_applications_deny_authenticated_select ON public.trader_settlement_applications
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_settlement_applications_deny_authenticated_insert ON public.trader_settlement_applications;
CREATE POLICY trader_settlement_applications_deny_authenticated_insert ON public.trader_settlement_applications
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_settlement_applications_deny_authenticated_update ON public.trader_settlement_applications;
CREATE POLICY trader_settlement_applications_deny_authenticated_update ON public.trader_settlement_applications
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_settlement_applications_deny_authenticated_delete ON public.trader_settlement_applications;
CREATE POLICY trader_settlement_applications_deny_authenticated_delete ON public.trader_settlement_applications
  FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_account_status_deny_authenticated_select ON public.trader_account_status;
CREATE POLICY trader_account_status_deny_authenticated_select ON public.trader_account_status
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_account_status_deny_authenticated_insert ON public.trader_account_status;
CREATE POLICY trader_account_status_deny_authenticated_insert ON public.trader_account_status
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_account_status_deny_authenticated_update ON public.trader_account_status;
CREATE POLICY trader_account_status_deny_authenticated_update ON public.trader_account_status
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_account_status_deny_authenticated_delete ON public.trader_account_status;
CREATE POLICY trader_account_status_deny_authenticated_delete ON public.trader_account_status
  FOR DELETE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_account_status_events_deny_authenticated_select ON public.trader_account_status_events;
CREATE POLICY trader_account_status_events_deny_authenticated_select ON public.trader_account_status_events
  FOR SELECT TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_account_status_events_deny_authenticated_insert ON public.trader_account_status_events;
CREATE POLICY trader_account_status_events_deny_authenticated_insert ON public.trader_account_status_events
  FOR INSERT TO authenticated, anon WITH CHECK (false);

DROP POLICY IF EXISTS trader_account_status_events_deny_authenticated_update ON public.trader_account_status_events;
CREATE POLICY trader_account_status_events_deny_authenticated_update ON public.trader_account_status_events
  FOR UPDATE TO authenticated, anon USING (false);

DROP POLICY IF EXISTS trader_account_status_events_deny_authenticated_delete ON public.trader_account_status_events;
CREATE POLICY trader_account_status_events_deny_authenticated_delete ON public.trader_account_status_events
  FOR DELETE TO authenticated, anon USING (false);
